/**
 * ==========================================================================
 * CHECKOUT — FASE B
 *
 * A tela onde a venda acontece. Monta o carrinho, divide o pagamento e
 *    entrega tudo de uma vez para a RPC finalizar_venda.
 *
 *    ⚠️ ESTE ARQUIVO NAO GRAVA VENDA. Ele monta o pedido, mostra a conta e
 *    chama DataService.finalizarVenda(). Quem valida e grava e o banco, numa
 *    transacao unica. Com Supabase configurado, uma RPC recusada NUNCA vira
 *    sucesso na tela: venda fantasma no navegador de quem vendeu e pior do que
 *    venda nao registrada, porque ninguem vai procurar por ela.
 *
 *    A conta mora em 23-venda-calculo.js, de proposito: a mesma funcao serve o
 *    checkout, o modo local e o teste.
 *
 * Carregado por <script> em index.html, na ordem do numero do arquivo.
 * Tudo compartilha o mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

const checkoutState = {
    origem: 'counter',
    appointmentId: '',
    clientId: '',
    professionalId: '',
    competenceDate: '',
    itens: [],
    desconto: { tipo: 'amount', valor: 0 },
    acrescimo: { tipo: 'amount', valor: 0 },
    pagamentos: [],
    notas: '',
    // Fase E. `parcelas` fica nulo enquanto ninguem edita a mao: nulo significa
    // "divide igual", e uma lista significa "o usuario mandou assim".
    crediario: { ativo: false, quantidade: 1, primeiroVencimento: '', parcelas: null },
    // Fase F. `aplicado` so vira true quando o balcao clica em "Aplicar" no
    // aviso de beneficio; `clientId` marca de quem era o beneficio, para o
    // resgate nunca sair no nome de um cliente diferente do que foi trocado
    // depois no mesmo checkout.
    fidelidade: { aplicado: false, clientId: '' },
    idempotencyKey: '',
    enviando: false
};

let checkoutSeq = 0;
function novoIdDeLinha() {
    checkoutSeq += 1;
    return 'ck-' + checkoutSeq;
}

/* A chave que impede a cobranca dupla.

   Para venda vinda de atendimento ela e DERIVADA do atendimento: atualizar a
   pagina e tentar de novo devolve a mesma venda, em vez de uma segunda.
   No balcao nao ha o que derivar — a chave nasce ao abrir a tela e vive ate a
   venda fechar; uma falha de rede pode ser repetida com a mesma chave sem
   risco de cobrar duas vezes.

   ⚠️ Quando a Fase D/E criar o estorno, cancelar uma venda de atendimento
   precisara liberar esta chave, senao a venda nova recebe a antiga de volta. */
