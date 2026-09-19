/**
 * ==========================================================================
 * COMISSÕES (Fase D)
 *
 * A aba Comissões e a leitura do razão gravado em `sale_commissions`.
 *
 *    ⚠️ AQUI NÃO SE CALCULA COMISSÃO. O percentual e a base foram congelados
 *    no instante da venda (docs/sql/15) e viraram linha no razão pelo gatilho
 *    do banco (docs/sql/21). Esta tela só soma e mostra.
 *
 *    Recalcular aqui — pegando `professional.commission` do cadastro — traria
 *    de volta exatamente o problema que a fase veio resolver: mudar o
 *    percentual amanhã mudaria o repasse de ontem, e o profissional veria um
 *    número diferente a cada vez que abrisse a tela.
 *
 * Carregado por <script> em index.html, na ordem do numero do arquivo.
 * Tudo compartilha o mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

// Abre no dia, pela mesma razão do histórico de Vendas: o uso de balcão é
// conferir o que saiu hoje. O fechamento do mês é um clique no período.
const comissaoFiltros = { period: 'today', professional: 'all', status: 'pending' };

// O que está marcado para receber baixa. Vive só enquanto a tela está aberta:
// mudar de filtro ou de aba esvazia, porque marcar uma linha que sumiu da
// listagem e depois pagar seria uma baixa às cegas.
let comissoesSelecionadas = new Set();

/* --- BASE DE CÁLCULO ------------------------------------------------------
   Uma pergunta, uma resposta: a tela, os indicadores e o teste leem daqui. */

/* O dia em que a venda aconteceu, no fuso de quem está olhando.

   `sold_at` é um timestamp UTC. Cortar os 10 primeiros caracteres dele dá a
   data EM UTC — e no Brasil (UTC-3) tudo que é vendido depois das 21h já é
   "amanhã" lá. Uma venda das 21h30 de segunda apareceria como terça, sumiria do
   filtro "hoje" e cairia no dia errado do fechamento.

   Uma data pura ('2026-09-07') passa direto: ela não tem fuso para converter, e
   `new Date()` a interpretaria como meia-noite UTC, trazendo de volta o mesmo
   erro pelo outro lado. */
function diaLocalDaVenda(valor) {
    const texto = String(valor || '');
    if (!texto) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

    const d = new Date(texto);
    return isNaN(d.getTime()) ? texto.substring(0, 10) : getLocalDateString(d);
}

function comissaoNoPeriodo(linha, periodo) {
    if (periodo === 'all') return true;

    const dia = diaLocalDaVenda(linha.sold_at);
    if (!dia) return false;

    const hoje = getLocalDateString(new Date());
    if (periodo === 'today') return dia === hoje;

    const corte = new Date();
    corte.setDate(corte.getDate() - Number(periodo));
    return dia >= getLocalDateString(corte);
}

function comissoesFiltradas() {
    return (data.saleCommissions || [])
        .filter(c => comissaoNoPeriodo(c, comissaoFiltros.period))
        .filter(c => comissaoFiltros.professional === 'all' || c.professional_id === comissaoFiltros.professional)
        .filter(c => comissaoFiltros.status === 'all' || c.status === comissaoFiltros.status)
        .sort((a, b) => String(b.sold_at || '').localeCompare(String(a.sold_at || '')));
}

// Os indicadores ignoram o filtro de SITUAÇÃO de propósito: "a pagar" e "já
// pago" precisam aparecer lado a lado, senão escolher "Pagas" zeraria o card de
// pendente e daria a impressão de que não há nada a pagar.
function resumoDeComissoes() {
    const base = (data.saleCommissions || [])
        .filter(c => comissaoNoPeriodo(c, comissaoFiltros.period))
        .filter(c => comissaoFiltros.professional === 'all' || c.professional_id === comissaoFiltros.professional);

    const soma = (lista, campo) => lista.reduce((s, c) => s + (Number(c[campo]) || 0), 0);

    return {
        pendente: soma(base.filter(c => c.status === 'pending'), 'amount'),
        pago: soma(base.filter(c => c.status === 'paid'), 'amount'),
        itens: base.length,
        base: soma(base, 'base_amount')
    };
}

/* Atendimentos antigos, anteriores à Fase B.

   Eles foram pagos pela confirmação do atendimento, quando ainda não havia
   venda nem congelamento de percentual. A comissão deles não está no razão e
   não tem como estar: o percentual que valia naquele dia não foi guardado.

   Contá-los aqui seria inventar; escondê-los faria o dono achar que o mês está
   menor do que é. Então eles viram um aviso, com a conta declarada como
   estimativa. */
function atendimentosAntigosNoPeriodo() {
    const vendidos = new Set(
        (data.sales || []).map(s => s.appointment_id).filter(Boolean)
    );

    return (data.appointments || []).filter(a => {
        if (!atendimentoRealizado(a)) return false;
        if (vendidos.has(a.id)) return false;      // já virou venda: está no razão
        return comissaoNoPeriodo({ sold_at: a.date }, comissaoFiltros.period);
    });
}

