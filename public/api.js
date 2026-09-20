// ==========================================
// CONFIGURAÇÃO DO SUPABASE (Fixa no código)
// ==========================================
// Substitua pelos valores do SEU projeto Supabase:
// Painel > Project Settings > API
const SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || 'https://ekyonsvyeydfjxdytiyu.supabase.co';
const SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVreW9uc3Z5ZXlkZmp4ZHl0aXl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Mjk3MDEsImV4cCI6MjEwMTAwNTcwMX0.k8y9ohQlGOdxACOOwUqxYMWCX0xmQPOR3gL8vY9PTOQ';

// ==========================================
// Cliente Supabase e estado de autenticação
// ==========================================
let supabaseClient = null;
let authSession = null;

// O link do e-mail de "esqueci a senha" traz o usuário de volta já com uma
// sessão válida. Sem esta marca, o app veria "usuário logado" e o mandaria
// direto para o dashboard — sem nunca pedir a senha nova.
let emRecuperacaoDeSenha = false;
let aoEntrarEmRecuperacao = null;

// Salão ao qual o login pertence. Pode ser diferente do id do próprio login:
// é assim que vários logins compartilham a mesma barbearia.
let salonId = null;
let salonRole = null;
let salonProfessionalId = null;   // qual barbeiro e este login (null = dono)

// Acerta os campos de fidelidade de UM cliente antes de ele subir para a nuvem.
// Chamada nos dois lugares que montam payload de `clients` (o upsert de save()
// e a migração inicial) — as duas precisam andar juntas.
//
// ⚠️ A armadilha do PostgREST em upsert de LOTE: as colunas gravadas são a
// UNIÃO das chaves de TODOS os objetos do array, e a linha que não tem uma
// dessas chaves recebe NULL — nunca o DEFAULT da coluna. Como os clientes
// vindos do banco trazem "loyaltyEnrolled": true, a coluna sempre entra nessa
// união; bastava UM cliente recém-cadastrado sem o campo para ele ser enviado
// com NULL e bater no NOT NULL de docs/25_fidelidade.sql, derrubando o lote
// inteiro. O `DEFAULT true` do ALTER TABLE nunca chegava a valer: ele só age
// quando a coluna fica FORA do INSERT, e aqui ela entrava com NULL explícito.
// Era esse o "Erro ao salvar na nuvem" no cadastro manual de cliente.
function normalizaFidelidade(cliente) {
    // Adesão automática é a regra do negócio ("tem cadastro, já faz parte do
    // clube"), a mesma que o DEFAULT true do script 25 escreve no banco.
    if (cliente.loyaltyEnrolled === undefined || cliente.loyaltyEnrolled === null) {
        cliente.loyaltyEnrolled = true;
    }
    // Saldo de pontos é do gatilho e da RPC, NUNCA do navegador — o
    // docs/25_fidelidade.sql pede esta remoção pelo nome, pela mesma razão de
    // `daysSinceLast` acima. Sem ela, um aparelho com cache velho sobrescreve
    // pontos que o gatilho acabou de somar em outro lugar. Tirar a chave do
    // payload (em vez de mandar um valor) é o que preserva o saldo: coluna
    // ausente não entra no ON CONFLICT DO UPDATE, e em linha nova cai no
    // DEFAULT 0.
    delete cliente.loyaltyPoints;
}

// Mesma armadilha do upsert em lote descrita acima, agora em `services`: o
// banco tem a coluna "packageCredits" (NOT NULL) do Pacote de Serviços, que
// ainda não foi configurado e por isso nenhuma tela preenche. Os serviços
// vindos da nuvem trazem a chave, ela entra na união do lote, e o serviço
// recém-cadastrado ia com NULL — derrubando o upsert inteiro e deixando o
// serviço novo só no navegador (era por isso que ele não aparecia na venda:
// finalizar_venda não encontra no cadastro o que nunca subiu).
function normalizaServico(servico) {
    // Zero é o serviço avulso: não concede crédito de pacote nenhum. Quem já
    // tem valor gravado na nuvem mantém o que está lá.
    if (servico.packageCredits === undefined || servico.packageCredits === null) {
        servico.packageCredits = 0;
    }
}

// Inicializa o cliente Supabase (chamado uma vez ao carregar a página)
function initSupabase() {
    if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'https://SEU-PROJETO.supabase.co') {
        // O Supabase devolve os tokens no hash da URL (#...&type=recovery) e o
        // supabase-js limpa o hash logo depois. A leitura direta aqui é a
        // garantia síncrona; o evento abaixo cobre o caso de ela chegar tarde.
        if (/type=recovery/.test(location.hash)) {
            emRecuperacaoDeSenha = true;
        }

        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        supabaseClient.auth.onAuthStateChange(function (evento, sessao) {
            if (evento === 'PASSWORD_RECOVERY') {
                emRecuperacaoDeSenha = true;
                authSession = sessao || authSession;
                if (typeof aoEntrarEmRecuperacao === 'function') aoEntrarEmRecuperacao();
            }
        });
    }
}

// O servidor recusou o token da sessão? Cobre token vencido, assinatura
// inválida e "JWT issued at future" (relógio do aparelho adiantado em relação
// ao do Supabase). Nesses casos vale renovar a sessão e tentar de novo — nos
// demais erros, insistir não adianta.
function ehErroDeSessao(erro) {
    if (!erro) return false;
    if (erro.code === 'PGRST301' || erro.code === '401') return true;
    return /jwt|token|session|expired|not authenticated/i.test(erro.message || '');
}

