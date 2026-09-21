/* ==========================================================================
   BARRA SUPERIOR — BUSCA GLOBAL, AVISOS DO DIA E CHIP DO PLANO

   Arquivo separado de propósito: o app.js já passa de seis mil linhas, e nada
   daqui é chamado por ele. A comunicação é de mão única — a barra lê o `data`
   e as funções que os outros módulos já expõem, e navega clicando no próprio
   item do menu, o mesmo caminho de quem clica com o mouse.
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

/* --- Busca global --------------------------------------------------------- */

// Acentos e máscara de telefone são ruído para quem digita com pressa: quem
// procura "jose" tem que achar "José", e quem digita "98765" tem que achar
// "(11) 98765-4321".
function normalizarBusca(valor) {
    return String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function somenteDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
}

const LIMITE_DE_RESULTADOS = 6;

function buscarClientes(termo) {
    const lista = (typeof data !== 'undefined' && Array.isArray(data.clients)) ? data.clients : [];
    const alvo = normalizarBusca(termo);
    const digitos = somenteDigitos(termo);

    return lista.filter(cli => {
        if (normalizarBusca(cli.name).includes(alvo)) return true;
        // Só procura por telefone quando o termo tem dígito suficiente para
        // ser um: com um ou dois números, todo cliente casaria.
        return digitos.length >= 3 && somenteDigitos(cli.phone).includes(digitos);
    }).slice(0, LIMITE_DE_RESULTADOS);
}

function renderResultadosDaBusca(termo) {
    const caixa = document.getElementById('busca-global-resultados');
    if (!caixa) return;

    if (termo.trim().length < 2) {
        caixa.hidden = true;
        caixa.innerHTML = '';
        return;
    }

    const encontrados = buscarClientes(termo);
    caixa.hidden = false;

    if (!encontrados.length) {
        caixa.innerHTML = `<p class="busca-global-vazio">Nenhum cliente com “${textoSeguro(termo)}”.</p>`;
        return;
    }

    caixa.innerHTML = encontrados.map(cli => `
        <button type="button" class="busca-global-item" data-cliente="${textoSeguro(cli.id)}">
            <i class="fa-regular fa-user"></i>
            <span>
                <span class="bg-nome">${textoSeguro(cli.name)}</span>
                <span class="bg-detalhe">${textoSeguro(cli.phone || 'sem WhatsApp cadastrado')}</span>
            </span>
        </button>
    `).join('');
}

function fecharBuscaGlobal() {
    const caixa = document.getElementById('busca-global-resultados');
    if (caixa) {
        caixa.hidden = true;
        caixa.innerHTML = '';
    }
}

function initBuscaGlobal() {
    const campo = document.getElementById('busca-global');
    const caixa = document.getElementById('busca-global-resultados');
    if (!campo || !caixa) return;

    campo.addEventListener('input', () => renderResultadosDaBusca(campo.value));

    campo.addEventListener('focus', () => {
        if (campo.value.trim().length >= 2) renderResultadosDaBusca(campo.value);
    });

    campo.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            campo.value = '';
            fecharBuscaGlobal();
            campo.blur();
        }
        // Enter abre o primeiro resultado: é o que a pessoa espera depois de
        // digitar o nome inteiro de um cliente.
        if (e.key === 'Enter') {
            const primeiro = caixa.querySelector('.busca-global-item');
            if (primeiro) primeiro.click();
        }
    });

    caixa.addEventListener('click', (e) => {
        const item = e.target.closest('.busca-global-item');
        if (!item) return;

        const id = item.getAttribute('data-cliente');
        campo.value = '';
        fecharBuscaGlobal();

        // A ficha do cliente vive na aba Clientes: abre a aba primeiro para
        // quem fechar o modal não cair numa tela sem relação com o que buscou.
        irParaAba('clientes');
        if (typeof openEditClient === 'function') openEditClient(id);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#header-search')) fecharBuscaGlobal();
    });
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
        <i class="fa-solid fa-crown"></i>
        <span>${textoSeguro(plano.name)}</span>
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
    initBuscaGlobal();
    initSinoDeAlertas();
    initChipDoPlano();
});
