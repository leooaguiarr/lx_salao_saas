/**
 * ==========================================================================
 * CREDIÁRIO (Fase E)
 *
 * A aba Crediário: quem ficou devendo, quanto, para quando — e o recebimento.
 *
 *    ⚠️ AQUI NÃO SE BAIXA PARCELA. Quem recebe é a RPC receber_crediario
 *    (docs/sql/23), numa transação só: ela baixa a parcela, atualiza o saldo da
 *    conta, grava o recebimento, lança no Financeiro e amarra ao caixa aberto.
 *
 *    Baixar localmente e depois "sincronizar" seria o pior caminho possível:
 *    numa falha de rede o dono veria a dívida quitada e o cliente continuaria
 *    devendo no banco. Por isso um recebimento recusado NÃO muda nada na tela.
 *
 * Carregado por <script> em index.html, na ordem do numero do arquivo.
 * Tudo compartilha o mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

const crediarioFiltros = { status: 'open', client: 'all' };

// Qual parcela o modal de recebimento está tratando.
let parcelaEmRecebimento = null;

/* --- Cobrança de parcela por WhatsApp (Fase G) ------------------------------
   Usada tanto no card do Dashboard quanto na tabela desta aba — mesmo texto
   nos dois lugares, para o cliente não receber mensagens diferentes conforme
   de onde o balcão clicou. Sem telefone cadastrado não há botão: um link que
   abre o WhatsApp em branco só faz perder o clique.

   O texto é editável em Configurações → Cobrança desde a migration 26. Até
   então era esta string fixa, e o dono não tinha como mudar o tom nem incluir
   a chave PIX do salão. O modelo abaixo é o de fábrica: vale enquanto ninguém
   editou nada, e é ele que a barbearia vê ao abrir a aba pela primeira vez. */
const MSG_COBRANCA_PADRAO =
    'Olá {nome}! Aqui é da {salao}. Passando para lembrar da parcela {parcela} ' +
    'do crediário, no valor de {valor}, com vencimento em {vencimento}. ' +
    'Qualquer dúvida, é só chamar!';

function modeloDeCobranca() {
    return (data.businessInfo && data.businessInfo.whatsappChargeMessage) || MSG_COBRANCA_PADRAO;
}

function mensagemDeCobrancaDeParcela(nomeCliente, parcela) {
    return aplicarTagsWhatsApp(modeloDeCobranca(), {
        nome: primeiroNomeApresentavel(nomeCliente),
        parcela: parcela.number,
        valor: formatCurrency(Number(parcela.open_amount) || 0),
        vencimento: formatDateStringToBR(parcela.due_date)
    });
}

function htmlBotaoCobrancaWhatsApp(telefone, nomeCliente, parcela) {
    if (!telefone) return '';
    const texto = encodeURIComponent(mensagemDeCobrancaDeParcela(nomeCliente, parcela));
    return `<a class="btn btn-sm btn-secondary" target="_blank" rel="noopener"
               href="https://wa.me/55${String(telefone).replace(/\D/g, '')}?text=${texto}"
               title="Cobrar parcela por WhatsApp">
               <i class="fa-brands fa-whatsapp"></i>
           </a>`;
}

/* --- BASE DE CÁLCULO ------------------------------------------------------ */

// "Atrasada" não é um campo guardado: é a parcela em aberto cuja data já
// passou. Guardar isso numa coluna exigiria alguém rodando um UPDATE todo dia,
// e no dia em que esquecesse a tela mentiria. Aqui a verdade vira sozinha à
// meia-noite.
function parcelaAtrasada(parcela) {
    if (parcela.status !== 'open') return false;
    return String(parcela.due_date || '') < getLocalDateString(new Date());
}

function parcelaVenceEm(parcela, dias) {
    if (parcela.status !== 'open') return false;
    const hoje = getLocalDateString(new Date());
    const limite = new Date();
    limite.setDate(limite.getDate() + dias);
    const venc = String(parcela.due_date || '');
    return venc >= hoje && venc <= getLocalDateString(limite);
}

function parcelasDoCrediario() {
    return (data.receivableInstallments || []).slice()
        .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
}

