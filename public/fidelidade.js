/**
 * ==========================================================================
 * FIDELIDADE (Fase F)
 *
 * A aba Fidelidade: configuração do clube, adesão do cliente, progresso e
 *    resgate do benefício.
 *
 *    ⚠️ AQUI NÃO SE PONTUA. Quem soma ponto é o GATILHO do banco em
 *    `sale_items` (docs/sql/25_fidelidade.sql), na mesma transação da venda —
 *    mesmo padrão da comissão (Fase D). Esta tela só lê o saldo e o histórico.
 *
 *    Quem RESGATA é a RPC resgatar_fidelidade(), nunca esta tela sozinha: um
 *    resgate recusado não pode virar desconto aplicado com pontos intactos —
 *    o cliente sairia com o benefício e a conta ainda cheia.
 *
 * Carregado por <script> em index.html, na ordem do numero do arquivo.
 * Tudo compartilha o mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

const fidelidadeFiltros = { status: 'all', busca: '' };

/* --- BASE DE CÁLCULO -------------------------------------------------------
   Compartilhada com o checkout (24-checkout.js): a mesma pergunta — "este
   cliente tem benefício disponível?" — não pode ter duas respostas diferentes
   conforme a tela que pergunta. */

function programaDeFidelidade() {
    return (data.loyaltyPrograms || [])[0] || null;
}

function clientesDoClube() {
    return (data.clients || []).filter(c => c && c.loyaltyEnrolled);
}

/* Devolve o benefício pronto para uso quando o cliente tem saldo suficiente,
   ou null quando não há o que oferecer — cliente fora do clube, programa
   desligado ou pontos insuficientes. Único ponto de verdade para o checkout
   mostrar o aviso e para a aba mostrar o botão "Resgatar". */
function beneficioFidelidadeDoCliente(clientId) {
    if (!clientId) return null;
    const cliente = (data.clients || []).find(c => c.id === clientId);
    if (!cliente || !cliente.loyaltyEnrolled) return null;

    const programa = programaDeFidelidade();
    if (!programa || programa.active === false) return null;

    const meta = Number(programa.goal) || 0;
    const pontos = Number(cliente.loyaltyPoints) || 0;
    if (meta <= 0 || pontos < meta) return null;

    return { cliente, programa, pontos, meta };
}

/* --- Aviso de meta atingida por WhatsApp -----------------------------------
   A tela sempre soube dizer quem bateu a meta, mas avisar o cliente dependia
   do balcão lembrar. O texto é do CLUBE (cita meta e benefício), então mora em
   `loyalty_programs.reward_message` (migration 26) e é editado junto com o
   resto da configuração — se o dono muda o benefício, o texto que fala dele
   está na mesma tela.

   Sem telefone não há botão, mesma regra da cobrança do crediário: um link que
   abre o WhatsApp em branco só faz perder o clique. */
const MSG_FIDELIDADE_PADRAO =
    'Olá {nome}! Boa notícia: você completou {pontos} pontos no {clube} e já ' +
    'pode resgatar seu benefício — {beneficio}. É só falar com a gente na sua ' +
    'próxima visita. {link}';

function modeloDeAvisoDeFidelidade() {
    const programa = programaDeFidelidade();
    return (programa && programa.reward_message) || MSG_FIDELIDADE_PADRAO;
}

function mensagemDeMetaAtingida(beneficio) {
    return aplicarTagsWhatsApp(modeloDeAvisoDeFidelidade(), {
        nome: primeiroNomeApresentavel(beneficio.cliente.name),
        clube: beneficio.programa.name || 'Clube de Fidelidade',
        beneficio: beneficio.programa.benefit_description || 'seu benefício',
        pontos: beneficio.pontos,
        meta: beneficio.meta
    });
}

function htmlBotaoAvisoDeFidelidade(beneficio) {
    const telefone = beneficio.cliente.phone;
    if (!telefone) return '';
    const texto = encodeURIComponent(mensagemDeMetaAtingida(beneficio));
    return `<a class="btn btn-sm btn-secondary" target="_blank" rel="noopener"
               href="https://wa.me/55${String(telefone).replace(/\D/g, '')}?text=${texto}"
               title="Avisar que o benefício está liberado">
               <i class="fa-brands fa-whatsapp"></i>
           </a>`;
}