/* --- Tela ---------------------------------------------------------------- */

function renderComissoes() {
    // `ehBarbeiro()` e o nome que a Alabama usa para o que o clone chamava de
    // `ehAcessoRestrito()` — mesma regra, so um nome por conceito.
    const ehDono = !(DataService.isAuthenticated() && DataService.ehBarbeiro());

    const aviso = document.getElementById('comissoes-schema-warning');
    if (aviso) aviso.hidden = data.commissionsSchemaReady !== false;

    renderFiltrosDeComissao(ehDono);
    renderResumoDeComissoes();
    renderTabelaDeComissoes(ehDono);
    renderAvisoDeComissaoAntiga();
    atualizarBotaoDePagar(ehDono);
}

function renderFiltrosDeComissao(ehDono) {
    const select = document.getElementById('com-filter-professional');
    const campo = document.getElementById('com-filter-prof-field');
    if (!select || !campo) return;

    // O profissional não escolhe profissional: ele só tem as próprias linhas, e
    // um seletor com o nome dos colegas sugeriria que dá para ver as deles.
    campo.style.display = ehDono ? '' : 'none';
    if (!ehDono) return;

    const escolhido = select.value || 'all';
    select.innerHTML = '<option value="all">Todos os profissionais</option>' +
        [...(data.professionals || [])]
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
            .map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`)
            .join('');
    select.value = escolhido;
}

function renderResumoDeComissoes() {
    const r = resumoDeComissoes();
    const põe = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.innerText = valor;
    };
    põe('com-total-pendente', formatCurrency(r.pendente));
    põe('com-total-pago', formatCurrency(r.pago));
    põe('com-qtd-itens', String(r.itens));
    põe('com-total-base', formatCurrency(r.base));
}

function renderTabelaDeComissoes(ehDono) {
    const corpo = document.getElementById('comissoes-body');
    if (!corpo) return;

    const linhas = comissoesFiltradas();
    const contador = document.getElementById('comissoes-result-count');
    if (contador) {
        contador.innerText = `${linhas.length} ${linhas.length === 1 ? 'registro' : 'registros'}`;
    }

    // A coluna de marcar só existe para quem pode dar baixa.
    const th = document.getElementById('com-th-check');
    if (th) th.style.display = ehDono ? '' : 'none';

    if (!linhas.length) {
        corpo.innerHTML = `
            <tr><td colspan="11" class="sales-empty-cell">
                <i class="fa-solid fa-hand-holding-dollar"></i>
                Nenhuma comissão para os filtros selecionados.
            </td></tr>`;
        return;
    }

    corpo.innerHTML = linhas.map(c => {
        const paga = c.status === 'paid';
        const marcada = comissoesSelecionadas.has(c.id);
        const venda = (data.sales || []).find(s => s.id === c.sale_id);
        const numero = venda && venda.sale_number
            ? '#' + String(venda.sale_number).padStart(6, '0')
            : '—';

        return `
            <tr class="${paga ? 'comissao-paga' : ''}">
                <td class="com-col-check" data-label="" style="${ehDono ? '' : 'display:none;'}">
                    <input type="checkbox" class="com-check" value="${escapeHTML(c.id)}"
                           ${marcada ? 'checked' : ''} aria-label="Selecionar comissão">
                </td>
                <td data-label="Venda">${escapeHTML(numero)}</td>
                <td data-label="Data">${escapeHTML(formatDateStringToBR(diaLocalDaVenda(c.sold_at)))}</td>
                <td data-label="Profissional">${escapeHTML(c.professional_name || '—')}</td>
                <td data-label="Serviço">${escapeHTML(c.service_name || '—')}</td>
                <td data-label="Bruto">${formatCurrency(Number(c.gross_amount) || 0)}</td>
                <td data-label="Desconto">${Number(c.discount_amount) ? '− ' + formatCurrency(Number(c.discount_amount)) : '—'}</td>
                <td data-label="Base">${formatCurrency(Number(c.base_amount) || 0)}</td>
                <td data-label="%">${Number(c.rate) || 0}%</td>
                <td data-label="Comissão" class="text-green" style="font-weight:700;">${formatCurrency(Number(c.amount) || 0)}</td>
                <td data-label="Situação">
                    <span class="status-badge ${paga ? 'done' : 'pending'}">${paga ? 'Paga' : 'A pagar'}</span>
                </td>
            </tr>`;
    }).join('');

    corpo.querySelectorAll('.com-check').forEach(el => {
        el.addEventListener('change', function () {
            if (this.checked) comissoesSelecionadas.add(this.value);
            else comissoesSelecionadas.delete(this.value);
            atualizarBotaoDePagar(true);
        });
    });
}

function renderAvisoDeComissaoAntiga() {
    const alvo = document.getElementById('comissoes-aviso-legado');
    if (!alvo) return;

    const antigos = atendimentosAntigosNoPeriodo().filter(a =>
        comissaoFiltros.professional === 'all' || a.profId === comissaoFiltros.professional
    );

    if (!antigos.length) {
        alvo.hidden = true;
        alvo.innerHTML = '';
        return;
    }

    const estimado = antigos.reduce((s, a) => s + comissaoDoAtendimento(a), 0);
    if (estimado <= 0) {
        alvo.hidden = true;
        alvo.innerHTML = '';
        return;
    }

    alvo.hidden = false;
    alvo.innerHTML = `
        <i class="fa-solid fa-clock-rotate-left"></i>
        <div>
            <strong>${antigos.length} atendimento(s) do período são anteriores ao checkout</strong>
            <span>
                Foram pagos pela confirmação antiga, quando o percentual ainda não era
                gravado na venda. A comissão deles é <strong>estimada pelo cadastro de
                hoje</strong> — cerca de ${formatCurrency(estimado)} — e por isso não
                entra nos números acima. Vendas novas não têm essa ressalva.
            </span>
        </div>`;
}

function atualizarBotaoDePagar(ehDono) {
    const botao = document.getElementById('btn-pagar-comissoes');
    if (!botao) return;

    botao.style.display = ehDono ? '' : 'none';
    if (!ehDono) return;

    const marcadas = comissoesSelecionadas.size;
    botao.disabled = marcadas === 0;

    // O botão troca de sentido conforme o que está marcado: com o filtro em
    // "Pagas", marcar linhas serve para DESFAZER uma baixa errada.
    const todasPagas = marcadas > 0 && [...comissoesSelecionadas].every(id => {
        const c = (data.saleCommissions || []).find(x => x.id === id);
        return c && c.status === 'paid';
    });
    botao.dataset.desfazer = todasPagas ? '1' : '';
    botao.innerHTML = todasPagas
        ? `<i class="fa-solid fa-rotate-left"></i> Desfazer baixa (${marcadas})`
        : `<i class="fa-solid fa-circle-check"></i> Marcar como paga${marcadas ? ' (' + marcadas + ')' : ''}`;
}

/* --- Dar baixa ------------------------------------------------------------
   Quem decide é o banco: pagar_comissoes() confere `meu_papel()` antes de
   escrever. Um staff que chamasse isto pelo console levaria erro. */
async function pagarComissoesSelecionadas() {
    const botao = document.getElementById('btn-pagar-comissoes');
    if (!botao || !comissoesSelecionadas.size) return;

    const desfazer = botao.dataset.desfazer === '1';
    const ids = [...comissoesSelecionadas];

    botao.disabled = true;
    const resposta = await DataService.pagarComissoes(ids, !desfazer);

    if (!resposta.ok) {
        // Nada é alterado na tela quando o servidor recusa. Marcar como paga
        // localmente uma comissão que o banco não aceitou é o pior dos mundos:
        // o dono acha que pagou e o profissional continua vendo a pendência.
        showToast(
            resposta.faltaMigration
                ? 'Execute docs/sql/21_comissoes.sql no Supabase para dar baixa em comissão.'
                : (resposta.motivo || 'Não foi possível dar baixa.'),
            'danger'
        );
        botao.disabled = false;
        return;
    }

    // Espelha no estado local o que o banco confirmou.
    const agora = new Date().toISOString();
    (data.saleCommissions || []).forEach(c => {
        if (!ids.includes(c.id)) return;
        c.status = desfazer ? 'pending' : 'paid';
        c.paid_at = desfazer ? null : agora;
    });
    localStorage.setItem(STATE_KEYS.SALE_COMMISSIONS, JSON.stringify(data.saleCommissions));

    comissoesSelecionadas.clear();
    const marcarTodas = document.getElementById('com-marcar-todas');
    if (marcarTodas) marcarTodas.checked = false;

    showToast(
        desfazer
            ? `${resposta.atualizadas} comissão(ões) voltaram para "a pagar".`
            : `${resposta.atualizadas} comissão(ões) marcadas como pagas.`,
        'success'
    );
    renderComissoes();
}

/* --- Ligações da tela ----------------------------------------------------- */

[
    ['com-filter-period', 'period'],
    ['com-filter-professional', 'professional'],
    ['com-filter-status', 'status']
].forEach(([id, campo]) => {
    document.getElementById(id)?.addEventListener('change', function () {
        comissaoFiltros[campo] = this.value;
        // Trocar de filtro esvazia a seleção: pagar uma linha que saiu da tela
        // seria uma baixa que ninguém conferiu.
        comissoesSelecionadas.clear();
        const marcarTodas = document.getElementById('com-marcar-todas');
        if (marcarTodas) marcarTodas.checked = false;
        renderComissoes();
    });
});

document.getElementById('com-marcar-todas')?.addEventListener('change', function () {
    comissoesSelecionadas.clear();
    if (this.checked) {
        comissoesFiltradas().forEach(c => comissoesSelecionadas.add(c.id));
    }
    renderTabelaDeComissoes(true);
    atualizarBotaoDePagar(true);
});

document.getElementById('btn-pagar-comissoes')?.addEventListener('click', () => {
    pagarComissoesSelecionadas().catch(err => {
        console.error('Falha ao dar baixa em comissão:', err);
        showToast('Não foi possível dar baixa. Tente de novo.', 'danger');
    });
});
