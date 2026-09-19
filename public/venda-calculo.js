/**
 * ==========================================================================
 * VENDA — BASE DE CALCULO
 *
 * A conta da venda mora aqui, sem DOM. A tela do checkout, o simulador do
 *    modo local e os testes leem todos deste arquivo — cada regra copiada para
 *    dentro de uma tela vira um total diferente em algum lugar, e o cliente nao
 *    tem como saber qual esta certo.
 *
 *    ⚠️ Este arquivo PROPOE os numeros. Quem decide e a RPC finalizar_venda
 *    (docs/sql/15_finalizacao_venda.sql): ela recalcula tudo e recusa a venda
 *    quando a soma nao fecha. Mexer numa regra aqui sem mexer la faz a venda
 *    ser recusada pelo banco, que e o comportamento certo.
 *
 * Carregado por <script> em index.html, na ordem do numero do arquivo.
 * Tudo compartilha o mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

// Formas de pagamento do checkout. Crediario NAO entra: ele e saldo a receber,
// nao dinheiro recebido, e chega na Fase E com estrutura propria.
const FORMAS_DE_PAGAMENTO_DA_VENDA = [
    { id: 'pix', label: 'Pix' },
    { id: 'cash', label: 'Dinheiro' },
    { id: 'debit_card', label: 'Débito' },
    { id: 'credit_card', label: 'Crédito' }
];

/* --- Dinheiro em centavos -------------------------------------------------
   Toda a conta roda em inteiro. Em ponto flutuante, 0.1 + 0.2 nao da 0.3, e
   uma venda de tres itens com desconto fecha com um centavo sobrando — que o
   banco recusa, porque la a soma tem que bater exatamente. */
function centavosDaVenda(valor) {
    return Math.round((Number(valor) || 0) * 100);
}

function reaisDaVenda(centavos) {
    return Math.round(centavos) / 100;
}

/* Reparte um total inteiro entre pesos sem perder nem inventar centavo.

   Divisao proporcional simples deixa sobra: R$ 10,00 de desconto em tres itens
   iguais da 333 + 333 + 333 = 999. O centavo que falta vai para quem tem a
   maior fracao — e, no empate, para o primeiro item, para o resultado ser
   sempre o mesmo entre a tela e o teste. */
function distribuirCentavos(total, pesos) {
    const zerado = pesos.map(() => 0);
    const somaDosPesos = pesos.reduce((soma, peso) => soma + peso, 0);
    if (total <= 0 || somaDosPesos <= 0) return zerado;

    const exatos = pesos.map(peso => (total * peso) / somaDosPesos);
    const partes = exatos.map(valor => Math.floor(valor));
    let sobra = total - partes.reduce((soma, parte) => soma + parte, 0);

    exatos
        .map((valor, indice) => ({ indice: indice, fracao: valor - Math.floor(valor) }))
        .sort((a, b) => (b.fracao - a.fracao) || (a.indice - b.indice))
        .forEach(candidato => {
            if (sobra > 0) { partes[candidato.indice]++; sobra--; }
        });

    return partes;
}

function ajusteEmCentavos(ajuste, subtotalCentavos) {
    if (!ajuste) return 0;
    const valor = Number(ajuste.valor) || 0;
    if (valor <= 0) return 0;
    if (ajuste.tipo === 'percent') return Math.round((subtotalCentavos * valor) / 100);
    return centavosDaVenda(valor);
}

/* --- A conta da venda -----------------------------------------------------

   Regras de negocio fechadas na Fase A:
     - o desconto e rateado proporcionalmente entre TODOS os itens;
     - a comissao incide so sobre servico, e sobre o valor ja descontado;
     - acrescimo nao aumenta a base de comissao no MVP;
     - dinheiro entregue a mais e troco, nunca faturamento. */
