/* ==========================================================================
   BARRA SUPERIOR — AVISOS DO DIA E CHIP DO PLANO

   Arquivo separado de propósito: o app.js já passa de seis mil linhas, e nada
   daqui é chamado por ele. A comunicação é de mão única — a barra lê o `data`
   e as funções que os outros módulos já expõem, e navega clicando no próprio
   item do menu, o mesmo caminho de quem clica com o mouse.

   Houve aqui uma busca global de clientes. Saiu porque o cabeçalho não tinha
   largura para ela junto das duas ações do dia, do sino e do plano — alguma
   coisa acabava cortada na borda. Quem procura cliente usa o campo da própria
   aba Clientes.
   ========================================================================== */

// Cada bloco depende de um módulo que pode não ter carregado (ou estar
// desligado pelo plano). Em vez de espalhar `typeof` por toda parte, tudo
// passa por aqui e um módulo ausente vira simplesmente "nenhum aviso".
function chamarSeExistir(nomeDaFuncao, padrao) {
    try {
        const fn = window[nomeDaFuncao];
        return typeof fn === 'function' ? fn() : padrao;
    } catch (err) {
        console.warn(`[Barra superior] Falha ao consultar ${nomeDaFuncao}:`, err);
        return padrao;
    }
}

function textoSeguro(valor) {
    return typeof escapeHTML === 'function' ? escapeHTML(valor) : String(valor ?? '');
}

function irParaAba(alvo) {
    const item = document.querySelector(`.menu-item[data-target="${alvo}"]`);
    if (item) item.click();
}

/* --- Avisos do dia -------------------------------------------------------- */

// Os três números já existem espalhados pelos badges do menu. O sino só os
// reúne num lugar só, com o caminho para resolver cada um.
function coletarAvisos() {
    const avisos = [];

    const retornos = chamarSeExistir('getRecallClients', []);
    if (Array.isArray(retornos) && retornos.length) {
        avisos.push({
            icone: 'fa-solid fa-user-clock',
            cor: 'var(--warning)',
            texto: retornos.length === 1
                ? '1 cliente passou do retorno'
                : `${retornos.length} clientes passaram do retorno`,
            aba: 'clientes'
        });
    }

    const semEstoque = chamarSeExistir('produtosAbaixoDoMinimo', []);
    if (Array.isArray(semEstoque) && semEstoque.length) {
        avisos.push({
            icone: 'fa-solid fa-boxes-stacked',
            cor: 'var(--danger)',
            texto: semEstoque.length === 1
                ? '1 produto no estoque mínimo'
                : `${semEstoque.length} produtos no estoque mínimo`,
            aba: 'estoque'
        });
    }

    const crediario = chamarSeExistir('resumoDoCrediario', null);
    const atrasadas = crediario && crediario.qtdAtrasadas;
    if (atrasadas) {
        avisos.push({
            icone: 'fa-solid fa-file-invoice-dollar',
            cor: 'var(--danger)',
            texto: atrasadas === 1
                ? '1 parcela de crediário atrasada'
                : `${atrasadas} parcelas de crediário atrasadas`,
            aba: 'crediario'
        });
    }

    return avisos;
}

function atualizarSinoDeAlertas() {
    const ponto = document.getElementById('header-sino-ponto');
    if (ponto) ponto.hidden = coletarAvisos().length === 0;
}

function renderPainelDeAlertas() {
    const painel = document.getElementById('painel-alertas');
    if (!painel) return;

    const avisos = coletarAvisos();

    if (!avisos.length) {
        painel.innerHTML = `
            <p class="painel-alertas-titulo">Avisos do dia</p>
            <p class="painel-alertas-vazio">Nada pedindo atenção agora.</p>`;
        return;
    }

    painel.innerHTML = `<p class="painel-alertas-titulo">Avisos do dia</p>` + avisos.map(a => `
        <button type="button" class="painel-alertas-item" data-aba="${textoSeguro(a.aba)}">
            <i class="${a.icone}" style="color: ${a.cor};"></i>
            <span>${textoSeguro(a.texto)}</span>
        </button>
    `).join('');
}

function initSinoDeAlertas() {
    const botao = document.getElementById('btn-alertas');
    const painel = document.getElementById('painel-alertas');
    if (!botao || !painel) return;

    botao.addEventListener('click', (e) => {
        e.stopPropagation();
        if (painel.hidden) renderPainelDeAlertas();
        painel.hidden = !painel.hidden;
    });

    painel.addEventListener('click', (e) => {
        const item = e.target.closest('.painel-alertas-item');
        if (!item) return;
        painel.hidden = true;
        irParaAba(item.getAttribute('data-aba'));
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#painel-alertas') && !e.target.closest('#btn-alertas')) {
            painel.hidden = true;
        }
    });

    atualizarSinoDeAlertas();
}

/* --- Chip do plano -------------------------------------------------------- */

function diasRestantesDeTeste(fim) {
    if (!fim) return null;
    const alvo = new Date(fim);
    if (isNaN(alvo)) return null;
    return Math.max(0, Math.ceil((alvo - Date.now()) / 86400000));
}

function renderChipDoPlano() {
    const chip = document.getElementById('chip-plano');
    if (!chip || typeof SaaSPlanManager === 'undefined') return;

    const plano = SaaSPlanManager.getPlan();
    if (!plano) {
        chip.hidden = true;
        return;
    }

    const emTeste = SaaSPlanManager.subscriptionStatus === 'trial';
    const dias = emTeste ? diasRestantesDeTeste(SaaSPlanManager.trialEndsAt) : null;

    // Assinatura ativa não vira chip: o dado não muda nada no dia a dia de
    // quem já paga, e a barra tem largura melhor aproveitada sem ele.
    if (!emTeste) {
        chip.hidden = true;
        return;
    }

    let trechoDoTeste = 'Teste grátis';
    if (dias === 0) trechoDoTeste = 'Último dia de teste';
    else if (dias === 1) trechoDoTeste = 'Teste grátis · 1 dia';
    else if (dias !== null) trechoDoTeste = `Teste grátis · ${dias} dias`;

    chip.hidden = false;
    chip.classList.toggle('chip-plano-urgente', dias !== null && dias <= 2);
    chip.innerHTML = `
        <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
            <i class="fa-solid fa-crown" style="color: var(--primary); font-size: 12px;"></i>
            <span style="font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${textoSeguro(plano.name)}</span>
        </div>
        <span class="chip-plano-trial">${textoSeguro(trechoDoTeste)}</span>`;
    chip.title = 'Ver planos e assinar';
}

function initChipDoPlano() {
    const chip = document.getElementById('chip-plano');
    if (!chip) return;

    chip.addEventListener('click', () => {
        if (typeof SaaSPlanManager !== 'undefined' && typeof SaaSPlanManager.redirectToCheckout === 'function') {
            SaaSPlanManager.redirectToCheckout();
        }
    });

    renderChipDoPlano();
}

/* --- Entrada -------------------------------------------------------------- */

// Chamada de novo a cada carga de dados: os avisos e os dias de teste mudam
// junto com o `data`, não no carregamento da página.
function atualizarBarraSuperior() {
    atualizarSinoDeAlertas();
    renderChipDoPlano();
}
window.atualizarBarraSuperior = atualizarBarraSuperior;

window.addEventListener('DOMContentLoaded', () => {
    initSinoDeAlertas();
    initChipDoPlano();
});