function chaveDeIdempotencia(appointmentId) {
    if (appointmentId) return 'venda-appt-' + appointmentId;
    return 'venda-balcao-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* Quem pode concluir venda pela tela nova.

   O profissional TAMBEM conclui venda desde o script 27 — decisao do dono: "se
   tiver somente ele no salao precisa ter acesso completo". O que ele nao pode e
   fechar o ATENDIMENTO DE OUTRO, e isso nao se decide aqui: quem recusa e a
   propria RPC. Na pratica ele nem chega perto, porque a RLS de `appointments`
   nao lhe mostra o agendamento do colega — a trava da RPC e a segunda barreira,
   nao a primeira.

   O que sobrou aqui e a checagem de SCHEMA: sem a migration 14/15 no Supabase o
   checkout falharia no meio do atendimento, e e melhor o botao dizer o que falta
   do que a venda morrer no clique. */
function checkoutDisponivel() {
    if (typeof DataService === 'undefined') return false;
    return data.salesSchemaReady !== false;
}

// --- ABERTURA ---------------------------------------------------------------

function abrirCheckout(opcoes) {
    const config = opcoes || {};

    checkoutState.appointmentId = config.appointmentId || '';
    checkoutState.origem = checkoutState.appointmentId ? 'appointment' : 'counter';
    checkoutState.clientId = config.clientId || '';
    checkoutState.professionalId = config.professionalId || '';
    checkoutState.competenceDate = config.competenceDate || getLocalDateString(new Date());
    checkoutState.itens = (config.itens || []).map(item => Object.assign({ uid: novoIdDeLinha() }, item));
    checkoutState.desconto = { tipo: 'amount', valor: 0 };
    checkoutState.acrescimo = { tipo: 'amount', valor: 0 };
    checkoutState.pagamentos = [];
    checkoutState.notas = '';
    checkoutState.crediario = { ativo: false, quantidade: 1, primeiroVencimento: '', parcelas: null };
    checkoutState.fidelidade = { aplicado: false, clientId: '' };
    checkoutState.idempotencyKey = chaveDeIdempotencia(checkoutState.appointmentId);
    checkoutState.enviando = false;

    const eyebrow = document.getElementById('checkout-eyebrow');
    const titulo = document.getElementById('checkout-title');
    if (eyebrow) eyebrow.innerText = checkoutState.appointmentId ? 'Atendimento' : 'Balcão';
    if (titulo) titulo.innerText = checkoutState.appointmentId ? 'Concluir e receber' : 'Nova venda';

    ['checkout-discount-value', 'checkout-notes'].forEach(id => {
        const campo = document.getElementById(id);
        if (campo) campo.value = '';
    });
    const tipoDesconto = document.getElementById('checkout-discount-type');
    if (tipoDesconto) tipoDesconto.value = 'amount';

    const quick = document.getElementById('checkout-quick-client');
    if (quick) quick.hidden = true;

    const creditoLigado = document.getElementById('checkout-credit-on');
    if (creditoLigado) creditoLigado.checked = false;
    const creditoQtd = document.getElementById('checkout-credit-count');
    if (creditoQtd) creditoQtd.value = 1;
    // Primeiro vencimento sugerido: 30 dias. E o combinado mais comum do balcao
    // ("me paga mes que vem") e evita a data em branco, que o banco recusaria.
    const creditoData = document.getElementById('checkout-credit-first');
    if (creditoData) {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        creditoData.value = getLocalDateString(d);
    }

    renderCheckoutSelects();
    renderCheckout();
    openModal('modal-checkout');
}

/* O aviso de que esta tela é para quem NÃO está agendado.

   Vale só para a venda de balcão: no "Concluir e receber" de um atendimento a
   pergunta já está respondida, e repetir o aviso ali seria pedir uma
   confirmação a mais em cima do caminho mais usado do dia.

   A dispensa fica no localStorage, e não no cadastro do salão: é preferência
   de quem opera aquele aparelho. Um balcão que já entendeu não precisa impor a
   escolha ao tablet da recepção — e um navegador limpo volta a avisar, que é o
   comportamento certo para quem chega novo na equipe. */
const CHAVE_AVISO_VENDA_BALCAO = 'lexion_aviso_venda_balcao_oculto';

function avisoDaVendaDeBalcaoDispensado() {
    try {
        return localStorage.getItem(CHAVE_AVISO_VENDA_BALCAO) === '1';
    } catch (erro) {
        // Navegador com armazenamento bloqueado: mostrar o aviso é o lado
        // seguro do erro — atrapalha um clique, não deixa a venda no lugar
        // errado.
        return false;
    }
}

window.abrirCheckoutDeBalcao = function () {
    if (!checkoutDisponivel()) {
        showToast('O checkout precisa da estrutura de Vendas no Supabase (docs/sql/14 e 15).', 'warning');
        return;
    }

    if (avisoDaVendaDeBalcaoDispensado()) {
        abrirCheckout({});
        return;
    }

    const naoMostrar = document.getElementById('venda-aviso-nao-mostrar');
    if (naoMostrar) naoMostrar.checked = false;
    openModal('modal-venda-aviso');
};

document.getElementById('btn-venda-aviso-continuar')?.addEventListener('click', () => {
    if (document.getElementById('venda-aviso-nao-mostrar')?.checked) {
        try {
            localStorage.setItem(CHAVE_AVISO_VENDA_BALCAO, '1');
        } catch (erro) {
            console.warn('Preferência do aviso de venda não guardada:', erro);
        }
    }
    closeModal('modal-venda-aviso');
    abrirCheckout({});
});

/* "Concluir e receber": o atendimento chega com serviço, cliente e
   profissional já montados. É o caminho principal do balcão — o antigo
   "Confirmar Pagamento" continua existindo como saída de emergência enquanto
   a Fase C não fecha as portas concorrentes. */
window.abrirCheckoutDoAtendimento = function (apptId) {
    const appt = (data.appointments || []).find(a => a.id === apptId);
    if (!appt) return;

    if (!checkoutDisponivel()) {
        showToast('Checkout indisponível para este acesso. Usando a confirmação antiga.', 'warning');
        if (typeof openEditAppointment === 'function') openEditAppointment(apptId, 'pay');
        return;
    }

    const servico = (data.services || []).find(s => s.id === appt.serviceId);
    const itens = [];
    if (servico || appt.serviceId) {
        itens.push({
            tipo: 'service',
            refId: appt.serviceId || '',
            nome: servico ? servico.name : 'Serviço',
            quantidade: 1,
            // O valor combinado no atendimento manda sobre o preço de tabela:
            // é ele que o cliente ouviu.
            precoUnitario: appt.price !== undefined && appt.price !== null
                ? Number(appt.price)
                : (servico ? Number(servico.price) || 0 : 0),
            profissionalId: appt.profId || ''
        });
    }

    abrirCheckout({
        appointmentId: appt.id,
        clientId: appt.clientId || '',
        professionalId: appt.profId || '',
        competenceDate: appt.date || getLocalDateString(new Date()),
        itens: itens
    });
};

// --- SELECTS ----------------------------------------------------------------

function ordenarPorNome(lista) {
    return [...lista].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
}

function renderCheckoutSelects() {
    // Sem campo de busca: o próprio select já filtra pela digitação do
    // navegador, e uma caixa de pesquisa em cima dele era mais um lugar para o
    // balcão digitar antes de conseguir escolher o cliente.
    const clientes = ordenarPorNome((data.clients || []).filter(c => c && c.id));

    const selectCliente = document.getElementById('checkout-client');
    if (selectCliente) {
        selectCliente.innerHTML = '<option value="">Sem cliente (balcão)</option>' +
            clientes.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');
        selectCliente.value = clientes.some(c => c.id === checkoutState.clientId)
            ? checkoutState.clientId : '';
        checkoutState.clientId = selectCliente.value;
    }

    // O responsável já escolhido continua na lista mesmo desativado. Um
    // profissional que saiu do salão depois do agendamento sumiria do select,
    // e a venda gravaria sem dono — sem comissão e sem quem responder por ela.
    const profissionais = ordenarPorNome((data.professionals || []).filter(p =>
        p && p.id && (p.active !== false || p.id === checkoutState.professionalId)));
    const opcoesProf = profissionais
        .map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');

    // `checkoutState.professionalId` não tem mais campo na tela, mas continua
    // existindo: é por ele que o profissional do AGENDAMENTO chega na venda
    // vinda de "Concluir e receber", e é o padrão de um item de serviço que o
    // balcão não atribuiu a ninguém.
    const selectItemProf = document.getElementById('checkout-item-prof');
    if (selectItemProf) {
        const anterior = selectItemProf.value;
        // Opção em branco fica DESABILITADA de propósito: item de serviço sem
        // profissional some da base de comissão (21_comissoes.sql só gera
        // sale_commissions quando o item tem professional_id). Sem ela como
        // escolha possível, quem está no balcão é obrigado a escolher alguém
        // da lista real — ela só aparece pré-selecionada até isso acontecer.
        selectItemProf.innerHTML = '<option value="" disabled>Selecione o profissional</option>' + opcoesProf;
        selectItemProf.value = profissionais.some(p => p.id === anterior)
            ? anterior
            : (profissionais.some(p => p.id === checkoutState.professionalId) ? checkoutState.professionalId : '');
    }

    renderCheckoutCatalogo();
}

function renderCheckoutCatalogo() {
    const tipo = document.getElementById('checkout-item-type')?.value || 'service';
    const select = document.getElementById('checkout-item-ref');
    const campoProf = document.getElementById('checkout-item-prof');
    if (!select) return;

    if (tipo === 'service') {
        const servicos = ordenarPorNome((data.services || []).filter(s => s && s.id && s.active !== false));
        select.innerHTML = '<option value="">Escolha o serviço</option>' + servicos.map(s =>
            `<option value="${escapeHTML(s.id)}" data-preco="${Number(s.price) || 0}">${escapeHTML(s.name)} · ${formatCurrency(s.price)}</option>`
        ).join('');
    } else {
        // Produto sem estoque não aparece: vender o que não existe só produz
        // uma recusa da RPC no meio do atendimento.
        const produtos = ordenarPorNome((data.products || [])
            .filter(p => p && p.id && p.active !== false && (Number(p.stock) || 0) > 0));
        select.innerHTML = '<option value="">Escolha o produto</option>' + produtos.map(p =>
            `<option value="${escapeHTML(p.id)}" data-preco="${Number(p.price) || 0}">${escapeHTML(p.name)} · ${formatCurrency(p.price)} · ${Number(p.stock) || 0} un.</option>`
        ).join('');
    }

    // Produto não gera comissão, então escolher profissional para ele só
    // confundiria quem está fechando a conta.
    if (campoProf) {
        campoProf.disabled = tipo !== 'service';
        if (tipo !== 'service') campoProf.value = '';
    }
    atualizarPrecoSugerido();
}

function atualizarPrecoSugerido() {
    const select = document.getElementById('checkout-item-ref');
    const preco = document.getElementById('checkout-item-price');
    if (!select || !preco) return;
    const opcao = select.selectedOptions[0];
    preco.value = opcao && opcao.dataset.preco !== undefined ? opcao.dataset.preco : '';
}

// --- ITENS ------------------------------------------------------------------

window.adicionarItemAoCheckout = function () {
    const tipo = document.getElementById('checkout-item-type').value === 'product' ? 'product' : 'service';
    const select = document.getElementById('checkout-item-ref');
    const refId = select.value;
    if (!refId) {
        showToast(tipo === 'service' ? 'Escolha o serviço.' : 'Escolha o produto.', 'warning');
        return;
    }

    // Serviço sem profissional some da base de comissão: finalizar_venda só
    // gera sale_commissions quando o item tem professional_id (ver 21_comissoes.sql).
    // "Sem profissional" fica reservado para venda de balcão feita pela recepção
    // sobre um serviço que ninguém realizou de fato — não para esquecimento.
    const profissionalSelecionado = document.getElementById('checkout-item-prof').value || checkoutState.professionalId || '';
    if (tipo === 'service' && !profissionalSelecionado) {
        showToast('Escolha quem realizou o serviço, para a comissão não se perder.', 'warning');
        return;
    }

    const quantidade = Math.max(1, parseInt(document.getElementById('checkout-item-qty').value, 10) || 1);
    const precoDigitado = document.getElementById('checkout-item-price').value;
    const opcao = select.selectedOptions[0];
    const preco = precoDigitado === '' ? Number(opcao?.dataset.preco) || 0 : parseFloat(precoDigitado);

    if (!(preco >= 0)) {
        showToast('Informe um preço válido para o item.', 'warning');
        return;
    }

    const catalogo = tipo === 'service'
        ? (data.services || []).find(s => s.id === refId)
        : (data.products || []).find(p => p.id === refId);

    checkoutState.itens.push({
        uid: novoIdDeLinha(),
        tipo: tipo,
        refId: refId,
        nome: catalogo ? catalogo.name : 'Item',
        quantidade: quantidade,
        precoUnitario: Math.round(preco * 100) / 100,
        profissionalId: tipo === 'service' ? profissionalSelecionado : ''
    });

    select.value = '';
    document.getElementById('checkout-item-qty').value = 1;
    atualizarPrecoSugerido();
    renderCheckout();
};

window.removerItemDoCheckout = function (uid) {
    checkoutState.itens = checkoutState.itens.filter(item => item.uid !== uid);
    renderCheckout();
};

window.alterarQuantidadeDoCheckout = function (uid, valor) {
    const item = checkoutState.itens.find(i => i.uid === uid);
    if (!item) return;
    item.quantidade = Math.max(1, parseInt(valor, 10) || 1);
    renderCheckout();
};

function renderCheckoutItens(calculo) {
    const alvo = document.getElementById('checkout-items');
    if (!alvo) return;

    if (!calculo.itens.length) {
        alvo.innerHTML = '<p class="checkout-empty">Nenhum item na venda ainda.</p>';
        return;
    }

    alvo.innerHTML = calculo.itens.map(item => {
        const profissional = (data.professionals || []).find(p => p.id === item.profissionalId);
        const detalhe = item.tipo === 'service'
            ? (profissional ? escapeHTML(profissional.name) : 'Sem profissional')
            : 'Produto';
        return `
            <div class="checkout-item">
                <div class="checkout-item-main">
                    <strong>${escapeHTML(item.nome)}</strong>
                    <span>${detalhe} · ${formatCurrency(reaisDaVenda(item.unitarioCentavos))} cada</span>
                </div>
                <input type="number" class="form-control checkout-item-qty" step="1" min="1"
                       value="${item.quantidade}" aria-label="Quantidade de ${escapeHTML(item.nome)}"
                       data-checkout-qty="${escapeHTML(item.uid)}">
                <span class="checkout-item-total">${formatCurrency(reaisDaVenda(item.liquidoCentavos))}</span>
                <button type="button" class="btn-card-action" title="Tirar da venda"
                        data-checkout-remove="${escapeHTML(item.uid)}">
                    <i class="fa-solid fa-xmark text-danger"></i>
                </button>
            </div>`;
    }).join('');
}

// --- PAGAMENTOS -------------------------------------------------------------

window.adicionarPagamentoAoCheckout = function () {
    const metodo = document.getElementById('checkout-payment-method').value;
    const valorBruto = document.getElementById('checkout-payment-amount').value;
    const valor = parseFloat(valorBruto);

    if (!(valor > 0)) {
        showToast('Informe o valor recebido nesta forma de pagamento.', 'warning');
        return;
    }

    // `valorEntregue` sempre nulo: o campo que perguntava a nota que o cliente
    // estendeu saiu da tela. Sem ele não há troco a calcular — o que se lança é
    // o que a venda recebeu, que é o número que interessa ao caixa e ao
    // faturamento. O motor continua sabendo ler o troco de uma venda antiga.
    checkoutState.pagamentos.push({
        uid: novoIdDeLinha(),
        metodo: metodo,
        valor: Math.round(valor * 100) / 100,
        valorEntregue: null
    });

    renderCheckout();
};

window.removerPagamentoDoCheckout = function (uid) {
    checkoutState.pagamentos = checkoutState.pagamentos.filter(p => p.uid !== uid);
    renderCheckout();
};

function renderCheckoutPagamentos(calculo) {
    const alvo = document.getElementById('checkout-payments');
    if (!alvo) return;

    if (!calculo.pagamentos.length) {
        alvo.innerHTML = '<p class="checkout-empty">Nenhum pagamento lançado.</p>';
        return;
    }

    alvo.innerHTML = calculo.pagamentos.map(pagamento => `
        <div class="checkout-payment">
            <span class="checkout-payment-method">${escapeHTML(salePaymentMethodLabel(pagamento.metodo))}</span>
            <span class="checkout-payment-amount">${formatCurrency(reaisDaVenda(pagamento.valorCentavos))}</span>
            <span class="checkout-payment-change"></span>
            <button type="button" class="btn-card-action" title="Tirar o pagamento"
                    data-checkout-remove-payment="${escapeHTML(pagamento.uid)}">
                <i class="fa-solid fa-xmark text-danger"></i>
            </button>
        </div>`).join('');
}

// --- CREDIÁRIO --------------------------------------------------------------

/* O bloco de crediário só aparece quando ainda falta receber. Mostrá-lo numa
   venda já quitada seria oferecer uma dívida que ninguém pediu — e o balcão
   marca sem ler. */
function renderCheckoutCrediario(calculo) {
    const bloco = document.getElementById('checkout-credit-block');
    const campos = document.getElementById('checkout-credit-fields');
    const ligado = document.getElementById('checkout-credit-on');
    const lista = document.getElementById('checkout-credit-list');
    if (!bloco || !ligado || !campos || !lista) return;

    const falta = calculo.restanteCentavos > 0;
    bloco.hidden = !falta;

    // Quitou depois de ter ligado o crediário: desliga sozinho, senão a venda
    // sairia com uma dívida de zero.
    if (!falta && ligado.checked) {
        ligado.checked = false;
        checkoutState.crediario.ativo = false;
    }

    campos.hidden = !ligado.checked;
    if (!ligado.checked || !calculo.aPrazoCentavos) {
        lista.innerHTML = '';
        return;
    }

    const plano = planoDeCrediario(checkoutState, calculo);
    const parcelas = plano ? plano.installments : [];
    const soma = parcelas.reduce((s, p) => s + centavosDaVenda(p.amount), 0);
    const fecha = soma === calculo.aPrazoCentavos;

    lista.innerHTML = `
        <div class="checkout-credit-parcelas">
            ${parcelas.map((p, i) => `
                <div class="checkout-credit-linha">
                    <span class="checkout-credit-num">${i + 1}/${parcelas.length}</span>
                    <input type="date" class="form-control" value="${escapeHTML(p.dueDate || '')}"
                           data-credit-date="${i}" aria-label="Vencimento da parcela ${i + 1}">
                    <input type="number" class="form-control" step="0.01" min="0.01"
                           value="${Number(p.amount).toFixed(2)}"
                           data-credit-amount="${i}" aria-label="Valor da parcela ${i + 1}">
                </div>`).join('')}
        </div>
        <div class="checkout-credit-soma ${fecha ? 'checkout-ok' : 'checkout-pending'}">
            <span>Soma das parcelas</span>
            <strong>${formatCurrency(reaisDaVenda(soma))}${fecha ? '' :
                ' de ' + formatCurrency(reaisDaVenda(calculo.aPrazoCentavos))}</strong>
        </div>`;

    // Editar uma parcela CONGELA o plano: a partir daí os valores digitados
    // mandam, e mexer na quantidade recalcula tudo de novo do zero.
    lista.querySelectorAll('[data-credit-date], [data-credit-amount]').forEach(campo => {
        campo.addEventListener('change', function () {
            const atual = planoDeCrediario(checkoutState, calcularVenda(checkoutState));
            const base = (checkoutState.crediario.parcelas && checkoutState.crediario.parcelas.length)
                ? checkoutState.crediario.parcelas
                : (atual ? atual.installments.map(p => ({ vencimento: p.dueDate, valor: p.amount })) : []);

            const indice = Number(this.dataset.creditDate ?? this.dataset.creditAmount);
            if (!base[indice]) return;

            if (this.dataset.creditDate !== undefined) base[indice].vencimento = this.value;
            else base[indice].valor = parseFloat(this.value) || 0;

            checkoutState.crediario.parcelas = base;
            renderCheckout();
        });
    });
}

// --- FIDELIDADE --------------------------------------------------------------

/* Mostra o aviso quando o cliente escolhido tem saldo suficiente. Trocar de
   cliente esquece um "Aplicar" anterior — o desconto continuaria na tela, mas
   deixaria de ter dono, e resgatar sem saber de quem seria inventar. */
function renderCheckoutFidelidade() {
    const banner = document.getElementById('checkout-loyalty-banner');
    if (!banner) return;

    if (checkoutState.fidelidade.clientId && checkoutState.fidelidade.clientId !== checkoutState.clientId) {
        checkoutState.fidelidade = { aplicado: false, clientId: '' };
    }

    const beneficio = typeof beneficioFidelidadeDoCliente === 'function'
        ? beneficioFidelidadeDoCliente(checkoutState.clientId)
        : null;

    if (!beneficio) {
        banner.hidden = true;
        return;
    }

    banner.hidden = false;
    banner.classList.toggle('fid-checkout-banner-aplicado', checkoutState.fidelidade.aplicado);

    const texto = document.getElementById('checkout-loyalty-text');
    if (texto) {
        texto.innerText = `${beneficio.cliente.name} tem "${beneficio.programa.benefit_description}" disponível (${beneficio.pontos}/${beneficio.meta} pontos).`;
    }

    const botao = document.getElementById('btn-checkout-loyalty-apply');
    if (botao) {
        botao.disabled = checkoutState.fidelidade.aplicado;
        botao.innerText = checkoutState.fidelidade.aplicado ? 'Aplicado' : 'Aplicar';
    }
}

window.aplicarBeneficioNoCheckout = function () {
    const beneficio = typeof beneficioFidelidadeDoCliente === 'function'
        ? beneficioFidelidadeDoCliente(checkoutState.clientId)
        : null;
    if (!beneficio) return;

    // Sobrescreve o desconto da venda com o do benefício. Os dois discos ao
    // mesmo tempo (um manual e um de fidelidade) não têm um lugar próprio
    // nesta tela — o balcão escolhe um dos dois.
    document.getElementById('checkout-discount-type').value = beneficio.programa.benefit_type;
    document.getElementById('checkout-discount-value').value = Number(beneficio.programa.benefit_value) || 0;

    checkoutState.fidelidade = { aplicado: true, clientId: checkoutState.clientId };
    renderCheckout();
};

function lerCrediarioDoCheckout() {
    const ligado = document.getElementById('checkout-credit-on');
    const quantidade = document.getElementById('checkout-credit-count');
    const primeiro = document.getElementById('checkout-credit-first');

    checkoutState.crediario.ativo = !!(ligado && ligado.checked);
    checkoutState.crediario.quantidade = Math.max(1, Math.min(36,
        parseInt(quantidade && quantidade.value, 10) || 1));
    checkoutState.crediario.primeiroVencimento = (primeiro && primeiro.value) || '';
}

// --- RESUMO E ESTADO DA TELA ------------------------------------------------

function lerAjustesDoCheckout() {
    checkoutState.desconto = {
        tipo: document.getElementById('checkout-discount-type')?.value === 'percent' ? 'percent' : 'amount',
        valor: parseFloat(document.getElementById('checkout-discount-value')?.value) || 0
    };
    // Acréscimo não tem mais campo na tela; a venda nova nasce sempre com zero.
    // O campo continua no estado porque calcularVenda() e o payload da RPC o
    // esperam, e porque uma venda antiga que tem acréscimo precisa continuar
    // somando certo em toda leitura.
    checkoutState.acrescimo = { tipo: 'amount', valor: 0 };
    checkoutState.notas = document.getElementById('checkout-notes')?.value || '';
    lerCrediarioDoCheckout();
}

function renderCheckout() {
    lerAjustesDoCheckout();
    const calculo = calcularVenda(checkoutState);

    renderCheckoutItens(calculo);
    renderCheckoutPagamentos(calculo);
    renderCheckoutCrediario(calculo);
    renderCheckoutFidelidade();

    const linhas = [
        ['Serviços', reaisDaVenda(calculo.subtotalServicosCentavos)],
        ['Produtos', reaisDaVenda(calculo.subtotalProdutosCentavos)],
        ['Subtotal', reaisDaVenda(calculo.subtotalCentavos)]
    ];
    if (calculo.descontoCentavos > 0) linhas.push(['Desconto', -reaisDaVenda(calculo.descontoCentavos)]);
    if (calculo.acrescimoCentavos > 0) linhas.push(['Acréscimo', reaisDaVenda(calculo.acrescimoCentavos)]);

    const resumo = document.getElementById('checkout-summary');
    if (resumo) {
        resumo.innerHTML = linhas.map(([rotulo, valor]) => `
            <div class="checkout-summary-line">
                <span>${escapeHTML(rotulo)}</span><strong>${formatCurrency(valor)}</strong>
            </div>`).join('') + `
            <div class="checkout-summary-line checkout-summary-total">
                <span>Total</span><strong id="checkout-total">${formatCurrency(reaisDaVenda(calculo.totalCentavos))}</strong>
            </div>
            <div class="checkout-summary-line">
                <span>Recebido</span><strong>${formatCurrency(reaisDaVenda(calculo.recebidoCentavos))}</strong>
            </div>
            <div class="checkout-summary-line ${calculo.restanteCentavos === 0 ? 'checkout-ok' : 'checkout-pending'}">
                <span>${calculo.restanteCentavos < 0 ? 'Excedente' : 'Falta receber'}</span>
                <strong id="checkout-remaining">${formatCurrency(reaisDaVenda(Math.abs(calculo.restanteCentavos)))}</strong>
            </div>` + (calculo.aPrazoCentavos > 0 ? `
            <div class="checkout-summary-line checkout-summary-credit">
                <span><i class="fa-solid fa-clock-rotate-left"></i> A prazo</span>
                <strong id="checkout-credit-total">${formatCurrency(reaisDaVenda(calculo.aPrazoCentavos))}</strong>
            </div>` : '');
    }

    const chip = document.getElementById('checkout-total-chip');
    if (chip) chip.innerText = formatCurrency(reaisDaVenda(calculo.totalCentavos));

    // O campo de pagamento já vem com o que falta: no caso comum (uma forma
    // só), fechar a conta é escolher a forma e clicar em somar.
    const campoValor = document.getElementById('checkout-payment-amount');
    if (campoValor && document.activeElement !== campoValor) {
        campoValor.value = calculo.restanteCentavos > 0
            ? reaisDaVenda(calculo.restanteCentavos).toFixed(2)
            : '';
    }

    const avisos = conferirEstoqueDaVenda(calculo);
    const caixaErros = document.getElementById('checkout-errors');
    if (caixaErros) {
        caixaErros.hidden = avisos.length === 0;
        caixaErros.innerHTML = avisos.map(aviso =>
            `<div><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(aviso)}</div>`).join('');
    }

    const botao = document.getElementById('btn-checkout-finish');
    if (botao) {
        // Fase E: a venda tambem fecha quando o restante vira divida. Quem diz
        // se o plano esta valido e validarVenda — aqui so se pergunta se sobrou
        // alguma pendencia.
        const fechou = calculo.restanteCentavos === 0 ||
            (calculo.aPrazoCentavos > 0 && validarVenda(calculo, checkoutState).length === 0);
        const pronto = calculo.itens.length > 0 && fechou && !avisos.length;
        botao.disabled = checkoutState.enviando || !pronto;
    }

    return calculo;
}

// --- FINALIZACAO ------------------------------------------------------------

/* Guarda o que a nuvem devolveu no estado local, para a tela responder na hora
   sem esperar a próxima atualização automática. Substitui pelo id: uma
   repetição idempotente traz a MESMA venda, e ela não pode entrar duas vezes
   na lista. */
function guardarRetornoDaVenda(retorno) {
    const juntar = (colecao, registros, chave) => {
        (registros || []).forEach(registro => {
            const indice = colecao.findIndex(existente => existente[chave] === registro[chave]);
            if (indice === -1) colecao.push(registro);
            else colecao[indice] = registro;
        });
    };

    data.sales = data.sales || [];
    juntar(data.sales, retorno.venda ? [retorno.venda] : [], 'id');
    data.saleItems = data.saleItems || [];
    juntar(data.saleItems, retorno.itens, 'id');
    data.salePayments = data.salePayments || [];
    juntar(data.salePayments, retorno.pagamentos, 'id');
    data.transactions = data.transactions || [];
    juntar(data.transactions, retorno.transacoes, 'id');
    data.stockMovements = data.stockMovements || [];
    juntar(data.stockMovements, retorno.movimentos, 'id');

    (retorno.produtos || []).forEach(atualizado => {
        const produto = (data.products || []).find(p => p.id === atualizado.id);
        if (produto && typeof atualizado.stock === 'number') produto.stock = atualizado.stock;
    });

    if (retorno.atendimento) {
        const indice = (data.appointments || []).findIndex(a => a.id === retorno.atendimento.id);
        if (indice !== -1) data.appointments[indice] = retorno.atendimento;
    }

    // O cache local é espelho, não fonte: a nuvem já gravou tudo pela RPC.
    // Estas chaves não passam pelo save() genérico de propósito — ver o
    // comentário em api.js.
    try {
        localStorage.setItem(STATE_KEYS.SALES, JSON.stringify(data.sales));
        localStorage.setItem(STATE_KEYS.SALE_ITEMS, JSON.stringify(data.saleItems));
        localStorage.setItem(STATE_KEYS.SALE_PAYMENTS, JSON.stringify(data.salePayments));
        localStorage.setItem(STATE_KEYS.TRANSACTIONS, JSON.stringify(data.transactions));
        localStorage.setItem(STATE_KEYS.STOCK_MOVEMENTS, JSON.stringify(data.stockMovements));
        localStorage.setItem(STATE_KEYS.PRODUCTS, JSON.stringify(data.products));
        localStorage.setItem(STATE_KEYS.APPOINTMENTS, JSON.stringify(data.appointments));
    } catch (erro) {
        console.warn('Cache local da venda não atualizado:', erro);
    }
}

window.finalizarCheckout = async function () {
    if (checkoutState.enviando) return;

    const calculo = renderCheckout();
    const erros = validarVenda(calculo, checkoutState);
    if (erros.length) {
        showToast(erros[0], 'warning');
        return;
    }

    checkoutState.clientId = document.getElementById('checkout-client')?.value || '';
    // `professionalId` não vem mais de um campo: ou chegou do agendamento, ou a
    // venda de balcão não tem um responsável geral — cada item tem o seu.
    const payload = montarPayloadDaVenda(checkoutState, calculo);

    const botao = document.getElementById('btn-checkout-finish');
    checkoutState.enviando = true;
    if (botao) {
        botao.disabled = true;
        botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Concluindo...';
    }

    try {
        let retorno;

        if (DataService.isSupabaseConfigured()) {
            // Produção: só a RPC decide. Nada de gravação local de consolo.
            retorno = await DataService.finalizarVenda(payload);
            if (!retorno || !retorno.ok) {
                const motivo = retorno && retorno.faltaMigration
                    ? 'A estrutura de Vendas ainda não foi aplicada no Supabase (docs/sql/15_finalizacao_venda.sql).'
                    : (retorno && retorno.motivo) || 'Não foi possível concluir a venda.';
                showToast(motivo, 'danger');
                return;
            }
        } else {
            // Modo local/demonstração: mesma conta, mesmas recusas, sem nuvem.
            retorno = finalizarVendaLocalmente(payload);
        }

        guardarRetornoDaVenda(retorno);

        const numero = retorno.venda
            ? String(retorno.venda.sale_number || retorno.venda.saleNumber || '').padStart(6, '0')
            : '';
        showToast(
            retorno.repetida
                ? `Esta venda já estava concluída${numero ? ' (#' + numero + ')' : ''}. Nada foi cobrado de novo.`
                : `Venda ${numero ? '#' + numero + ' ' : ''}concluída: ${formatCurrency(reaisDaVenda(calculo.totalCentavos))}.`,
            retorno.repetida ? 'info' : 'success'
        );

        // Fidelidade: o resgate acontece DEPOIS da venda confirmada, nunca
        // antes. Se falhar aqui, a venda já está feita e o desconto já saiu —
        // o que não pode acontecer é o contrário (pontos descontados e a
        // venda não ter ido para frente). O toast avisa para o dono conferir
        // na aba, em vez de travar o sucesso da venda por causa disso.
        if (checkoutState.fidelidade.aplicado && checkoutState.fidelidade.clientId && retorno.venda) {
            try {
                const resgate = await resgatarBeneficio(checkoutState.fidelidade.clientId, retorno.venda.id);
                if (resgate && resgate.ok) {
                    const cliente = (data.clients || []).find(c => c.id === checkoutState.fidelidade.clientId);
                    const programa = typeof programaDeFidelidade === 'function' ? programaDeFidelidade() : null;
                    if (cliente && programa && !resgate.repetida) {
                        cliente.loyaltyPoints = Math.max(0, (Number(cliente.loyaltyPoints) || 0) - (Number(programa.goal) || 0));
                    }
                } else {
                    // resgatarBeneficio() já mostrou o motivo específico (saldo
                    // insuficiente, servidor fora do ar etc.). Este segundo aviso
                    // existe para deixar claro que a VENDA em si não foi afetada —
                    // sem ele, o dono poderia achar que a venda inteira falhou.
                    showToast('A venda foi concluída, mas o resgate do benefício falhou. Confira na aba Fidelidade.', 'warning');
                }
            } catch (erroResgate) {
                console.error('Falha ao resgatar fidelidade após a venda:', erroResgate);
                showToast('A venda foi concluída, mas o resgate do benefício falhou. Confira na aba Fidelidade.', 'warning');
            }
        }

        closeModal('modal-checkout');
        const clienteDaVenda = checkoutState.clientId;
        checkoutState.itens = [];
        checkoutState.pagamentos = [];
        checkoutState.idempotencyKey = '';
        checkoutState.crediario = { ativo: false, quantidade: 1, primeiroVencimento: '', parcelas: null };
        checkoutState.fidelidade = { aplicado: false, clientId: '' };

        const abaAtiva = document.querySelector('.menu-item.active')?.getAttribute('data-target') || 'vendas';
        if (typeof renderPageData === 'function') renderPageData(abaAtiva);

        // A oferta do recibo vem por último, com a venda já gravada e a tela já
        // atualizada: se ela falhasse, a venda continuaria feita.
        if (retorno.venda) oferecerReciboDaVenda(retorno.venda, clienteDaVenda, numero);
    } catch (erro) {
        console.error('Falha ao concluir a venda:', erro);
        showToast(erro.message || 'Não foi possível concluir a venda.', 'danger');
    } finally {
        checkoutState.enviando = false;
        if (botao) botao.innerHTML = '<i class="fa-solid fa-circle-check"></i> Finalizar venda';
        renderCheckout();
    }
};

// --- RECIBO LOGO APOS A VENDA -----------------------------------------------

/* Qual venda o pop-up do recibo está tratando. Guardado aqui, e não no
   `onclick` de cada botão, porque a chave da venda é montada uma vez só — os
   dois botões precisam falar da MESMA venda, e um `data-` no HTML seria mais
   um lugar de onde ela poderia sair errada. */
let vendaDoReciboPendente = { key: '', temTelefone: false };

/* Oferece o recibo no único momento em que o cliente ainda está na frente do
   balcão. Depois disso o recibo continua saindo por Vendas → Detalhes, que é
   de onde ele sempre pôde ser tirado — por isso o "Agora não" não perde nada. */
function oferecerReciboDaVenda(venda, clientId, numeroFormatado) {
    const modal = document.getElementById('modal-venda-recibo');
    if (!modal || !venda || !venda.id) return;

    // Sem a infraestrutura de recibo carregada (instalação antiga, script fora
    // do ar) não há o que oferecer — melhor não abrir o pop-up do que abrir um
    // com dois botões que não fazem nada.
    if (typeof gerarReciboVenda !== 'function') return;

    const cliente = (data.clients || []).find(c => c.id === clientId);
    const telefone = cliente && cliente.phone ? String(cliente.phone) : '';
    vendaDoReciboPendente = { key: 'sale:' + String(venda.id), temTelefone: !!telefone };

    const resumo = document.getElementById('venda-recibo-resumo');
    if (resumo) {
        const total = Number(venda.total) || 0;
        resumo.innerHTML = `Venda ${numeroFormatado ? '<strong>#' + escapeHTML(numeroFormatado) + '</strong> ' : ''}` +
            `de <strong>${escapeHTML(formatCurrency(total))}</strong>` +
            (cliente ? ` para <strong>${escapeHTML(cliente.name)}</strong>` : ' no balcão') + '.';
    }

    // Sem telefone cadastrado não há para onde enviar — mesma regra da cobrança
    // do crediário e do aviso de fidelidade.
    const botaoWhats = document.getElementById('btn-venda-recibo-whatsapp');
    if (botaoWhats) botaoWhats.hidden = !telefone;

    openModal('modal-venda-recibo');
}

document.getElementById('btn-venda-recibo-pdf')?.addEventListener('click', () => {
    const chave = vendaDoReciboPendente.key;
    closeModal('modal-venda-recibo');
    if (chave) gerarReciboVenda(chave);
});

document.getElementById('btn-venda-recibo-whatsapp')?.addEventListener('click', () => {
    const chave = vendaDoReciboPendente.key;
    closeModal('modal-venda-recibo');
    if (chave) enviarReciboPorWhatsApp(chave);
});

// --- CADASTRO RAPIDO DE CLIENTE ---------------------------------------------

window.salvarClienteDoCheckout = function () {
    const nome = sanitizePlainText(document.getElementById('checkout-new-client-name').value);
    const telefone = sanitizePlainText(document.getElementById('checkout-new-client-phone').value);

    if (!nome) {
        showToast('Informe o nome do cliente.', 'warning');
        return;
    }

    const repetido = telefone && (data.clients || []).find(c => c.phone === telefone);
    if (repetido) {
        showToast(`Este WhatsApp já é de ${repetido.name}.`, 'warning');
        checkoutState.clientId = repetido.id;
    } else {
        // Tem cadastro, já faz parte do clube (docs/sql/25).
        const novo = { id: 'cli-' + Date.now(), name: nome, phone: telefone, lastVisit: null, loyaltyEnrolled: true, loyaltyPoints: 0 };
        data.clients.push(novo);
        saveData(STATE_KEYS.CLIENTS, data.clients);
        checkoutState.clientId = novo.id;
        showToast('Cliente cadastrado.', 'success');
    }

    document.getElementById('checkout-new-client-name').value = '';
    document.getElementById('checkout-new-client-phone').value = '';
    document.getElementById('checkout-quick-client').hidden = true;
    renderCheckoutSelects();
    renderCheckout();
};

// --- LIGACOES DA TELA -------------------------------------------------------

document.getElementById('checkout-item-type')?.addEventListener('change', renderCheckoutCatalogo);
document.getElementById('checkout-item-ref')?.addEventListener('change', atualizarPrecoSugerido);
document.getElementById('btn-checkout-add-item')?.addEventListener('click', adicionarItemAoCheckout);
document.getElementById('btn-checkout-add-payment')?.addEventListener('click', adicionarPagamentoAoCheckout);
document.getElementById('btn-checkout-finish')?.addEventListener('click', finalizarCheckout);
document.getElementById('btn-new-sale')?.addEventListener('click', abrirCheckoutDeBalcao);
document.getElementById('btn-checkout-save-client')?.addEventListener('click', salvarClienteDoCheckout);

document.getElementById('btn-checkout-new-client')?.addEventListener('click', () => {
    const bloco = document.getElementById('checkout-quick-client');
    if (bloco) bloco.hidden = !bloco.hidden;
});

document.getElementById('checkout-client')?.addEventListener('change', event => {
    checkoutState.clientId = event.target.value;
    // O aviso de fidelidade acompanha o cliente escolhido: sem isto ele só
    // apareceria no próximo redesenho, depois de mexer em outra coisa.
    renderCheckout();
});

['checkout-discount-type', 'checkout-discount-value'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderCheckout);
    document.getElementById(id)?.addEventListener('change', renderCheckout);
});