function calcularVenda(rascunho) {
    const itens = (rascunho.itens || []).map(item => {
        const quantidade = Math.max(1, parseInt(item.quantidade, 10) || 0);
        const unitario = centavosDaVenda(item.precoUnitario);
        return {
            uid: item.uid,
            tipo: item.tipo === 'product' ? 'product' : 'service',
            refId: item.refId || '',
            nome: item.nome || '',
            profissionalId: item.profissionalId || '',
            quantidade: quantidade,
            unitarioCentavos: Math.max(0, unitario),
            brutoCentavos: Math.max(0, unitario) * quantidade
        };
    });

    const subtotalServicos = itens.filter(i => i.tipo === 'service')
        .reduce((soma, i) => soma + i.brutoCentavos, 0);
    const subtotalProdutos = itens.filter(i => i.tipo === 'product')
        .reduce((soma, i) => soma + i.brutoCentavos, 0);
    const subtotal = subtotalServicos + subtotalProdutos;

    // Desconto maior que a venda vira desconto de 100%: o total nunca fica
    // negativo, e o banco recusaria de qualquer forma.
    const desconto = Math.min(ajusteEmCentavos(rascunho.desconto, subtotal), subtotal);
    const acrescimo = ajusteEmCentavos(rascunho.acrescimo, subtotal);

    const pesos = itens.map(i => i.brutoCentavos);
    const descontos = distribuirCentavos(desconto, pesos);
    const acrescimos = distribuirCentavos(acrescimo, pesos);

    itens.forEach((item, indice) => {
        item.descontoCentavos = descontos[indice];
        item.acrescimoCentavos = acrescimos[indice];
        item.liquidoCentavos = item.brutoCentavos - descontos[indice] + acrescimos[indice];
        // A base congelada da comissao. O percentual sai do cadastro do
        // profissional no banco, na hora de gravar — nunca daqui.
        item.baseComissaoCentavos = item.tipo === 'service'
            ? item.brutoCentavos - descontos[indice]
            : 0;
    });

    const total = subtotal - desconto + acrescimo;

    const pagamentos = (rascunho.pagamentos || []).map(pagamento => {
        const valor = Math.max(0, centavosDaVenda(pagamento.valor));
        const entregue = pagamento.metodo === 'cash'
            ? Math.max(valor, centavosDaVenda(pagamento.valorEntregue || pagamento.valor))
            : null;
        return {
            uid: pagamento.uid,
            metodo: pagamento.metodo,
            valorCentavos: valor,
            entregueCentavos: entregue,
            trocoCentavos: entregue === null ? 0 : entregue - valor
        };
    });

    const recebido = pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0);
    const troco = pagamentos.reduce((soma, p) => soma + p.trocoCentavos, 0);

    return {
        itens: itens,
        pagamentos: pagamentos,
        subtotalServicosCentavos: subtotalServicos,
        subtotalProdutosCentavos: subtotalProdutos,
        subtotalCentavos: subtotal,
        descontoCentavos: desconto,
        acrescimoCentavos: acrescimo,
        totalCentavos: total,
        recebidoCentavos: recebido,
        trocoCentavos: troco,
        // Diferenca do que falta receber. Positivo = falta; negativo = passou.
        restanteCentavos: total - recebido,
        // Fase E: o que fica a prazo. So existe quando alguem LIGOU o crediario
        // — sem isso, restante > 0 continua sendo uma venda que nao fecha, e
        // nao uma divida criada sem querer.
        aPrazoCentavos: (rascunho.crediario && rascunho.crediario.ativo)
            ? Math.max(0, total - recebido)
            : 0
    };
}

/* --- CREDIÁRIO ------------------------------------------------------------
   As parcelas em centavos inteiros, com o resto indo para a PRIMEIRA.

   O resto vai para a primeira, e não para a última, de propósito: quem paga
   prefere que a diferença de centavos apareça no boleto de agora, que ele já
   está vendo, do que numa parcela lá na frente. E fecha a conta do mesmo jeito
   — o que não pode acontecer é a soma não bater com a dívida, que é o critério
   de aceite da fase. */
function dividirEmParcelas(totalCentavos, quantidade) {
    const qtd = Math.max(1, Math.min(36, parseInt(quantidade, 10) || 1));
    const base = Math.floor(totalCentavos / qtd);
    const resto = totalCentavos - (base * qtd);

    return Array.from({ length: qtd }, (_, i) => base + (i === 0 ? resto : 0));
}

/* Vencimentos a partir de uma data, de mês em mês.

   Dia 31 não existe em todo mês. `new Date(2026, 1, 31)` vira 3 de março, e a
   parcela de fevereiro apareceria em março — parecendo atrasada no dia em que
   nasceu. Por isso o dia é limitado ao último do mês de destino. */
function vencimentosMensais(primeiroISO, quantidade) {
    const base = new Date((primeiroISO || getLocalDateString(new Date())) + 'T12:00:00');
    if (isNaN(base.getTime())) return [];

    const diaDesejado = base.getDate();
    return Array.from({ length: quantidade }, (_, i) => {
        const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
        const ultimoDoMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(diaDesejado, ultimoDoMes));
        return getLocalDateString(d);
    });
}