function movimentosDoCliente(clientId) {
    return (data.loyaltyMovements || [])
        .filter(m => m.client_id === clientId)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function clientesFiltrados() {
    const busca = normalizeSaleText(fidelidadeFiltros.busca);
    return clientesDoClube()
        .filter(c => {
            if (busca && !normalizeSaleText(c.name).includes(busca) &&
                !normalizeSaleText(c.phone).includes(busca)) return false;

            if (fidelidadeFiltros.status === 'available') {
                return !!beneficioFidelidadeDoCliente(c.id);
            }
            if (fidelidadeFiltros.status === 'progress') {
                return !beneficioFidelidadeDoCliente(c.id);
            }
            return true;
        })
        .sort((a, b) => (Number(b.loyaltyPoints) || 0) - (Number(a.loyaltyPoints) || 0));
}

function resumoDeFidelidade() {
    const programa = programaDeFidelidade();
    const clube = clientesDoClube();
    const meta = programa ? Number(programa.goal) || 0 : 0;

    return {
        clientes: clube.length,
        pontosEmAberto: clube.reduce((s, c) => s + (Number(c.loyaltyPoints) || 0), 0),
        disponiveis: meta > 0 ? clube.filter(c => (Number(c.loyaltyPoints) || 0) >= meta).length : 0,
        resgatados: (data.loyaltyMovements || []).filter(m => Number(m.points) < 0).length
    };
}

/* --- Tela ------------------------------------------------------------------ */

function renderFidelidade() {
    const aviso = document.getElementById('fidelidade-schema-warning');
    if (aviso) aviso.hidden = data.loyaltySchemaReady !== false;

    // A configuração do clube mora na aba Configurações (ver renderConfig());
    // aqui só o resumo e a tabela de clientes.
    renderResumoDeFidelidade();
    renderTabelaDeFidelidade();
}

function renderConfigDaFidelidade() {
    const programa = programaDeFidelidade();
    const bloco = document.getElementById('fidelidade-config');
    if (!bloco) return;

    // O formulário só recebe os valores atuais quando ninguém está digitando
    // nele agora — sobrescrever no meio da edição apagaria o que a pessoa
    // acabou de escrever.
    if (document.activeElement && bloco.contains(document.activeElement)) return;

    document.getElementById('fid-cfg-active').checked = !programa || programa.active !== false;
    document.getElementById('fid-cfg-name').value = programa ? programa.name : 'Clube de Fidelidade';
    document.getElementById('fid-cfg-goal').value = programa ? programa.goal : 10;
    document.getElementById('fid-cfg-points').value = programa ? programa.points_per_service : 1;
    document.getElementById('fid-cfg-benefit-desc').value = programa ? programa.benefit_description : '1 serviço grátis';
    document.getElementById('fid-cfg-benefit-type').value = programa ? programa.benefit_type : 'amount';
    document.getElementById('fid-cfg-benefit-value').value = programa ? programa.benefit_value : '';

    // Campo vazio no banco = nunca editado. Mostrar o modelo de fábrica é o
    // certo: um textarea em branco esconderia do dono que existe uma mensagem
    // pronta, e ele acabaria escrevendo uma do zero achando que não havia.
    const campoMensagem = document.getElementById('fid-cfg-message');
    if (campoMensagem) campoMensagem.value = modeloDeAvisoDeFidelidade();

    const aindaNaoAtivado = document.getElementById('fid-cfg-empty-hint');
    if (aindaNaoAtivado) aindaNaoAtivado.hidden = !!programa;
}

function renderResumoDeFidelidade() {
    const r = resumoDeFidelidade();
    const põe = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.innerText = valor;
    };
    põe('fid-total-clientes', String(r.clientes));
    põe('fid-total-pontos', String(r.pontosEmAberto));
    põe('fid-total-disponiveis', String(r.disponiveis));
    põe('fid-total-resgatados', String(r.resgatados));
}

function progressoHTML(cliente, programa) {
    const meta = programa ? Number(programa.goal) || 0 : 0;
    const pontos = Number(cliente.loyaltyPoints) || 0;
    if (meta <= 0) return '<span class="fid-progress-sem-meta">Configure a meta do programa</span>';

    const pct = Math.min(100, Math.round((pontos / meta) * 100));
    const disponivel = pontos >= meta;
    return `
        <div class="fid-progress">
            <div class="fid-progress-track">
                <div class="fid-progress-fill ${disponivel ? 'fid-progress-completa' : ''}" style="width:${pct}%"></div>
            </div>
            <span class="fid-progress-label">${pontos} / ${meta}</span>
        </div>`;
}