function resumoDoCrediario() {
    const parcelas = parcelasDoCrediario();
    const emAberto = parcelas.filter(p => p.status === 'open');

    const soma = (lista) => lista.reduce((s, p) => s + (Number(p.open_amount) || 0), 0);
    const clientes = new Set(
        (data.receivables || []).filter(r => r.status === 'open').map(r => r.client_id)
    );

    return {
        atrasado: soma(emAberto.filter(parcelaAtrasada)),
        proximo: soma(emAberto.filter(p => parcelaVenceEm(p, 7))),
        aberto: soma(emAberto),
        clientes: clientes.size,
        qtdAtrasadas: emAberto.filter(parcelaAtrasada).length
    };
}

function crediarioFiltrado() {
    return parcelasDoCrediario().filter(p => {
        if (crediarioFiltros.client !== 'all') {
            const conta = (data.receivables || []).find(r => r.id === p.receivable_id);
            if (!conta || conta.client_id !== crediarioFiltros.client) return false;
        }
        if (crediarioFiltros.status === 'all') return true;
        if (crediarioFiltros.status === 'overdue') return parcelaAtrasada(p);
        return p.status === crediarioFiltros.status;
    });
}

/* --- Tela ---------------------------------------------------------------- */

function renderCrediario() {
    const aviso = document.getElementById('crediario-schema-warning');
    if (aviso) aviso.hidden = data.creditSchemaReady !== false;

    renderResumoDoCrediario();
    renderFiltrosDoCrediario();
    renderTabelaDoCrediario();
    atualizarBadgeDoCrediario();
}

function renderResumoDoCrediario() {
    const r = resumoDoCrediario();
    const põe = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.innerText = valor;
    };
    põe('cred-total-atrasado', formatCurrency(r.atrasado));
    põe('cred-total-proximo', formatCurrency(r.proximo));
    põe('cred-total-aberto', formatCurrency(r.aberto));
    põe('cred-qtd-clientes', String(r.clientes));
}

function renderFiltrosDoCrediario() {
    const select = document.getElementById('cred-filter-client');
    if (!select) return;

    // Só clientes que realmente devem: uma lista com o CRM inteiro faria
    // procurar o devedor no meio de quem nunca comprou fiado.
    const devedores = new Map();
    (data.receivables || []).forEach(r => {
        if (r.client_id) devedores.set(r.client_id, r.client_name || 'Cliente');
    });

    const escolhido = select.value || 'all';
    select.innerHTML = '<option value="all">Todos os clientes</option>' +
        [...devedores.entries()]
            .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'))
            .map(([id, nome]) => `<option value="${escapeHTML(id)}">${escapeHTML(nome)}</option>`)
            .join('');
    select.value = escolhido;
}

function renderTabelaDoCrediario() {
    const corpo = document.getElementById('crediario-body');
    if (!corpo) return;

    const linhas = crediarioFiltrado();
    const contador = document.getElementById('crediario-result-count');
    if (contador) {
        contador.innerText = `${linhas.length} ${linhas.length === 1 ? 'parcela' : 'parcelas'}`;
    }

    if (!linhas.length) {
        corpo.innerHTML = `
            <tr><td colspan="8" class="sales-empty-cell">
                <i class="fa-solid fa-file-invoice-dollar"></i>
                Nenhuma parcela para os filtros selecionados.
            </td></tr>`;
        return;
    }

    corpo.innerHTML = linhas.map(p => {
        const conta = (data.receivables || []).find(r => r.id === p.receivable_id) || {};
        const venda = (data.sales || []).find(s => s.id === p.sale_id);
        const numero = venda && venda.sale_number
            ? '#' + String(venda.sale_number).padStart(6, '0')
            : '—';
        const cliente = (data.clients || []).find(c => c.id === conta.client_id);

        const atrasada = parcelaAtrasada(p);
        const paga = p.status === 'paid';
        const total = (data.receivableInstallments || [])
            .filter(x => x.receivable_id === p.receivable_id).length;

        return `
            <tr class="${atrasada ? 'parcela-atrasada' : ''} ${paga ? 'parcela-paga' : ''}">
                <td data-label="Venda">${escapeHTML(numero)}</td>
                <td data-label="Cliente">${escapeHTML(conta.client_name || '—')}</td>
                <td data-label="Parcela">${p.number}/${total}</td>
                <td data-label="Vencimento">${escapeHTML(formatDateStringToBR(p.due_date))}</td>
                <td data-label="Valor">${formatCurrency(Number(p.amount) || 0)}</td>
                <td data-label="Em aberto">${formatCurrency(Number(p.open_amount) || 0)}</td>
                <td data-label="Situação">
                    <span class="status-badge ${paga ? 'done' : (atrasada ? 'no_show' : 'pending')}">
                        ${paga ? 'Paga' : (atrasada ? 'Atrasada' : 'Em aberto')}
                    </span>
                </td>
                <td data-label="Ação" style="text-align:right;">
                    ${paga ? '' : `
                        ${cliente && cliente.phone ? htmlBotaoCobrancaWhatsApp(cliente.phone, cliente.name, p) : ''}
                        <button class="btn btn-sm btn-primary"
                                onclick="abrirRecebimento('${escapeHTML(p.id)}')">
                            <i class="fa-solid fa-hand-holding-dollar"></i> Receber
                        </button>`}
                </td>
            </tr>`;
    }).join('');
}