/* O plano montado a partir do que a tela pediu. Se o usuário editou valores à
   mão, `rascunho.crediario.parcelas` manda; senão, divide igual. */
function planoDeCrediario(rascunho, calculo) {
    if (!calculo.aPrazoCentavos) return null;

    const credito = rascunho.crediario || {};
    const editadas = Array.isArray(credito.parcelas) ? credito.parcelas : null;

    if (editadas && editadas.length) {
        return {
            installments: editadas.map(p => ({
                dueDate: p.vencimento,
                amount: reaisDaVenda(centavosDaVenda(p.valor))
            }))
        };
    }

    const quantidade = Math.max(1, Math.min(36, parseInt(credito.quantidade, 10) || 1));
    const valores = dividirEmParcelas(calculo.aPrazoCentavos, quantidade);
    const datas = vencimentosMensais(credito.primeiroVencimento, quantidade);

    return {
        installments: valores.map((centavos, i) => ({
            dueDate: datas[i],
            amount: reaisDaVenda(centavos)
        }))
    };
}

/* Quanto de cada produto a venda pede, somando linhas repetidas. Dois itens do
   mesmo shampoo sao uma unica conferencia de saldo — separados, cada um
   passaria pelo estoque como se o outro nao existisse. */
function produtosPedidosNaVenda(calculo) {
    const pedidos = new Map();
    calculo.itens
        .filter(item => item.tipo === 'product' && item.refId)
        .forEach(item => {
            pedidos.set(item.refId, (pedidos.get(item.refId) || 0) + item.quantidade);
        });
    return pedidos;
}

/* Aviso antecipado, nao a protecao. Quem recusa de verdade e a RPC, que le o
   saldo com a linha bloqueada — o numero desta tela pode estar velho de dois
   minutos, e dois caixas vendendo a ultima unidade veem os dois "tem 1". */
function conferirEstoqueDaVenda(calculo) {
    const problemas = [];
    produtosPedidosNaVenda(calculo).forEach((quantidade, produtoId) => {
        const produto = (data.products || []).find(p => p.id === produtoId);
        if (!produto) {
            problemas.push('Um dos produtos não está mais no catálogo.');
            return;
        }
        const disponivel = Math.max(0, Number(produto.stock) || 0);
        if (quantidade > disponivel) {
            problemas.push(`${produto.name}: a venda pede ${quantidade} e restam ${disponivel}.`);
        }
    });
    return problemas;
}

/* O que impede a venda de ser enviada. Cada mensagem diz o que fazer, porque
   um "dados inválidos" no balcao trava o atendimento sem dizer o motivo. */
function validarVenda(calculo, rascunho) {
    const erros = [];
    const credito = (rascunho && rascunho.crediario) || {};
    const aPrazo = calculo.aPrazoCentavos > 0;

    if (!calculo.itens.length) {
        erros.push('Adicione ao menos um serviço ou produto.');
    }
    if (calculo.itens.some(item => !item.nome)) {
        erros.push('Há um item sem descrição na lista.');
    }
    if (calculo.totalCentavos < 0) {
        erros.push('O total da venda não pode ficar negativo.');
    }

    if (aPrazo) {
        // Dívida sem cliente não tem de quem cobrar. O banco recusa também
        // (docs/sql/23), mas descobrir isso só depois de montar a venda inteira
        // faria o balcão refazer tudo.
        if (!(rascunho && rascunho.clientId)) {
            erros.push('Venda a prazo precisa de cliente identificado: escolha ou cadastre o cliente.');
        }

        const plano = planoDeCrediario(rascunho, calculo);
        const soma = (plano ? plano.installments : [])
            .reduce((s, p) => s + centavosDaVenda(p.amount), 0);

        if (soma !== calculo.aPrazoCentavos) {
            const diferenca = Math.abs(soma - calculo.aPrazoCentavos);
            erros.push(
                `As parcelas somam ${formatCurrency(reaisDaVenda(soma))} e o saldo a prazo é ` +
                `${formatCurrency(reaisDaVenda(calculo.aPrazoCentavos))} — ` +
                `diferença de ${formatCurrency(reaisDaVenda(diferenca))}.`
            );
        }
        if ((plano ? plano.installments : []).some(p => !p.dueDate)) {
            erros.push('Toda parcela precisa de uma data de vencimento.');
        }
    } else if (calculo.restanteCentavos > 0) {
        erros.push(
            `Faltam ${formatCurrency(reaisDaVenda(calculo.restanteCentavos))} para fechar o total. ` +
            'Some outro pagamento ou deixe o saldo a prazo no crediário.'
        );
    }
    if (calculo.restanteCentavos < 0) {
        erros.push(
            `Os pagamentos passam ${formatCurrency(reaisDaVenda(-calculo.restanteCentavos))} do total. ` +
            'Em dinheiro, informe o valor entregue para gerar troco.'
        );
    }
    if (calculo.pagamentos.some(p => p.valorCentavos <= 0)) {
        erros.push('Todo pagamento precisa de um valor maior que zero.');
    }

    return erros.concat(conferirEstoqueDaVenda(calculo));
}