function renderTabelaDeFidelidade() {
    const corpo = document.getElementById('fidelidade-body');
    if (!corpo) return;

    const programa = programaDeFidelidade();
    const linhas = clientesFiltrados();
    const contador = document.getElementById('fidelidade-result-count');
    if (contador) {
        contador.innerText = `${linhas.length} ${linhas.length === 1 ? 'cliente' : 'clientes'}`;
    }

    if (!linhas.length) {
        corpo.innerHTML = `
            <tr><td colspan="5" class="sales-empty-cell">
                <i class="fa-solid fa-star"></i>
                ${clientesDoClube().length
                    ? 'Nenhum cliente para os filtros selecionados.'
                    : 'Nenhum cliente cadastrado ainda — assim que houver um, ele já entra no clube automaticamente.'}
            </td></tr>`;
        renderPaginacao('fidelidade-pagination', 'fidelidade', 0);
        return;
    }

    renderPaginacao('fidelidade-pagination', 'fidelidade', linhas.length);
    corpo.innerHTML = fatiaDaPagina('fidelidade', linhas).map(cliente => {
        const beneficio = beneficioFidelidadeDoCliente(cliente.id);
        const disponivel = !!beneficio;
        return `
            <tr>
                <td data-label="Cliente"><strong>${escapeHTML(cliente.name)}</strong></td>
                <td data-label="WhatsApp">${escapeHTML(cliente.phone || '—')}</td>
                <td data-label="Progresso">${progressoHTML(cliente, programa)}</td>
                <td data-label="Situação">
                    <span class="status-badge ${disponivel ? 'done' : 'pending'}">
                        ${disponivel ? 'Benefício disponível' : 'Em progresso'}
                    </span>
                </td>
                <td data-label="Ação" style="text-align:right;">
                    <button class="btn-card-action" title="Ver histórico"
                            onclick="abrirHistoricoDeFidelidade('${escapeHTML(cliente.id)}')">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
                    ${disponivel ? `
                        ${htmlBotaoAvisoDeFidelidade(beneficio)}
                        <button class="btn btn-sm btn-primary" onclick="resgatarBeneficioDaAba('${escapeHTML(cliente.id)}')">
                            <i class="fa-solid fa-gift"></i> Resgatar
                        </button>` : ''}
                </td>
            </tr>`;
    }).join('');
}

/* --- Histórico do cliente --------------------------------------------------- */