// Mexer na quantidade ou na data-base joga fora as parcelas editadas à mão: o
// usuário está pedindo um plano novo, e manter as edições antigas devolveria
// uma lista que não bate com o que ele acabou de escolher.
['checkout-credit-count', 'checkout-credit-first'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
        checkoutState.crediario.parcelas = null;
        renderCheckout();
    });
});

document.getElementById('checkout-credit-on')?.addEventListener('change', () => {
    checkoutState.crediario.parcelas = null;
    renderCheckout();
});

document.getElementById('btn-checkout-loyalty-apply')?.addEventListener('click', aplicarBeneficioNoCheckout);

// Um ouvinte no container em vez de um por linha: a lista é redesenhada a cada
// mudança, e ouvintes presos às linhas antigas ficariam pendurados.
document.getElementById('checkout-items')?.addEventListener('click', event => {
    const botao = event.target.closest('[data-checkout-remove]');
    if (botao) removerItemDoCheckout(botao.dataset.checkoutRemove);
});

document.getElementById('checkout-items')?.addEventListener('change', event => {
    const campo = event.target.closest('[data-checkout-qty]');
    if (campo) alterarQuantidadeDoCheckout(campo.dataset.checkoutQty, campo.value);
});

document.getElementById('checkout-payments')?.addEventListener('click', event => {
    const botao = event.target.closest('[data-checkout-remove-payment]');
    if (botao) removerPagamentoDoCheckout(botao.dataset.checkoutRemovePayment);
});