// O contador no menu conta ATRASADAS, não parcelas em aberto. Um número que
// nunca zera vira decoração e deixa de ser lido — o que atrasou é o que pede
// ação hoje.
function atualizarBadgeDoCrediario() {
    const badge = document.getElementById('badge-crediario');
    if (!badge) return;

    const atrasadas = resumoDoCrediario().qtdAtrasadas;
    badge.innerText = String(atrasadas);
    badge.style.display = atrasadas > 0 ? '' : 'none';
}

/* --- Receber -------------------------------------------------------------- */

window.abrirRecebimento = function (parcelaId) {
    const parcela = (data.receivableInstallments || []).find(p => p.id === parcelaId);
    if (!parcela) return;

    parcelaEmRecebimento = parcela;
    const conta = (data.receivables || []).find(r => r.id === parcela.receivable_id) || {};
    const saldo = Number(parcela.open_amount) || 0;

    const resumo = document.getElementById('receber-resumo');
    if (resumo) {
        resumo.innerHTML = `
            <div class="receber-linha"><span>Cliente</span><strong>${escapeHTML(conta.client_name || '—')}</strong></div>
            <div class="receber-linha"><span>Parcela</span><strong>${parcela.number}</strong></div>
            <div class="receber-linha"><span>Vencimento</span><strong>${escapeHTML(formatDateStringToBR(parcela.due_date))}</strong></div>
            <div class="receber-linha receber-saldo"><span>Em aberto</span><strong>${formatCurrency(saldo)}</strong></div>`;
    }

    // O valor já vem com o saldo inteiro: receber a parcela toda é o caso
    // comum, e digitar o número de novo só cria chance de errar.
    const campoValor = document.getElementById('receber-valor');
    if (campoValor) {
        campoValor.value = saldo.toFixed(2);
        campoValor.max = saldo;
    }
    const entregue = document.getElementById('receber-entregue');
    if (entregue) entregue.value = '';

    atualizarAvisoDoRecebimento();
    openModal('modal-receber-parcela');
};

function atualizarAvisoDoRecebimento() {
    const metodo = document.getElementById('receber-metodo')?.value;
    const bloco = document.getElementById('receber-bloco-dinheiro');
    const aviso = document.getElementById('receber-aviso');
    if (bloco) bloco.hidden = metodo !== 'cash';
    if (!aviso || !parcelaEmRecebimento) return;

    const valor = parseFloat(document.getElementById('receber-valor')?.value) || 0;
    const saldo = Number(parcelaEmRecebimento.open_amount) || 0;

    if (valor > saldo) {
        aviso.innerHTML = `<strong>Acima do saldo.</strong> Esta parcela tem ${formatCurrency(saldo)} em aberto.`;
        aviso.style.color = 'var(--danger)';
        return;
    }
    if (valor > 0 && valor < saldo) {
        aviso.innerHTML = `Recebimento parcial: sobram ${formatCurrency(saldo - valor)} nesta parcela.`;
        aviso.style.color = 'var(--warning)';
        return;
    }

    // Dinheiro com o caixa fechado entra como pendente, mesma regra da venda.
    // Avisar aqui evita a pergunta "por que não apareceu na gaveta?".
    const caixaAberto = typeof getCurrentCashRegister === 'function' && getCurrentCashRegister();
    if (metodo === 'cash' && !caixaAberto) {
        aviso.innerHTML = 'O caixa está fechado: o dinheiro entra como pendente até você abrir.';
        aviso.style.color = 'var(--warning)';
        return;
    }
    aviso.innerHTML = 'O valor entra no Financeiro na data de hoje.';
    aviso.style.color = '';
}