window.abrirHistoricoDeFidelidade = function (clientId) {
    const cliente = (data.clients || []).find(c => c.id === clientId);
    const conteudo = document.getElementById('fidelidade-historico-content');
    if (!cliente || !conteudo) return;

    document.getElementById('fidelidade-historico-titulo').innerText = `Histórico — ${cliente.name}`;

    const movimentos = movimentosDoCliente(clientId);
    if (!movimentos.length) {
        conteudo.innerHTML = '<p class="checkout-empty">Nenhuma movimentação ainda.</p>';
    } else {
        conteudo.innerHTML = `
            <div class="table-container">
                <table class="data-table small-text">
                    <thead><tr><th>Data</th><th>Motivo</th><th style="text-align:right;">Pontos</th></tr></thead>
                    <tbody>${movimentos.map(m => `
                        <tr>
                            <td data-label="Data">${escapeHTML(formatDateStringToBR(diaLocalDaVenda(m.created_at)))}</td>
                            <td data-label="Motivo">${escapeHTML(m.reason || '—')}</td>
                            <td data-label="Pontos" style="text-align:right;font-weight:700;color:${Number(m.points) > 0 ? 'var(--success)' : 'var(--danger)'};">
                                ${Number(m.points) > 0 ? '+' : ''}${Number(m.points) || 0}
                            </td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>`;
    }

    openModal('modal-fidelidade-historico');
};

/* --- Resgate ----------------------------------------------------------------
   Mesma regra do crediário: nada muda na tela até o servidor confirmar. Um
   resgate recusado não pode aparecer como benefício entregue. */
async function resgatarBeneficio(clientId, saleId) {
    const chaveBase = saleId ? `resgate-venda-${saleId}` : `resgate-tab-${clientId}-${Date.now().toString(36)}`;
    const payload = { clientId: clientId, saleId: saleId || null, idempotencyKey: chaveBase };

    const retorno = await DataService.resgatarFidelidade(payload);
    if (!retorno || !retorno.ok) {
        showToast(
            retorno && retorno.faltaMigration
                ? 'Execute docs/sql/25_fidelidade.sql no Supabase para resgatar benefício.'
                : (retorno && retorno.motivo) || 'Não foi possível registrar o resgate.',
            'danger'
        );
        return retorno;
    }

    showToast(
        retorno.repetida
            ? 'Este resgate já havia sido registrado. Nada foi descontado de novo.'
            : 'Benefício resgatado com sucesso.',
        retorno.repetida ? 'info' : 'success'
    );
    return retorno;
}

window.resgatarBeneficioDaAba = function (clientId) {
    const beneficio = beneficioFidelidadeDoCliente(clientId);
    if (!beneficio) return;

    if (!confirm(`Resgatar "${beneficio.programa.benefit_description}" para ${beneficio.cliente.name}? Isto consome ${beneficio.meta} pontos.`)) {
        return;
    }

    resgatarBeneficio(clientId, null)
        .then(async retorno => {
            if (!retorno || !retorno.ok) return;
            // Recarrega do banco em vez de espelhar na mão: o resgate mexeu no
            // saldo do cliente e no razão de pontos ao mesmo tempo, e refazer
            // essa conta aqui é a receita para as duas versões divergirem.
            if (typeof loadData === 'function') await loadData();
            renderFidelidade();
        })
        .catch(erro => {
            console.error('Falha ao resgatar fidelidade:', erro);
            showToast('Não foi possível registrar o resgate.', 'danger');
        });
};

/* --- Configuração do programa ----------------------------------------------
   Config é direto na tabela (RLS já recusa quem não é dono), sem RPC — mesma
   liberdade de `products` e `business_info`. Quem mexe em SALDO é sempre RPC. */
document.getElementById('form-fidelidade-config')?.addEventListener('submit', event => {
    event.preventDefault();

    const goal = Math.max(1, parseInt(document.getElementById('fid-cfg-goal').value, 10) || 10);
    const pontos = Math.max(1, parseInt(document.getElementById('fid-cfg-points').value, 10) || 1);
    const valorBeneficio = Math.max(0, parseFloat(document.getElementById('fid-cfg-benefit-value').value) || 0);

    const programaAtual = programaDeFidelidade() || {};
    const atualizado = {
        ...programaAtual,
        active: document.getElementById('fid-cfg-active').checked,
        name: sanitizePlainText(document.getElementById('fid-cfg-name').value) || 'Clube de Fidelidade',
        goal: goal,
        points_per_service: pontos,
        benefit_description: sanitizePlainText(document.getElementById('fid-cfg-benefit-desc').value) || '1 serviço grátis',
        benefit_type: document.getElementById('fid-cfg-benefit-type').value === 'percent' ? 'percent' : 'amount',
        benefit_value: valorBeneficio,
        // sanitizePlainText não serve aqui: ele achata quebras de linha, e uma
        // mensagem de WhatsApp de três parágrafos viraria um bloco só. É o
        // mesmo tratamento que as outras mensagens já recebem (nenhum) — o
        // texto nunca é injetado como HTML, ele vira parâmetro de URL do wa.me.
        reward_message: (document.getElementById('fid-cfg-message')?.value || '').trim() || null
    };

    data.loyaltyPrograms = [atualizado];
    saveData(STATE_KEYS.LOYALTY_PROGRAMS, data.loyaltyPrograms);
    showToast('Configuração do clube salva.', 'success');
    renderFidelidade();
});

/* --- Ligações da tela -------------------------------------------------------- */

// Filtro novo recomeça da primeira página (ver voltarAPrimeiraPagina).
document.getElementById('fid-filter-status')?.addEventListener('change', function () {
    fidelidadeFiltros.status = this.value;
    voltarAPrimeiraPagina('fidelidade');
    renderTabelaDeFidelidade();
});

document.getElementById('fid-search')?.addEventListener('input', function () {
    fidelidadeFiltros.busca = this.value;
    voltarAPrimeiraPagina('fidelidade');
    renderTabelaDeFidelidade();
});