const DataService = {
    // -------------------------
    // AUTENTICAÇÃO
    // -------------------------
    async init() {
        initSupabase();
        if (supabaseClient) {
            const { data, error } = await supabaseClient.auth.getSession();
            if (data && data.session) {
                authSession = data.session;
                // Antes de qualquer leitura ou gravação: sem o vínculo, o app
                // gravaria com o id do login e criaria uma barbearia paralela.
                await this.carregarVinculoDoSalao();
            }
        }
    },

    async login(email, password) {
        if (!supabaseClient) throw new Error("Supabase não configurado. Verifique a URL e a Anon Key no arquivo api.js.");
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        authSession = data.session;
        await this.carregarVinculoDoSalao();
        return data.user;
    },

    async logout() {
        if (supabaseClient) {
            await supabaseClient.auth.signOut();
        }
        authSession = null;
        salonId = null;
        salonRole = null;
        salonProfessionalId = null;
    },

    isAuthenticated() {
        return authSession != null;
    },

    // -------------------------
    // RECUPERAÇÃO DE SENHA
    // -------------------------

    // Dispara o e-mail com o link de redefinição. `redirectTo` precisa estar
    // liberado em Authentication > URL Configuration no painel do Supabase,
    // senão o link volta para o site errado.
    async enviarLinkDeRecuperacao(email) {
        if (!supabaseClient) throw new Error("Sistema indisponível no momento.");
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            // Precisa apontar para /app: a raiz do site hoje serve a landing
            // page, que não carrega o painel nem a tela de nova senha.
            redirectTo: `${location.origin}/app`,
        });
        if (error) throw error;
    },

    // Troca a senha do usuário que voltou pelo link do e-mail. Só funciona com
    // a sessão de recuperação ativa.
    async definirNovaSenha(novaSenha) {
        if (!supabaseClient) throw new Error("Sistema indisponível no momento.");
        const { error } = await supabaseClient.auth.updateUser({ password: novaSenha });
        if (error) throw error;
        emRecuperacaoDeSenha = false;
    },

    estaEmRecuperacaoDeSenha() {
        return emRecuperacaoDeSenha;
    },

    // Registra quem avisar caso o evento de recuperação chegue depois do boot.
    aoEntrarEmRecuperacaoDeSenha(callback) {
        aoEntrarEmRecuperacao = callback;
        if (emRecuperacaoDeSenha && typeof callback === 'function') callback();
    },

    isSupabaseConfigured() {
        return supabaseClient != null;
    },

    // Identidade do LOGIN. Não usar para gravar registros — para isso vale o
    // salão (getTenantId), que pode ser outro quando o login é de funcionário.
    getUserId() {
        return authSession?.user?.id || null;
    },

    getUserEmail() {
        return authSession?.user?.email || null;
    },

    // -------------------------
    // SALÃO (vários logins, uma barbearia)
    // -------------------------
    // A coluna user_id das tabelas identifica o SALÃO dono do registro, não o
    // login que criou. Sem essa distinção, cada login novo criava na prática
    // uma barbearia vazia, porque gravava tudo com o próprio id.
    async carregarVinculoDoSalao() {
        salonId = null;
        salonRole = null;
        salonProfessionalId = null;
        if (!supabaseClient || !this.isAuthenticated()) return;

        const uid = this.getUserId();
        try {
            // professional_id só existe depois de docs/add_niveis_de_acesso.sql.
            // Pedir a coluna num banco sem ela derruba a consulta inteira e o
            // login perderia até o vínculo de salão — por isso a segunda
            // tentativa sem ela.
            let { data, error } = await supabaseClient
                .from('salon_members')
                .select('salon_id, role, professional_id')
                .eq('user_id', uid)
                .maybeSingle();

            if (error) {
                ({ data, error } = await supabaseClient
                    .from('salon_members')
                    .select('salon_id, role')
                    .eq('user_id', uid)
                    .maybeSingle());
            }

            if (error) {
                // Tabela ainda não criada (migração não rodada): o login volta
                // a ser dono do próprio salão, que é o comportamento antigo.
                console.warn('Vínculo de salão indisponível, usando o próprio login:', error.message);
            } else if (data) {
                salonId = data.salon_id;
                salonRole = data.role;
                salonProfessionalId = data.professional_id || null;
            }
        } catch (e) {
            console.warn('Falha ao ler o vínculo de salão:', e);
        }

        if (!salonId) {
            salonId = uid;
            salonRole = 'owner';
            salonProfessionalId = null;
        }
    },

    // Dono dos registros. É este valor que vai na coluna user_id.
    getTenantId() {
        return salonId || this.getUserId();
    },

    getPapelNoSalao() {
        return salonRole || 'owner';
    },

    // Qual barbeiro é este login. null para o dono.
    getProfissionalDoLogin() {
        return salonProfessionalId;
    },

    // Acesso restrito: vê só a própria agenda, os próprios clientes e a
    // própria comissão. Quem manda de verdade é a RLS
    // (docs/add_niveis_de_acesso.sql) — isto aqui só ajusta a tela.
    ehBarbeiro() {
        return this.getPapelNoSalao() === 'staff';
    },

    /* Gerenciar o LOGIN de um profissional (criar, suspender, reativar, apagar).

       Sai daqui e vai para a Edge Function `acesso-profissional`, e não é
       preciosismo: criar conta mexe em `auth.users`, tabela que nenhuma RLS
       alcança e que só a chave de SERVIÇO pode tocar. Essa chave nunca pode
       chegar ao navegador — com ela, qualquer visitante do link público teria
       poder total sobre o banco. A função invoca com o JWT desta sessão, e é o
       servidor que confere se quem pediu é o dono.

       `invoke` já manda o Authorization da sessão sozinho. Só devolve a
       resposta; quem decide o que mostrar é a tela. */
    async gerenciarAcessoDoProfissional(acao, professionalId, email) {
        if (!supabaseClient) throw new Error('Sem conexão com o servidor.');
        const { data, error } = await supabaseClient.functions.invoke('acesso-profissional', {
            body: { acao: acao, professionalId: professionalId || '', email: email || '' }
        });
        // Um erro HTTP (403, 409...) vem em `error`, mas a mensagem útil está no
        // corpo — sem lê-la, o dono veria só "Edge Function returned a non-2xx".
        if (error) {
            let detalhe = '';
            try { detalhe = (await error.context?.json())?.erro || ''; } catch (e) { /* corpo não-JSON */ }
            throw new Error(detalhe || error.message || 'Falha ao falar com o servidor.');
        }
        if (data && data.erro) throw new Error(data.erro);
        return data || {};
    },

    // Vitrine do link público: só o que está ativo e com estoque.
    // Não devolve quantidade — ver docs/add_produtos_e_estoque.sql.
    async getPublicProducts(slug) {
        if (!supabaseClient) return [];
        const { data, error } = await supabaseClient.rpc('get_public_products', { p_slug: slug });
        if (error) {
            console.warn('Vitrine indisponível:', error.message);
            return [];
        }
        return data || [];
    },

    /* Movimento de estoque: a ÚNICA porta por onde a quantidade muda na nuvem.
       Ver docs/add_movimentacao_estoque.sql.

       Não é `products.update(...)` por dois motivos: o UPDATE lá é RELATIVO
       (`stock - qtd`), então duas vendas ao mesmo tempo somam em vez de uma
       apagar a outra; e o barbeiro não tem escrita em products, mas precisa
       poder vender.

       Devolve { ok:false } quando a migração ainda não rodou — aí quem chamou
       cai para a baixa local, do mesmo jeito que o resto do app cai para o
       localStorage. */
    async registrarMovimentoEstoque(mov) {
        if (!supabaseClient || !this.isAuthenticated()) return { ok: false, motivo: 'offline' };
        const { data, error } = await supabaseClient.rpc('registrar_movimento_estoque', {
            p_id: mov.id,
            p_product_id: mov.productId,
            p_type: mov.type,
            p_qty: mov.qty,
            p_reason: mov.reason || 'ajuste',
            p_unit_price: mov.unitPrice || 0,
            p_client_id: mov.clientId || null,
            p_appointment_id: mov.appointmentId || null,
            p_prof_id: mov.profId || null,
            p_transaction_id: mov.transactionId || null,
            p_note: mov.note || null,
            p_date: mov.date || null
        });
        if (error) {
            console.warn('Movimento de estoque não gravado na nuvem:', error.message);
            return { ok: false, motivo: error.message };
        }
        return { ok: true, stock: data && data.stock };
    },

    /* Finalização da venda: a ÚNICA porta por onde uma venda nasce na nuvem.
       Ver docs/15_finalizacao_venda.sql.

       Não é uma sequência de upserts porque venda não é uma tabela só: são
       venda, itens, pagamentos, lançamentos financeiros, movimentos de estoque
       e o atendimento de origem. Seis upserts pelo PostgREST são seis
       transações diferentes — a queda no meio deixa estoque baixado sem venda,
       ou venda sem pagamento. A RPC faz tudo numa transação, confere os totais
       de novo e recusa estoque insuficiente sem gravar nada.

       Devolve { ok:false, motivo } em vez de estourar: quem chamou precisa
       mostrar o motivo no balcão, não um erro de console. Em produção, um
       ok:false NUNCA pode virar sucesso na tela — ver checkout.js. */
    async finalizarVenda(payload) {
        if (!supabaseClient || !this.isAuthenticated()) {
            return { ok: false, offline: true, motivo: 'Sem conexão com o servidor.' };
        }
        const { data, error } = await supabaseClient.rpc('finalizar_venda', { p_venda: payload });
        if (error) {
            console.warn('Venda não concluída na nuvem:', error.message);
            return {
                ok: false,
                motivo: error.message || 'O servidor recusou a venda.',
                // 42883/PGRST202: a função não existe — a migration 15 não rodou.
                faltaMigration: /finalizar_venda/i.test(error.message || '') &&
                    /(does not exist|not find|schema cache)/i.test(error.message || '')
            };
        }
        return data || { ok: false, motivo: 'O servidor não confirmou a venda.' };
    },

    /* Dá baixa numa lista de comissões, ou desfaz a baixa.

       Vai tudo numa chamada só porque pagar comissão é um ato único, feito no
       fim da semana: uma chamada por linha deixaria metade marcada se a conexão
       caísse no meio.

       Quem recusa um barbeiro é a própria RPC (docs/21_comissoes.sql), que
       confere `meu_papel()` antes de escrever — a tela só evita mostrar o botão
       para quem vai levar erro. */
    async pagarComissoes(ids, paga = true) {
        if (!supabaseClient || !this.isAuthenticated()) {
            return { ok: false, motivo: 'Sem conexão com o servidor.' };
        }
        const { data, error } = await supabaseClient.rpc('pagar_comissoes', {
            p_ids: ids,
            p_paga: paga
        });
        if (error) {
            console.warn('Baixa de comissão recusada:', error.message);
            return {
                ok: false,
                motivo: error.message || 'O servidor recusou a baixa.',
                faltaMigration: /pagar_comissoes/i.test(error.message || '') &&
                    /(does not exist|not find|schema cache)/i.test(error.message || '')
            };
        }
        return data || { ok: false, motivo: 'O servidor não confirmou a baixa.' };
    },

    /* Recebe uma parcela do crediário.

       Uma chamada por recebimento, com chave de idempotência: apertar duas
       vezes, dar F5 no meio ou perder a rede não pode baixar a parcela duas
       vezes nem lançar o dinheiro em dobro no caixa. A RPC devolve
       `repetida: true` quando reconhece a chave, em vez de receber de novo.

       Quem valida saldo, papel e forma de pagamento é o banco
       (docs/23_crediario_1_tabelas_e_rpcs.sql + docs/24_corrige_source_crediario.sql).
       Aqui não se decide nada. */
    async receberCrediario(payload) {
        if (!supabaseClient || !this.isAuthenticated()) {
            return { ok: false, offline: true, motivo: 'Sem conexão com o servidor.' };
        }
        const { data, error } = await supabaseClient.rpc('receber_crediario', { p_payload: payload });
        if (error) {
            console.warn('Recebimento não concluído:', error.message);
            return {
                ok: false,
                motivo: error.message || 'O servidor recusou o recebimento.',
                faltaMigration: /receber_crediario/i.test(error.message || '') &&
                    /(does not exist|not find|schema cache)/i.test(error.message || '')
            };
        }
        return data || { ok: false, motivo: 'O servidor não confirmou o recebimento.' };
    },

    /* Resgata o benefício de fidelidade: consome a meta em pontos e registra
       o movimento negativo. Ver docs/25_fidelidade.sql.

       Chamada em dois lugares: pelo checkout, logo depois que a venda que
       usou o desconto do benefício já foi confirmada (por isso carrega o
       `saleId`, para a auditoria mostrar em qual venda o benefício saiu); e
       pela aba Fidelidade, direto, sem venda nenhuma (`saleId: null`).

       Mesma chave de idempotência de sempre: duplo clique ou F5 no meio não
       pode descontar os pontos duas vezes. */
    async resgatarFidelidade(payload) {
        if (!supabaseClient || !this.isAuthenticated()) {
            return { ok: false, offline: true, motivo: 'Sem conexão com o servidor.' };
        }
        const { data, error } = await supabaseClient.rpc('resgatar_fidelidade', { p_payload: payload });
        if (error) {
            console.warn('Resgate de fidelidade recusado:', error.message);
            return {
                ok: false,
                motivo: error.message || 'O servidor recusou o resgate.',
                faltaMigration: /resgatar_fidelidade/i.test(error.message || '') &&
                    /(does not exist|not find|schema cache)/i.test(error.message || '')
            };
        }
        return data || { ok: false, motivo: 'O servidor não confirmou o resgate.' };
    },

    // Fila do cliente no link público, pelo WhatsApp que ele usou.
    async getPublicQueue(slug, phone) {
        if (!supabaseClient) return null;
        const { data, error } = await supabaseClient.rpc('get_public_queue', {
            p_slug: slug, p_phone: phone
        });
        if (error) {
            console.warn('Fila indisponível:', error.message);
            return null;
        }
        return data;
    },

    // O login é de funcionário vinculado ao salão de outra pessoa?
    ehLoginConvidado() {
        const uid = this.getUserId();
        return !!(uid && salonId && salonId !== uid);
    },

    // -------------------------
    // DADOS (CRUD)
    // -------------------------
    // `opcoes.escopo = 'ciclo'` é a carga automática, a que se repete sozinha
    // enquanto a tela fica aberta. Ela NÃO traz business_info, professionals
    // nem products: as três guardam foto em base64 e respondem pela maior
    // parte do peso de cada volta — e mudam quando alguém edita um cadastro,
    // não a cada dois minutos. Quem as traz de volta é a carga COMPLETA: boot,
    // login e, de tempos em tempos, o próprio ciclo (ver app.js).
    //
    // Sem o segundo argumento a carga é COMPLETA. Isso é o que mantém de pé
    // quem chamava `loadAll(keys)` antes desta mudança — inclusive o
    // testes/testa_sessao.js, que mede o fallback de cache.
    async loadAll(keys, opcoes) {
        const cicloLeve = !!(opcoes && opcoes.escopo === 'ciclo');

        if (supabaseClient && this.isAuthenticated()) {
            // Consulta que não foi feita. O `error: null` é essencial: a
            // renovação de sessão logo abaixo e o `results.find(r => r.error)`
            // varrem este array, e um placeholder com erro dispararia o aviso
            // "sua sessão não foi aceita" a cada dois minutos, no meio do
            // expediente. As sete posições continuam as mesmas porque o código
            // adiante lê `results[6]` por índice.
            const NAO_CONSULTADO = { data: undefined, error: null };

            const buscarTudo = () => Promise.all([
                supabaseClient.from('services').select('*'),
                cicloLeve ? Promise.resolve(NAO_CONSULTADO)
                          : supabaseClient.from('professionals').select('*'),
                supabaseClient.from('clients').select('*'),
                supabaseClient.from('appointments').select('*'),
                supabaseClient.from('leads').select('*'),
                supabaseClient.from('transactions').select('*'),
                cicloLeve ? Promise.resolve(NAO_CONSULTADO)
                          : supabaseClient.from('business_info').select('*').limit(1)
            ]);

            // Busca dados da Nuvem (RLS filtra automaticamente pelo user_id)
            let results = await buscarTudo();

            // O servidor pode recusar o token da sessão — token vencido, ou
            // "JWT issued at future" quando o relógio do aparelho está
            // adiantado em relação ao do Supabase. Vale renovar a sessão e
            // tentar de novo antes de desistir.
            if (results.some(r => r.error && ehErroDeSessao(r.error))) {
                console.warn("Token recusado pelo servidor, renovando a sessão...");
                try {
                    const { data: renovada, error: erroRenovacao } = await supabaseClient.auth.refreshSession();
                    if (!erroRenovacao && renovada && renovada.session) {
                        authSession = renovada.session;
                        results = await buscarTudo();
                    }
                } catch (e) {
                    console.warn("Falha ao renovar a sessão:", e);
                }
            }

            // Erros do Supabase não são exceções: vêm no campo .error de
            // cada resposta. Sem esta checagem, falhas passam em silêncio.
            const failed = results.find(r => r.error);
            if (failed) {
                console.error("Erro ao carregar dados da nuvem:", failed.error);
                if (ehErroDeSessao(failed.error)) {
                    window.showToast?.(
                        "Sua sessão não foi aceita pelo servidor. Saia e entre de novo. " +
                        "Se repetir, confira se a data e a hora do aparelho estão automáticas. " +
                        "Mostrando os últimos dados salvos neste aparelho.",
                        "danger"
                    );
                } else {
                    window.showToast?.(
                        "Erro ao carregar dados da nuvem: " + failed.error.message +
                        ". Mostrando os últimos dados salvos neste aparelho.",
                        "danger"
                    );
                }
            }

            // Se uma consulta falhou, cair para o cache local em vez de array
            // vazio: melhor mostrar dado de ontem do que uma agenda zerada,
            // que passa a impressão de que os agendamentos sumiram.
            const doCache = (chave) => {
                try {
                    return JSON.parse(localStorage.getItem(chave));
                } catch (e) {
                    return null;
                }
            };
            const ou = (resultado, chave) => (resultado.error ? doCache(chave) : resultado.data);

            const [services, professionals, clients, appointments, leads, transactions, businessInfoArr] = [
                ou(results[0], keys.SERVICES),
                ou(results[1], keys.PROFESSIONALS),
                ou(results[2], keys.CLIENTS),
                ou(results[3], keys.APPOINTMENTS),
                ou(results[4], keys.LEADS),
                ou(results[5], keys.TRANSACTIONS),
                results[6].error ? [doCache(keys.BUSINESS_INFO)].filter(Boolean) : results[6].data,
            ];

            // cash_registers pode não existir ainda no Supabase — consulta separada com fallback seguro
            let cashRegisters = [];
            try {
                const crResult = await supabaseClient.from('cash_registers').select('*');
                if (!crResult.error) {
                    cashRegisters = crResult.data || [];
                } else {
                    console.warn("Tabela cash_registers não encontrada no Supabase, usando localStorage:", crResult.error.message);
                    cashRegisters = JSON.parse(localStorage.getItem(keys.CASH_REGISTERS)) || [];
                }
            } catch (e) {
                console.warn("Erro ao buscar cash_registers, usando localStorage:", e);
                cashRegisters = JSON.parse(localStorage.getItem(keys.CASH_REGISTERS)) || [];
            }

            // professional_blocks segue o mesmo cuidado de cash_registers: vem de
            // um script à parte (docs/add_disponibilidade.sql) e pode ainda não
            // existir. Sem o try, uma instância sem a migração quebraria a carga
            // inteira — e o salão abriria sem nenhum dado.
            let professionalBlocks = [];
            try {
                const pbResult = await supabaseClient.from('professional_blocks').select('*');
                if (!pbResult.error) {
                    professionalBlocks = pbResult.data || [];
                } else {
                    console.warn("Tabela professional_blocks não encontrada no Supabase, usando localStorage:", pbResult.error.message);
                    professionalBlocks = JSON.parse(localStorage.getItem(keys.PROFESSIONAL_BLOCKS)) || [];
                }
            } catch (e) {
                console.warn("Erro ao buscar professional_blocks, usando localStorage:", e);
                professionalBlocks = JSON.parse(localStorage.getItem(keys.PROFESSIONAL_BLOCKS)) || [];
            }

            // products segue o mesmo cuidado: vem de docs/add_produtos_e_estoque.sql
            // e pode ainda não existir. Pôr no Promise.all lá em cima faria a
            // barbearia inteira cair para o cache só porque a migração não rodou.
            //
            // No ciclo leve a tabela nem é consultada: cada produto carrega a
            // própria foto em base64. O `[]` daqui não chega à tela — o retorno
            // lá embaixo o troca por `undefined` de propósito (ver o aviso lá).
            let products = [];
            if (!cicloLeve) {
                try {
                    const prResult = await supabaseClient.from('products').select('*');
                    if (!prResult.error) {
                        products = prResult.data || [];
                    } else {
                        console.warn("Tabela products não encontrada no Supabase, usando localStorage:", prResult.error.message);
                        products = JSON.parse(localStorage.getItem(keys.PRODUCTS)) || [];
                    }
                } catch (e) {
                    console.warn("Erro ao buscar products, usando localStorage:", e);
                    products = JSON.parse(localStorage.getItem(keys.PRODUCTS)) || [];
                }
            }

            // stock_movements vem de docs/add_movimentacao_estoque.sql. Mesmo
            // cuidado dos anteriores: sem a migração, o extrato fica vazio e o
            // resto do sistema continua de pé.
            let stockMovements = [];
            try {
                const smResult = await supabaseClient.from('stock_movements').select('*');
                if (!smResult.error) {
                    stockMovements = smResult.data || [];
                } else {
                    console.warn("Tabela stock_movements não encontrada no Supabase, usando localStorage:", smResult.error.message);
                    stockMovements = JSON.parse(localStorage.getItem(keys.STOCK_MOVEMENTS)) || [];
                }
            } catch (e) {
                console.warn("Erro ao buscar stock_movements, usando localStorage:", e);
                stockMovements = JSON.parse(localStorage.getItem(keys.STOCK_MOVEMENTS)) || [];
            }

            // O núcleo de Vendas nasce na migration 14. As tabelas são
            // carregadas juntas, mas continuam OPCIONAIS: uma instância que
            // ainda não rodou o SQL abre normalmente, e a própria aba informa
            // o passo que falta. Por isso cada uma vai num try/catch próprio e
            // cai para o cache local — o mesmo cuidado que products e
            // stock_movements já recebiam acima. Pôr qualquer uma delas no
            // Promise.all lá de cima faria a barbearia inteira cair para o
            // cache só porque uma migração não rodou.
            const carregarTabelaDeVenda = async (tableName, storageKey) => {
                try {
                    const result = await supabaseClient.from(tableName).select('*');
                    if (!result.error) {
                        const rows = result.data || [];
                        localStorage.setItem(storageKey, JSON.stringify(rows));
                        return { rows: rows, ready: true };
                    }
                    console.warn(`Tabela ${tableName} indisponível; usando cache local:`, result.error.message);
                } catch (e) {
                    console.warn(`Erro ao buscar ${tableName}; usando cache local:`, e);
                }
                return { rows: doCache(storageKey) || [], ready: false };
            };

            // A RLS já recorta as linhas: o dono recebe o salão inteiro, o
            // barbeiro recebe só o que lhe cabe — não há filtro por papel a
            // fazer aqui. Caixa e crediário nem chegam para o barbeiro, porque
            // as políticas exigem meu_papel() = 'owner' (docs/27).
            const [salesResult, saleItemsResult, salePaymentsResult, commissionsResult,
                   receivablesResult, installmentsResult, receivablePaymentsResult,
                   loyaltyProgramsResult, loyaltyMovementsResult, salonMembersResult] = await Promise.all([
                carregarTabelaDeVenda('sales', keys.SALES),
                carregarTabelaDeVenda('sale_items', keys.SALE_ITEMS),
                carregarTabelaDeVenda('sale_payments', keys.SALE_PAYMENTS),
                carregarTabelaDeVenda('sale_commissions', keys.SALE_COMMISSIONS),
                carregarTabelaDeVenda('receivables', keys.RECEIVABLES),
                carregarTabelaDeVenda('receivable_installments', keys.RECEIVABLE_INSTALLMENTS),
                carregarTabelaDeVenda('receivable_payments', keys.RECEIVABLE_PAYMENTS),
                // Fidelidade (migration 25). A configuração é no máximo uma
                // linha; sem ela a aba mostra o formulário de ativar o clube.
                carregarTabelaDeVenda('loyalty_programs', keys.LOYALTY_PROGRAMS),
                carregarTabelaDeVenda('loyalty_movements', keys.LOYALTY_MOVEMENTS),
                // O quadro de quem tem login (migration 28). Antes dela a RLS
                // devolvia UMA linha — a do próprio login —, e a leitura
                // continua funcionando assim: o histórico só deixa de saber
                // traduzir o `sold_by` dos colegas, sem quebrar nada.
                carregarTabelaDeVenda('salon_members', keys.SALON_MEMBERS)
            ]);
            const salesSchemaReady = salesResult.ready && saleItemsResult.ready && salePaymentsResult.ready;

            // ⚠️ `professionals`, `products` e `businessInfo` saem daqui como
            // `undefined` no ciclo leve, DE PROPÓSITO: é a ausência do valor
            // que manda o loadData preservar o que já está na tela. Trocar
            // qualquer um dos três por `[]` ou `{}` esvazia a agenda (sem
            // barbeiro), o checkout (sem produto) e a sidebar (sem logo) a cada
            // volta do ciclo — e sem erro nenhum no console.
            return {
                services: services || [],
                professionals: cicloLeve ? undefined : (professionals || []),
                clients: clients || [],
                appointments: appointments || [],
                leads: leads || [],
                transactions: transactions || [],
                cashRegisters: cashRegisters,
                professionalBlocks: professionalBlocks,
                // `let products = []` lá em cima: sem este ternário, o ciclo
                // leve devolveria um array vazio legítimo, indistinguível de
                // "este salão não tem produto".
                products: cicloLeve ? undefined : products,
                stockMovements: stockMovements,
                sales: salesResult.rows,
                saleItems: saleItemsResult.rows,
                salePayments: salePaymentsResult.rows,
                saleCommissions: commissionsResult.rows,
                receivables: receivablesResult.rows,
                receivableInstallments: installmentsResult.rows,
                receivablePayments: receivablePaymentsResult.rows,
                loyaltyPrograms: loyaltyProgramsResult.rows,
                loyaltyMovements: loyaltyMovementsResult.rows,
                salonMembers: salonMembersResult.rows,
                salesSchemaReady: salesSchemaReady,
                commissionsSchemaReady: commissionsResult.ready,
                creditSchemaReady: receivablesResult.ready && installmentsResult.ready,
                loyaltySchemaReady: loyaltyProgramsResult.ready && loyaltyMovementsResult.ready,
                businessInfo: cicloLeve ? undefined : ((businessInfoArr && businessInfoArr[0]) || {}),
                automationRules: JSON.parse(localStorage.getItem(keys.AUTOMATION_RULES)) || [],
                messageJobs: JSON.parse(localStorage.getItem(keys.MESSAGE_JOBS)) || []
            };
        } else {
            // Fallback: Local Storage (modo offline/demo)
            const get = (key) => JSON.parse(localStorage.getItem(key));
            return {
                services: get(keys.SERVICES) || [],
                professionals: get(keys.PROFESSIONALS) || [],
                clients: get(keys.CLIENTS) || [],
                appointments: get(keys.APPOINTMENTS) || [],
                leads: get(keys.LEADS) || [],
                transactions: get(keys.TRANSACTIONS) || [],
                cashRegisters: get(keys.CASH_REGISTERS) || [],
                professionalBlocks: get(keys.PROFESSIONAL_BLOCKS) || [],
                products: get(keys.PRODUCTS) || [],
                stockMovements: get(keys.STOCK_MOVEMENTS) || [],
                sales: get(keys.SALES) || [],
                saleItems: get(keys.SALE_ITEMS) || [],
                salePayments: get(keys.SALE_PAYMENTS) || [],
                saleCommissions: get(keys.SALE_COMMISSIONS) || [],
                receivables: get(keys.RECEIVABLES) || [],
                receivableInstallments: get(keys.RECEIVABLE_INSTALLMENTS) || [],
                receivablePayments: get(keys.RECEIVABLE_PAYMENTS) || [],
                loyaltyPrograms: get(keys.LOYALTY_PROGRAMS) || [],
                loyaltyMovements: get(keys.LOYALTY_MOVEMENTS) || [],
                salonMembers: get(keys.SALON_MEMBERS) || [],
                // `true` aqui não é otimismo: no modo offline não há servidor a
                // quem perguntar se a migração rodou, e marcar como "faltando"
                // encheria a tela de aviso de migração para quem só está sem
                // internet. Quem decide de verdade é o ramo da nuvem acima.
                salesSchemaReady: true,
                commissionsSchemaReady: true,
                creditSchemaReady: true,
                loyaltySchemaReady: true,
                businessInfo: get(keys.BUSINESS_INFO) || {},
                automationRules: get(keys.AUTOMATION_RULES) || [],
                messageJobs: get(keys.MESSAGE_JOBS) || []
            };
        }
    },

    async save(key, value) {
        if (supabaseClient && this.isAuthenticated()) {
            try {
                const keyToTable = {
                    'lexion_services': 'services',
                    'lexion_professionals': 'professionals',
                    'lexion_clients': 'clients',
                    'lexion_appointments': 'appointments',
                    'lexion_leads': 'leads',
                    'lexion_transactions': 'transactions',
                    'lexion_business_info': 'business_info',
                    'lexion_cash_registers': 'cash_registers',
                    'lexion_professional_blocks': 'professional_blocks',
                    'lexion_products': 'products'
                    // stock_movements NÃO entra aqui de propósito. Este save é
                    // um upsert do array inteiro, e o extrato só aceita INSERT
                    // (ver docs/add_movimentacao_estoque.sql). Quem grava
                    // movimento na nuvem é registrarMovimentoEstoque(), uma
                    // linha por vez.
                };

                const tableName = keyToTable[key];
                if (tableName) {
                    const userId = this.getTenantId();
                    let error = null;
                    if (tableName === 'business_info' && typeof value === 'object' && !Array.isArray(value)) {
                        // Apenas envia colunas que existem na tabela do Supabase.
                        // Coluna que não existir aqui vira campo só de localStorage: fica no
                        // navegador de quem editou e não aparece para os outros logins da
                        // barbearia. Ao criar um campo novo, some a coluna em
                        // docs/add_whatsapp_messages.sql e liste-a aqui.
                        const allowedCols = ['id','user_id','name','slug','phone','instagram','address','hours',
                            'whatsappRecallMessage','whatsappBookingMessage','whatsappBirthdayMessage',
                            // Cobrança de parcela do crediário (docs/26_mensagens_editaveis.sql).
                            'whatsappChargeMessage',
                            'created_at','avatarUrl'];
                        const biz = { user_id: userId };
                        for (const col of allowedCols) {
                            if (value[col] !== undefined) biz[col] = value[col];
                        }
                        if (!biz.id) biz.id = undefined; // let DB generate UUID
                        ({ error } = await supabaseClient.from('business_info').upsert(biz, { onConflict: 'user_id' }));
                    } else if (Array.isArray(value)) {
                        // Injeta user_id em cada item antes de upsert
                        const withUserId = value.map(item => {
                            const cleaned = { ...item, user_id: userId };
                            // Remove propriedades virtuais criadas pelo frontend para não quebrar o Supabase (RLS schema)
                            if (tableName === 'clients') {
                                delete cleaned.daysSinceLast;
                                normalizaFidelidade(cleaned);
                            }
                            if (tableName === 'services') {
                                normalizaServico(cleaned);
                            }
                            // Garante que o created_at exista para cash_registers (evita erro de not-null na nuvem)
                            if (tableName === 'cash_registers' && !cleaned.created_at) {
                                cleaned.created_at = new Date().toISOString();
                            }
                            return cleaned;
                        });
                        if (withUserId.length > 0) {
                            ({ error } = await supabaseClient.from(tableName).upsert(withUserId));
                            
                            // Fallback for cash_registers if user hasn't run the migration script
                            if (error && tableName === 'cash_registers' && error.message.includes('user_id')) {
                                console.warn("Coluna user_id ausente em cash_registers, tentando sem ela...");
                                ({ error } = await supabaseClient.from(tableName).upsert(value));
                            }

                            // Sem docs/add_movimentacao_estoque.sql, transactions ainda
                            // não tem as colunas do vínculo com produto/cliente. O
                            // PostgREST recusa a linha INTEIRA por causa de um campo que
                            // não existe — e aí o dinheiro da venda não chega na nuvem.
                            // Melhor gravar o lançamento sem o vínculo do que perder o
                            // lançamento.
                            if (error && tableName === 'transactions' && /column|PGRST204/i.test(error.message || '')) {
                                console.warn("Colunas de vínculo ausentes em transactions (rode docs/add_movimentacao_estoque.sql), gravando sem elas...");
                                const semVinculo = withUserId.map(t => {
                                    const c = { ...t };
                                    delete c.productId; delete c.productQty;
                                    delete c.clientId; delete c.appointmentId;
                                    return c;
                                });
                                ({ error } = await supabaseClient.from(tableName).upsert(semVinculo));
                            }
                        }
                    }
                    // Erros do Supabase vêm no retorno, não como exceção
                    if (error) throw error;
                }
            } catch (err) {
                console.error("Erro salvando no Supabase:", err);
                window.showToast?.("Erro ao salvar na nuvem: " + (err.message || err), "danger");
            }
        }

        // Sempre mantém cópia local para performance
        localStorage.setItem(key, JSON.stringify(value));
    },

    // Migração inicial: envia dados locais para a nuvem
    async migrateToCloud(localData) {
        if (!supabaseClient || !this.isAuthenticated()) throw new Error("Não autenticado.");
        const userId = this.getTenantId();

        const addUserId = (arr, table) => arr.map(item => {
            const cleaned = { ...item, user_id: userId };
            if (table === 'clients') {
                delete cleaned.daysSinceLast;
                normalizaFidelidade(cleaned);
            }
            if (table === 'services') {
                normalizaServico(cleaned);
            }
            if (table === 'cash_registers' && !cleaned.created_at) {
                cleaned.created_at = new Date().toISOString();
            }
            return cleaned;
        });

        // Erros do Supabase vêm no retorno, não como exceção — converte
        // em exceção para o botão de migração exibir a falha
        const run = async (promise, table) => {
            const { error } = await promise;
            if (error) throw new Error(`${table}: ${error.message}`);
        };

        if (localData.businessInfo && localData.businessInfo.name) {
            // Mesma lista do upsert de `save()` acima — as duas precisam andar
            // juntas. Esta ficou para trás em três mensagens de WhatsApp, o que
            // faria a migração inicial perder texto que o dono já tinha escrito.
            const allowedCols = ['id','user_id','name','slug','phone','instagram','address','hours',
                'whatsappRecallMessage','whatsappBookingMessage','whatsappBirthdayMessage',
                'whatsappChargeMessage','created_at','avatarUrl'];
            const biz = { user_id: userId };
            for (const col of allowedCols) {
                if (localData.businessInfo[col] !== undefined) biz[col] = localData.businessInfo[col];
            }
            if (!biz.id) biz.id = undefined;
            await run(supabaseClient.from('business_info').upsert(biz, { onConflict: 'user_id' }), 'business_info');
        }
        if (localData.services.length) await run(supabaseClient.from('services').upsert(addUserId(localData.services, 'services')), 'services');
        if (localData.professionals.length) await run(supabaseClient.from('professionals').upsert(addUserId(localData.professionals, 'professionals')), 'professionals');
        if (localData.clients.length) await run(supabaseClient.from('clients').upsert(addUserId(localData.clients, 'clients')), 'clients');
        if (localData.appointments.length) await run(supabaseClient.from('appointments').upsert(addUserId(localData.appointments, 'appointments')), 'appointments');
        if (localData.leads.length) await run(supabaseClient.from('leads').upsert(addUserId(localData.leads, 'leads')), 'leads');
        if (localData.transactions.length) await run(supabaseClient.from('transactions').upsert(addUserId(localData.transactions, 'transactions')), 'transactions');
        if (localData.cashRegisters && localData.cashRegisters.length) {
            try {
                await run(supabaseClient.from('cash_registers').upsert(addUserId(localData.cashRegisters, 'cash_registers')), 'cash_registers');
            } catch (err) {
                if (err.message.includes('user_id')) {
                    console.warn("Fallback de migração: tentando cash_registers sem user_id");
                    await run(supabaseClient.from('cash_registers').upsert(localData.cashRegisters), 'cash_registers');
                } else {
                    throw err;
                }
            }
        }
    },

    // -------------------------
    // LINK PÚBLICO DE AGENDAMENTO (sem login)
    // As duas funções chamam RPCs no Supabase criadas por
    // docs/public_booking_setup.sql
    // -------------------------

    // Retorna { businessInfo, services, professionals, bookedSlots }
    // ou null se o slug não existir
    async getPublicSalon(slug) {
        if (!supabaseClient) return null;
        const { data, error } = await supabaseClient.rpc('get_public_salon', { p_slug: slug });
        if (error) throw error;
        
        // Fallback for older SQL schemas that don't return avatarUrl in the RPC:
        if (data && data.businessInfo && !data.businessInfo.avatarUrl) {
            try {
                const { data: bizData } = await supabaseClient.from('business_info').select('avatarUrl').eq('slug', slug).single();
                if (bizData && bizData.avatarUrl) {
                    data.businessInfo.avatarUrl = bizData.avatarUrl;
                }
            } catch (e) {
                console.warn('Não foi possível buscar a avatarUrl separadamente', e);
            }
        }
        
        return data;
    },

    // Retorna true se o telefone já existe, false se é novo cliente
    async checkPublicClientExists(slug, phone) {
        if (!supabaseClient) return false;
        const { data, error } = await supabaseClient.rpc('check_client_exists', { p_slug: slug, p_phone: phone });
        if (error) {
            console.error("Erro ao checar cliente público:", error);
            return false;
        }
        return data;
    },

    // Checa se o cliente (pelo telefone) já tem agendamento na mesma semana.
    // Retorna { hasAppointments: bool, appointments: [] }
    async checkWeekAppointments(slug, phone, date) {
        if (!supabaseClient) return { hasAppointments: false };
        try {
            const { data, error } = await supabaseClient.rpc('check_week_appointments', {
                p_slug: slug, p_phone: phone, p_date: date
            });
            if (error) {
                console.warn("Erro ao checar agendamentos da semana:", error);
                return { hasAppointments: false };
            }
            return data || { hasAppointments: false };
        } catch (e) {
            console.warn("check_week_appointments não disponível:", e);
            return { hasAppointments: false };
        }
    },

    // Grava cliente + agendamento + lead na conta do salão dono do slug.
    // Retorna { ok: true, appointmentId, profId } ou { ok: false, error }
    async createPublicBooking(slug, booking) {
        if (!supabaseClient) throw new Error("Supabase não configurado.");
        const { data, error } = await supabaseClient.rpc('create_public_booking', {
            p_slug: slug,
            p_name: booking.name,
            p_phone: booking.phone,
            p_service_id: booking.serviceId,
            p_prof_id: booking.profId,
            p_date: booking.date,
            p_time: booking.time,
            p_birth: booking.birth || null
        });
        if (error) throw error;
        return data;
    },

    async upsertItem(table, item) {
        if (supabaseClient && this.isAuthenticated()) {
            const withUser = { ...item, user_id: this.getTenantId() };
            const { error } = await supabaseClient.from(table).upsert(withUser);
            if (error) throw error;
        }
    },

    async deleteItem(table, id) {
        if (supabaseClient && this.isAuthenticated()) {
            const { error } = await supabaseClient.from(table).delete().eq('id', id);
            if (error) throw error;
        }
    }
};