/* --- Quem responde pela venda ---------------------------------------------
   `sales.professional_id` e o dono do CABECALHO: e ele que a lista de Vendas
   mostra na coluna Profissional, e e dele que finalizar_venda copia o
   `transactions."profId"` de cada pagamento (script 15) — o campo pelo qual o
   Financeiro separa o faturamento por pessoa.

   Ele so chegava preenchido na venda vinda do agendamento. No balcao o
   profissional e escolhido POR ITEM: a comissao sempre nasceu certa, porque o
   gatilho da Fase D le `sale_items.professional_id`, mas o cabecalho ficava
   nulo — e a venda fechada no nome de alguem aparecia como "Nao informado" no
   segundo seguinte, e caia em "Barbearia (Geral)" no Financeiro.

   Com todos os servicos no mesmo nome, ele e o responsavel. Com dois barbeiros
   na mesma conta nao existe um dono unico, e o campo continua nulo de
   proposito: eleger um deles jogaria o faturamento inteiro da venda para o
   lado dele. Esse caso quem resolve e a tela, listando os nomes dos itens. */
function profissionalResponsavelDaVenda(rascunho, calculo) {
    if (rascunho && rascunho.professionalId) return rascunho.professionalId;

    const donos = [...new Set((calculo.itens || [])
        .filter(item => item.tipo === 'service' && item.profissionalId)
        .map(item => item.profissionalId))];

    return donos.length === 1 ? donos[0] : null;
}

/* --- O que vai para o banco -----------------------------------------------
   Mesmo formato aceito por finalizar_venda(). Os nomes dos itens vao junto
   como plano B: se o cadastro sumiu, o historico ainda sabe o que foi vendido. */
function montarPayloadDaVenda(rascunho, calculo) {
    return {
        idempotencyKey: rascunho.idempotencyKey,
        appointmentId: rascunho.appointmentId || null,
        clientId: rascunho.clientId || null,
        professionalId: profissionalResponsavelDaVenda(rascunho, calculo),
        competenceDate: rascunho.competenceDate || getLocalDateString(new Date()),
        notes: rascunho.notas || null,
        discountType: calculo.descontoCentavos > 0 ? (rascunho.desconto?.tipo || 'amount') : null,
        discountValue: calculo.descontoCentavos > 0 ? (Number(rascunho.desconto?.valor) || 0) : 0,
        surchargeType: calculo.acrescimoCentavos > 0 ? (rascunho.acrescimo?.tipo || 'amount') : null,
        surchargeValue: calculo.acrescimoCentavos > 0 ? (Number(rascunho.acrescimo?.valor) || 0) : 0,
        subtotalServices: reaisDaVenda(calculo.subtotalServicosCentavos),
        subtotalProducts: reaisDaVenda(calculo.subtotalProdutosCentavos),
        subtotal: reaisDaVenda(calculo.subtotalCentavos),
        discountAmount: reaisDaVenda(calculo.descontoCentavos),
        surchargeAmount: reaisDaVenda(calculo.acrescimoCentavos),
        total: reaisDaVenda(calculo.totalCentavos),
        amountReceived: reaisDaVenda(calculo.recebidoCentavos),
        changeAmount: reaisDaVenda(calculo.trocoCentavos),
        // Só vai quando há saldo a prazo. `finalizar_venda` lê este campo e
        // repassa para gerar_crediario(); sem ele, uma venda com saldo viraria
        // parcela única em 30 dias, que é o padrão do balcão.
        creditPlan: planoDeCrediario(rascunho, calculo),
        items: calculo.itens.map(item => ({
            itemType: item.tipo,
            serviceId: item.tipo === 'service' ? (item.refId || null) : null,
            productId: item.tipo === 'product' ? (item.refId || null) : null,
            itemName: item.nome,
            professionalId: item.profissionalId || null,
            quantity: item.quantidade,
            unitPrice: reaisDaVenda(item.unitarioCentavos),
            grossAmount: reaisDaVenda(item.brutoCentavos),
            discountAmount: reaisDaVenda(item.descontoCentavos),
            surchargeAmount: reaisDaVenda(item.acrescimoCentavos),
            netAmount: reaisDaVenda(item.liquidoCentavos)
        })),
        payments: calculo.pagamentos.map(pagamento => ({
            paymentMethod: pagamento.metodo,
            amount: reaisDaVenda(pagamento.valorCentavos),
            cashReceived: pagamento.entregueCentavos === null
                ? null
                : reaisDaVenda(pagamento.entregueCentavos)
        }))
    };
}

