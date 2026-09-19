// ============================================================
// EDGE FUNCTION: acesso-profissional
//
// Cria, suspende, reativa e apaga o LOGIN de um profissional.
//
// POR QUE ISTO NAO E UMA RPC DE POSTGRES: criar conta mexe em `auth.users`, que
// nenhuma politica de RLS alcanca e nenhuma chave de navegador pode tocar. Quem
// faz isso e a chave de SERVICO, e ela nunca pode sair do servidor — se ela
// estivesse no `api.js`, qualquer visitante do link publico teria poder total
// sobre o banco inteiro. Por isso ela mora aqui, e a Supabase injeta
// `SUPABASE_SERVICE_ROLE_KEY` sozinha no ambiente da funcao: nao ha secret para
// o dono cadastrar a mao, e nao ha chave escrita em arquivo nenhum do projeto.
//
// TODA acao confere DUAS coisas antes de agir, e nessa ordem:
//   1. quem chamou e `owner` de algum salao (o JWT diz quem e; o banco diz o
//      papel — o navegador nao opina sobre isso);
//   2. o profissional alvo pertence AO SALAO DE QUEM CHAMOU.
// Sem o passo 2, um dono conseguiria apagar o login do funcionario de outro
// salao so mandando um id que ele nao deveria conhecer.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function responder(corpo: unknown, status = 200): Response {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' }
    });
}

/* Senha temporaria de primeiro acesso.

   Sorteada no servidor e devolvida UMA vez, para o dono passar ao profissional.
   Nao e a senha definitiva: o profissional troca pelo "Esqueci minha senha" da
   tela de login, que ja existe desde a recuperacao de senha.

   `crypto.getRandomValues` e nao `Math.random()`: a segunda e previsivel o
   suficiente para que alguem que saiba a hora do cadastro tente adivinhar. */