async function confirmarRecebimento() {
    if (!parcelaEmRecebimento) return;

    const botao = document.getElementById('btn-confirmar-recebimento');
    const metodo = document.getElementById('receber-metodo').value;
    const valor = parseFloat(document.getElementById('receber-valor').value) || 0;
    const entregueBruto = document.getElementById('receber-entregue').value;
    const saldo = Number(parcelaEmRecebimento.open_amount) || 0;

    if (valor <= 0) {
        showToast('Informe um valor maior que zero.', 'warning');
        return;
    }
    if (valor > saldo) {
        showToast(`O recebimento passa do saldo da parcela (${formatCurrency(saldo)}).`, 'warning');
        return;
    }

    const pagamento = { paymentMethod: metodo, amount: valor };
    if (metodo === 'cash' && entregueBruto !== '') {
        pagamento.cashReceived = parseFloat(entregueBruto) || valor;
    }

    // A chave amarra ESTE recebimento: parcela + valor + instante. Apertar duas
    // vezes manda a mesma chave, e o banco devolve "repetida" em vez de receber
    // de novo.
    const payload = {
        installmentId: parcelaEmRecebimento.id,
        idempotencyKey: 'receb-' + parcelaEmRecebimento.id + '-' + Date.now().toString(36),
        competenceDate: getLocalDateString(new Date()),
        payments: [pagamento]
    };

    if (botao) {
        botao.disabled = true;
        botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recebendo...';
    }

    try {
        const retorno = await DataService.receberCrediario(payload);

        if (!retorno || !retorno.ok) {
            // Nada muda na tela quando o servidor recusa. Baixar aqui deixaria o
            // dono achando que recebeu e o cliente devendo no banco.
            showToast(
                retorno && retorno.faltaMigration
                    ? 'Execute a migração mestre supabase/migrations/00_MASTER_ALL_IN_ONE.sql no Supabase para receber crediário.'
                    : ((retorno && retorno.motivo) || 'Não foi possível registrar o recebimento.'),
                'danger'
            );
            return;
        }

        showToast(
            retorno.repetida
                ? 'Este recebimento já havia sido registrado. Nada foi cobrado de novo.'
                : `${formatCurrency(valor)} recebidos.` +
                  (Number(retorno.saldoDaConta) > 0
                      ? ` Restam ${formatCurrency(Number(retorno.saldoDaConta))} desta venda.`
                      : ' Dívida quitada.'),
            retorno.repetida ? 'info' : 'success'
        );

        closeModal('modal-receber-parcela');
        parcelaEmRecebimento = null;

        // Recarrega do banco em vez de espelhar na mão: o recebimento mexeu em
        // quatro tabelas (parcela, conta, recebimento e financeiro), e refazer
        // essa conta aqui é a receita para as duas versões divergirem.
        if (typeof loadData === 'function') await loadData();
        renderCrediario();
        if (typeof renderFinance === 'function') renderFinance();
    } catch (erro) {
        console.error('Falha ao receber crediário:', erro);
        showToast(erro.message || 'Não foi possível registrar o recebimento.', 'danger');
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.innerHTML = '<i class="fa-solid fa-circle-check"></i> Confirmar recebimento';
        }
    }
}

/* --- Ligações da tela ----------------------------------------------------- */

['cred-filter-status', 'cred-filter-client'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', function () {
        crediarioFiltros[id === 'cred-filter-status' ? 'status' : 'client'] = this.value;
        renderCrediario();
    });
});

document.getElementById('receber-metodo')?.addEventListener('change', atualizarAvisoDoRecebimento);
document.getElementById('receber-valor')?.addEventListener('input', atualizarAvisoDoRecebimento);
document.getElementById('btn-confirmar-recebimento')?.addEventListener('click', () => {
    confirmarRecebimento().catch(err => {
        console.error('Falha no recebimento:', err);
        showToast('Não foi possível registrar o recebimento.', 'danger');
    });
});