/* --- Modo local: simulacao, nunca producao --------------------------------

   Sem Supabase configurado o app inteiro funciona no localStorage, e o
   checkout precisa funcionar junto — e assim que a demonstracao e os testes
   rodam. O que NAO pode acontecer e o contrario: com Supabase configurado, uma
   RPC que falhou nunca vira sucesso local. Venda fantasma no navegador de quem
   vendeu e pior do que venda nao registrada, porque ninguem vai procurar.

   A ordem de conferencia e a mesma da RPC, inclusive a recusa por estoque, para
   o teste local dizer a mesma coisa que a producao diria. */
function finalizarVendaLocalmente(payload) {
    const agora = new Date();
    const carimbo = agora.toISOString();
    const sufixo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const saleId = 'sale-local-' + sufixo;

    const jaExiste = (data.sales || []).find(venda =>
        (venda.idempotency_key || venda.idempotencyKey) === payload.idempotencyKey);
    if (jaExiste) {
        return { ok: true, repetida: true, venda: jaExiste, itens: [], pagamentos: [] };
    }

    if (payload.appointmentId) {
        const duplicada = (data.sales || []).find(venda =>
            (venda.appointment_id || venda.appointmentId) === payload.appointmentId &&
            !['cancelled', 'refunded'].includes(venda.status));
        if (duplicada) throw new Error('Este atendimento já possui uma venda concluída.');
    }

    const pedidos = new Map();
    payload.items.filter(item => item.itemType === 'product' && item.productId)
        .forEach(item => pedidos.set(item.productId, (pedidos.get(item.productId) || 0) + item.quantity));
    pedidos.forEach((quantidade, produtoId) => {
        const produto = (data.products || []).find(p => p.id === produtoId);
        if (!produto) throw new Error('Produto não encontrado neste salão.');
        const disponivel = Math.max(0, Number(produto.stock) || 0);
        if (disponivel < quantidade) {
            throw new Error(`Estoque insuficiente de ${produto.name}: restam ${disponivel} e a venda pede ${quantidade}.`);
        }
    });

    const cliente = (data.clients || []).find(c => c.id === payload.clientId);
    const profissional = (data.professionals || []).find(p => p.id === payload.professionalId);
    const numero = (data.sales || []).reduce((maior, venda) =>
        Math.max(maior, Number(venda.sale_number || venda.saleNumber) || 0), 0) + 1;

    const venda = {
        id: saleId,
        sale_number: numero,
        appointment_id: payload.appointmentId || null,
        client_id: payload.clientId || null,
        client_name: cliente ? cliente.name : null,
        professional_id: payload.professionalId || null,
        professional_name: profissional ? profissional.name : null,
        origin: payload.appointmentId ? 'appointment' : 'counter',
        status: 'paid',
        subtotal_services: payload.subtotalServices,
        subtotal_products: payload.subtotalProducts,
        subtotal: payload.subtotal,
        discount_type: payload.discountType,
        discount_value: payload.discountValue,
        discount_amount: payload.discountAmount,
        surcharge_type: payload.surchargeType,
        surcharge_value: payload.surchargeValue,
        surcharge_amount: payload.surchargeAmount,
        total: payload.total,
        amount_received: payload.amountReceived,
        amount_receivable: 0,
        change_amount: payload.changeAmount,
        notes: payload.notes || null,
        idempotency_key: payload.idempotencyKey,
        sold_at: carimbo,
        created_at: carimbo
    };

    const itens = payload.items.map((item, indice) => {
        const dono = (data.professionals || []).find(p => p.id === item.professionalId);
        const ehServico = item.itemType === 'service';
        return {
            id: 'si-' + sufixo + '-' + (indice + 1),
            sale_id: saleId,
            item_type: item.itemType,
            service_id: item.serviceId,
            product_id: item.productId,
            item_name: item.itemName,
            professional_id: item.professionalId,
            professional_name: dono ? dono.name : null,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            gross_amount: item.grossAmount,
            discount_amount: item.discountAmount,
            surcharge_amount: item.surchargeAmount,
            net_amount: item.netAmount,
            commission_rate: ehServico && dono ? (Number(dono.commission) || 0) : 0,
            commission_base: ehServico && dono
                ? Math.round((item.grossAmount - item.discountAmount) * 100) / 100
                : 0,
            created_at: carimbo
        };
    });

    const caixaAberto = window.getCurrentCashRegister ? window.getCurrentCashRegister() : null;
    const resumo = 'Venda #' + String(numero).padStart(6, '0') + (cliente ? ' - ' + cliente.name : '');
    const temProduto = payload.items.some(i => i.itemType === 'product');
    const temServico = payload.items.some(i => i.itemType === 'service');
    const categoria = !temProduto ? 'Serviço' : (!temServico ? 'Produto' : 'Venda');

    const pagamentos = [];
    const transacoes = [];
    payload.payments.forEach((pagamento, indice) => {
        const pagamentoId = 'sp-' + sufixo + '-' + (indice + 1);
        const ehDinheiro = pagamento.paymentMethod === 'cash';
        pagamentos.push({
            id: pagamentoId,
            sale_id: saleId,
            payment_method: pagamento.paymentMethod,
            amount: pagamento.amount,
            cash_received: ehDinheiro ? pagamento.cashReceived : null,
            change_amount: ehDinheiro
                ? Math.round(((pagamento.cashReceived || pagamento.amount) - pagamento.amount) * 100) / 100
                : 0,
            status: 'completed',
            cash_register_id: ehDinheiro && caixaAberto ? caixaAberto.id : null,
            paid_at: carimbo,
            created_at: carimbo
        });
        transacoes.push({
            id: 'tr-' + sufixo + '-' + (indice + 1),
            type: 'income',
            amount: pagamento.amount,
            date: payload.competenceDate,
            registradoEm: carimbo,
            description: resumo,
            category: categoria,
            paymentMethod: pagamento.paymentMethod,
            profId: payload.professionalId || '',
            status: ehDinheiro && !caixaAberto ? 'pending' : 'completed',
            clientId: payload.clientId || '',
            appointmentId: payload.appointmentId || '',
            sale_id: saleId,
            sale_payment_id: pagamentoId,
            cash_register_id: ehDinheiro && caixaAberto ? caixaAberto.id : null,
            source: 'sale'
        });
    });

    const movimentos = [];
    itens.filter(item => item.item_type === 'product' && item.product_id).forEach((item, indice) => {
        const produto = (data.products || []).find(p => p.id === item.product_id);
        produto.stock = Math.max(0, (Number(produto.stock) || 0) - item.quantity);
        movimentos.push({
            id: 'mov-' + sufixo + '-' + (indice + 1),
            productId: item.product_id,
            productName: item.item_name,
            type: 'out',
            qty: item.quantity,
            reason: 'venda',
            unitPrice: item.unit_price,
            total: item.net_amount,
            clientId: payload.clientId || null,
            appointmentId: payload.appointmentId || null,
            profId: item.professional_id || null,
            transactionId: null,
            sale_id: saleId,
            sale_item_id: item.id,
            note: 'Venda #' + String(numero).padStart(6, '0'),
            date: payload.competenceDate,
            created_at: carimbo
        });
    });

    let atendimento = null;
    if (payload.appointmentId) {
        atendimento = (data.appointments || []).find(a => a.id === payload.appointmentId) || null;
        if (atendimento) {
            atendimento.status = 'done';
            atendimento.paymentStatus = 'paid';
            atendimento.paymentMethod = (payload.payments[0] || {}).paymentMethod || atendimento.paymentMethod;
        }
    }

    // Ultimo corte atualiza em QUALQUER venda com cliente identificado, nao so
    // quando ela nasce de um agendamento: a venda de balcao (cliente escolhido
    // direto no checkout) tambem conta como visita.
    if (payload.clientId) {
        const clienteDaVenda = (data.clients || []).find(c => c.id === payload.clientId);
        if (clienteDaVenda && (clienteDaVenda.lastVisit || '') < payload.competenceDate) {
            clienteDaVenda.lastVisit = payload.competenceDate;
        }
    }

    return {
        ok: true,
        repetida: false,
        venda: venda,
        itens: itens,
        pagamentos: pagamentos,
        transacoes: transacoes,
        movimentos: movimentos,
        atendimento: atendimento,
        local: true
    };
}