function senhaTemporaria(): string {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = new Uint8Array(14);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alfabeto[b % alfabeto.length]).join('');
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return responder({ erro: 'Use POST.' }, 405);

    const url = Deno.env.get('SUPABASE_URL')!;
    const chaveDeServico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, chaveDeServico, { auth: { persistSession: false } });

    // --- 1. Quem esta chamando ---------------------------------------------
    const autorizacao = req.headers.get('Authorization') || '';
    const token = autorizacao.replace(/^Bearer\s+/i, '');
    if (!token) return responder({ erro: 'Sessao ausente.' }, 401);

    const { data: quemChamou, error: erroDeSessao } = await admin.auth.getUser(token);
    if (erroDeSessao || !quemChamou?.user) return responder({ erro: 'Sessao invalida.' }, 401);
    const idDeQuemChamou = quemChamou.user.id;

    // --- 2. Ele e dono de um salao? ----------------------------------------
    // O papel vem do BANCO, nunca do corpo do pedido.
    const { data: vinculo } = await admin
        .from('salon_members')
        .select('salon_id, role')
        .eq('user_id', idDeQuemChamou)
        .maybeSingle();

    if (!vinculo || vinculo.role !== 'owner') {
        return responder({ erro: 'Somente o dono do salao gerencia acessos.' }, 403);
    }
    const salao = vinculo.salon_id;

    let corpo: Record<string, unknown>;
    try {
        corpo = await req.json();
    } catch {
        return responder({ erro: 'Corpo invalido.' }, 400);
    }

    const acao = String(corpo.acao || '');
    const profissionalId = String(corpo.professionalId || '').trim();
    const email = String(corpo.email || '').trim().toLowerCase();

    // --- 3. Listar o quadro -------------------------------------------------
    // Devolve o que a RLS nao alcanca: o e-mail de cada login e se ele esta
    // suspenso. O `salon_members` que o navegador le (script 28) tem so o
    // vinculo; o estado da CONTA mora em `auth.users`.
    if (acao === 'listar') {
        const { data: membros } = await admin
            .from('salon_members')
            .select('user_id, professional_id, role')
            .eq('salon_id', salao);

        const quadro = [];
        for (const membro of membros || []) {
            if (!membro.professional_id) continue;
            const { data: conta } = await admin.auth.admin.getUserById(membro.user_id);
            const banidoAte = conta?.user?.banned_until ? new Date(conta.user.banned_until) : null;
            quadro.push({
                professionalId: membro.professional_id,
                userId: membro.user_id,
                email: conta?.user?.email || '',
                suspenso: !!(banidoAte && banidoAte.getTime() > Date.now())
            });
        }
        return responder({ quadro });
    }

    if (!profissionalId) return responder({ erro: 'Profissional nao informado.' }, 400);

    // --- 4. O profissional alvo e DESTE salao? -----------------------------
    const { data: profissional } = await admin
        .from('professionals')
        .select('id, name')
        .eq('id', profissionalId)
        .eq('user_id', salao)
        .maybeSingle();

    if (!profissional) return responder({ erro: 'Profissional nao encontrado neste salao.' }, 404);

    // O vinculo ja existente deste profissional, se houver.
    const { data: vinculoDoProfissional } = await admin
        .from('salon_members')
        .select('user_id')
        .eq('salon_id', salao)
        .eq('professional_id', profissionalId)
        .maybeSingle();

    // --- 5. Criar o login ---------------------------------------------------
    if (acao === 'criar') {
        if (vinculoDoProfissional) {
            return responder({ erro: 'Este profissional ja tem acesso ao sistema.' }, 409);
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return responder({ erro: 'E-mail invalido.' }, 400);
        }

        const senha = senhaTemporaria();
        const { data: contaNova, error: erroDaConta } = await admin.auth.admin.createUser({
            email,
            password: senha,
            email_confirm: true,   // sem isto o profissional so entraria depois de clicar num e-mail
            user_metadata: { professional_name: profissional.name, salon_id: salao }
        });

        if (erroDaConta || !contaNova?.user) {
            // O caso mais comum aqui e e-mail ja cadastrado. NAO adotamos a
            // conta existente de proposito: ela pode ser o login de outro salao,
            // e vincula-la aqui entregaria os dados deste salao a um estranho.
            const mensagem = /already|registered|exists/i.test(erroDaConta?.message || '')
                ? 'Ja existe uma conta com este e-mail. Use outro endereco.'
                : (erroDaConta?.message || 'Nao foi possivel criar o login.');
            return responder({ erro: mensagem }, 409);
        }

        const { error: erroDoVinculo } = await admin.from('salon_members').insert({
            user_id: contaNova.user.id,
            salon_id: salao,
            role: 'staff',
            professional_id: profissionalId
        });

        if (erroDoVinculo) {
            // Conta criada e vinculo falhou = login orfao, que entraria no
            // sistema como DONO de um salao vazio (ver `salao_do_usuario`, que
            // cai no proprio uid quando nao ha vinculo). Desfaz.
            await admin.auth.admin.deleteUser(contaNova.user.id);
            return responder({ erro: 'Falha ao vincular o login: ' + erroDoVinculo.message }, 500);
        }

        await admin.from('professionals').update({ email }).eq('id', profissionalId).eq('user_id', salao);

        return responder({ ok: true, email, senha, userId: contaNova.user.id });
    }

    if (!vinculoDoProfissional) {
        return responder({ erro: 'Este profissional ainda nao tem acesso ao sistema.' }, 404);
    }
    const idDaConta = vinculoDoProfissional.user_id;

    // --- 6. Suspender e devolver o acesso -----------------------------------
    // Suspender e o caminho REVERSIVEL, e e o que o sistema faz sozinho quando o
    // dono desmarca "Ativo" no cadastro. O vinculo e o historico ficam de pe: o
    // profissional afastado volta com um clique, sem recadastro.
    if (acao === 'suspender' || acao === 'reativar') {
        const { error } = await admin.auth.admin.updateUserById(idDaConta, {
            ban_duration: acao === 'suspender' ? '876000h' : 'none'   // 100 anos ~= permanente
        });
        if (error) return responder({ erro: error.message }, 500);
        return responder({ ok: true, suspenso: acao === 'suspender' });
    }

    // --- 7. Apagar o login --------------------------------------------------
    // Definitivo, e so acontece quando o dono EXCLUI o profissional do cadastro.
    // O vinculo some junto (ON DELETE CASCADE), mas as VENDAS ficam: `sold_by` e
    // ON DELETE SET NULL (script 27), entao o historico do dinheiro sobrevive a
    // saida da pessoa — a venda continua la, sem dono registrado.
    if (acao === 'excluir') {
        const { error } = await admin.auth.admin.deleteUser(idDaConta);
        if (error) return responder({ erro: error.message }, 500);
        return responder({ ok: true });
    }

    return responder({ erro: 'Acao desconhecida: ' + acao }, 400);
});
