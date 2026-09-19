/**
 * ==========================================================================
 * VENDAS — HISTORICO E COMPATIBILIDADE
 *
 * Leitura do nucleo de vendas e adaptador dos registros anteriores. Este
 * arquivo NAO grava nada: quem conclui venda e a RPC finalizar_venda, chamada
 * pelo checkout (24-checkout.js).
 * ==========================================================================
 */

// Numero visivel da venda: sequencial por salao, com zeros a esquerda. O id
// tecnico continua sendo texto e nao aparece para o balcao.
function formatSaleNumber(numero) {
    const valor = Number(numero);
    return Number.isFinite(valor) && valor > 0
        ? String(Math.trunc(valor)).padStart(6, '0')
        : String(numero || '');
}

const salesFilters = {
    // Abre no dia: quem chega a esta tela no balcão quer conferir o movimento
    // de hoje. O mês inteiro continua a um clique no filtro de período.
    period: 'today',
    client: 'all',
    professional: 'all',
    status: 'all',
    method: 'all'
};

let salesHistoryCache = [];

function saleValue(record, snakeName, camelName) {
    if (!record) return undefined;
    if (record[snakeName] !== undefined && record[snakeName] !== null) return record[snakeName];
    return record[camelName || snakeName];
}

function normalizeSaleText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function canonicalSalePaymentMethod(value) {
    const method = normalizeSaleText(value).replace(/[\s-]+/g, '_');
    if (['cash', 'dinheiro'].includes(method)) return 'cash';
    if (['pix'].includes(method)) return 'pix';
    if (['debit', 'debito', 'debit_card', 'cartao_de_debito'].includes(method)) return 'debit_card';
    if (['credit', 'credito', 'credit_card', 'cartao_de_credito'].includes(method)) return 'credit_card';
    if (['crediario', 'credit_account', 'store_credit'].includes(method)) return 'credit_account';
    return 'other';
}

function salePaymentMethodLabel(method) {
    return {
        pix: 'Pix',
        cash: 'Dinheiro',
        debit_card: 'Débito',
        credit_card: 'Crédito',
        credit_account: 'Crediário',
        other: 'Outro'
    }[canonicalSalePaymentMethod(method)] || 'Outro';
}

function saleStatusLabel(status) {
    return {
        paid: 'Recebida',
        pending: 'Pendente',
        partial: 'Parcial',
        on_credit: 'A prazo',
        cancelled: 'Cancelada',
        refunded: 'Estornada'
    }[status] || 'Pendente';
}

function saleOriginLabel(origin) {
    return {
        appointment: 'Atendimento',
        counter: 'Balcão',
        credit: 'Crediário',
        legacy: 'Registro anterior'
    }[origin] || 'Balcão';
}

function saleLocalDay(value) {
    if (!value) return '';
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw.substring(0, 10) : getLocalDateString(parsed);
}

/* As vendas de UM cliente, prontas para quem mede o cliente — gasto, visitas,
   frequência e histórico (calculateClientStats, em app.js).

   Existe porque a ficha e a lista de Clientes nasceram antes do módulo de
   Vendas e só enxergavam AGENDAMENTOS. A venda de balcão — o cliente entra,
   corta e paga sem ter marcado hora — não existia para elas: ele gastava
   R$ 160 e a tela dizia R$ 0,00.

   Devolve TODAS as vendas dele, inclusive canceladas e estornadas, com `valida`
   dizendo quais contam. Quem mede precisa das canceladas também: é por elas
   que sabe que aquele atendimento já teve venda, e não o soma de novo pelo
   caminho antigo. */
function vendasDoCliente(clientId) {
    if (!clientId) return [];
    const itens = data.saleItems || [];
    return (data.sales || [])
        .filter(venda => String(saleValue(venda, 'client_id', 'clientId') || '') === String(clientId))
        .map(venda => {
            const id = String(venda.id || '');
            const vendidaEm = saleValue(venda, 'sold_at', 'soldAt') || venda.created_at;
            return {
                id: id,
                numero: formatSaleNumber(saleValue(venda, 'sale_number', 'saleNumber')) || id,
                appointmentId: String(saleValue(venda, 'appointment_id', 'appointmentId') || ''),
                dia: saleLocalDay(vendidaEm),
                vendidaEm: vendidaEm,
                total: Number(venda.total) || 0,
                status: venda.status || 'paid',
                valida: !['cancelled', 'refunded'].includes(venda.status),
                // Venda só de produto (a pomada comprada de passagem) é dinheiro,
                // mas não é atendimento: não conta como visita.
                temServico: itens.some(item =>
                    String(saleValue(item, 'sale_id', 'saleId')) === id &&
                    saleValue(item, 'item_type', 'itemType') === 'service')
            };
        });
}

function saleTimestamp(value, fallbackDay) {
    const parsed = value ? new Date(value) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed.getTime();
    const fallback = Date.parse((fallbackDay || '1970-01-01') + 'T12:00:00');
    return Number.isNaN(fallback) ? 0 : fallback;
}

function saleDateTimeLabel(row) {
    const parts = String(row.date || '').split('-');
    const dayLabel = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : (row.date || '—');
    if (!row.dateTime || /^\d{4}-\d{2}-\d{2}$/.test(String(row.dateTime))) return dayLabel;
    const parsed = new Date(row.dateTime);
    if (Number.isNaN(parsed.getTime())) return dayLabel;
    return `${dayLabel} · ${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

function resolveSaleClient(clientId, snapshot) {
    if (snapshot) return snapshot;
    const client = (data.clients || []).find(c => c.id === clientId);
    return client ? client.name : 'Não identificado';
}

function resolveSaleProfessional(professionalId, snapshot) {
    if (snapshot) return snapshot;
    const professional = (data.professionals || []).find(p => p.id === professionalId);
    return professional ? professional.name : 'Não informado';
}

/* Quem atendeu na venda — o cabeçalho E os itens, nessa ordem.

   `sales.professional_id` guarda UM responsável e fica vazio em duas situações
   legítimas: venda de balcão fechada antes desta correção (o profissional só
   era escolhido por item, e o cabeçalho nunca recebia ninguém) e venda com
   mais de um profissional na mesma conta, em que não existe um dono só.

   Nos dois casos o nome nunca se perdeu: ele está em cada
   `sale_items.professional_id`, que é de onde a comissão sempre saiu. Ler dali
   é o que faz a coluna Profissional parar de dizer "Não informado" sobre uma
   venda que tem dono — inclusive nas vendas antigas, sem migration nenhuma.

   O snapshot do item vem na frente do cadastro atual, pela mesma razão de
   `resolveSaleProfessional`: o profissional pode ter saído do salão depois. */
function saleProfessionalsFrom(sale, items) {
    const encontrados = new Map();

    const registrar = (id, snapshot) => {
        if (!id || encontrados.has(id)) return;
        const professional = (data.professionals || []).find(p => p.id === id);
        encontrados.set(id, snapshot || (professional ? professional.name : 'Não informado'));
    };

    registrar(
        saleValue(sale, 'professional_id', 'professionalId') || '',
        saleValue(sale, 'professional_name', 'professionalName')
    );
    (items || []).forEach(item => registrar(
        saleValue(item, 'professional_id', 'professionalId') || '',
        saleValue(item, 'professional_name', 'professionalName')
    ));

    return [...encontrados].map(([id, name]) => ({ id: id, name: name }));
}

/* Quem OPEROU o sistema na venda (`sales.sold_by`, script 27).

   O banco guarda o id do login, não um nome — e não poderia ser diferente: um
   nome copiado ali envelheceria no dia em que a pessoa se casasse. A tradução
   passa pelo quadro do salão (`salon_members`, liberado no script 28), que diz
   a qual profissional cada login pertence.

   Três respostas possíveis, e as três dizem algo:
   - o nome do profissional, quando o login é de alguém da equipe;
   - "Administrador", quando o login é do proprietário / administrador;
   - vazio, para venda antiga (anterior ao script 27) ou registro legado — a
     coluna fica com o traço, em vez de mentir um nome. */
function resolveSaleOperator(soldById) {
    if (!soldById) return '';
    const membro = (data.salonMembers || []).find(m => String(m.user_id || m.userId) === String(soldById));
    if (membro) {
        const profId = membro.professional_id || membro.professionalId;
        if (!profId || membro.role === 'owner') return 'Administrador';
        const prof = (data.professionals || []).find(p => p.id === profId);
        return prof ? prof.name : 'Administrador';
    }
    if (typeof DataService !== 'undefined' && DataService.getTenantId && String(DataService.getTenantId()) === String(soldById)) {
        return 'Administrador';
    }
    return '';
}

function resolveLegacyClient(transaction) {
    const explicitId = transaction.clientId || transaction.client_id || '';
    const explicit = (data.clients || []).find(c => c.id === explicitId);
    if (explicit) return { id: explicit.id, name: explicit.name };

    const description = normalizeSaleText(transaction.description);
    const candidates = (data.clients || [])
        .filter(c => description.includes(normalizeSaleText(c.name)))
        .sort((a, b) => b.name.length - a.name.length);
    return candidates.length
        ? { id: candidates[0].id, name: candidates[0].name }
        : { id: '', name: 'Não identificado' };
}

function buildOfficialSaleRows() {
    const allItems = data.saleItems || [];
    const allPayments = data.salePayments || [];

    return (data.sales || []).map(sale => {
        const id = String(sale.id || '');
        const items = allItems.filter(item => String(saleValue(item, 'sale_id', 'saleId')) === id);
        const payments = allPayments.filter(payment =>
            String(saleValue(payment, 'sale_id', 'saleId')) === id &&
            !['cancelled', 'refunded'].includes(payment.status)
        );
        const clientId = saleValue(sale, 'client_id', 'clientId') || '';
        const profissionais = saleProfessionalsFrom(sale, items);
        // O id único só existe quando a venda inteira é de uma pessoa: é ele
        // que o filtro por profissional e o recibo usam. Com dois barbeiros na
        // conta, os dois entram em `professionalIds` e o filtro acha a venda
        // por qualquer um deles.
        const professionalId = profissionais.length === 1
            ? profissionais[0].id
            : (saleValue(sale, 'professional_id', 'professionalId') || '');
        const soldAt = saleValue(sale, 'sold_at', 'soldAt') || sale.created_at;
        const receivable = Number(saleValue(sale, 'amount_receivable', 'amountReceivable')) || 0;
        const methods = [...new Set(payments.map(payment =>
            canonicalSalePaymentMethod(saleValue(payment, 'payment_method', 'paymentMethod'))
        ))];
        if (receivable > 0) methods.push('credit_account');

        return {
            key: `sale:${id}`,
            id: id,
            number: formatSaleNumber(saleValue(sale, 'sale_number', 'saleNumber')) || id,
            legacy: false,
            date: saleLocalDay(soldAt),
            dateTime: soldAt,
            timestamp: saleTimestamp(soldAt, saleLocalDay(soldAt)),
            clientId: clientId,
            clientName: resolveSaleClient(clientId, saleValue(sale, 'client_name', 'clientName')),
            professionalId: professionalId,
            professionalIds: profissionais.map(p => p.id),
            professionalName: profissionais.length
                ? profissionais.map(p => p.name).join(', ')
                : 'Não informado',
            operatorName: resolveSaleOperator(saleValue(sale, 'sold_by', 'soldBy')),
            total: Number(sale.total) || 0,
            status: sale.status || 'pending',
            methods: [...new Set(methods)],
            origin: sale.origin || 'counter',
            serviceQty: items.filter(item => saleValue(item, 'item_type', 'itemType') === 'service')
                .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
            productQty: items.filter(item => saleValue(item, 'item_type', 'itemType') === 'product')
                .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
            raw: sale,
            items: items,
            payments: payments
        };
    });
}

function buildLegacyTransactionRows() {
    return (data.transactions || [])
        .filter(transaction =>
            transaction.type === 'income' &&
            !saleValue(transaction, 'sale_id', 'saleId')
        )
        .map(transaction => {
            const category = normalizeSaleText(transaction.category);
            const client = resolveLegacyClient(transaction);
            const professionalId = transaction.profId || transaction.professional_id || '';
            const appointmentId = transaction.appointmentId || transaction.appointment_id || '';
            const dateTime = transaction.registradoEm || transaction.created_at || transaction.date;
            return {
                key: `legacy-transaction:${transaction.id}`,
                id: String(transaction.id || ''),
                number: String(transaction.id || '').replace(/^tr-/, '') || 'anterior',
                legacy: true,
                legacyType: 'transaction',
                date: transaction.date || saleLocalDay(dateTime),
                dateTime: dateTime,
                timestamp: saleTimestamp(dateTime, transaction.date),
                clientId: client.id,
                clientName: client.name,
                professionalId: professionalId,
                professionalName: resolveSaleProfessional(professionalId),
                total: Number(transaction.amount) || 0,
                status: transaction.status === 'pending' ? 'pending' : 'paid',
                methods: [canonicalSalePaymentMethod(transaction.paymentMethod || transaction.payment_method)],
                origin: appointmentId || category === 'servico' ? 'appointment' : 'counter',
                serviceQty: category === 'servico' ? 1 : 0,
                productQty: category === 'produto' ? (Number(transaction.productQty || transaction.product_qty) || 1) : 0,
                raw: transaction,
                items: [],
                payments: []
            };
        });
}

function buildOrphanLegacyStockRows(transactionIds) {
    const groups = new Map();

    (data.stockMovements || []).forEach(movement => {
        if (movement.type !== 'out' || normalizeSaleText(movement.reason) !== 'venda') return;
        // Saida nascida de uma venda oficial ja aparece pelo cabecalho dela.
        // Sem esta linha, a mesma venda entraria duas vezes no historico: uma
        // como venda e outra como "registro anterior".
        if (saleValue(movement, 'sale_id', 'saleId')) return;
        const transactionId = movement.transactionId || movement.transaction_id || '';
        if (transactionId && transactionIds.has(String(transactionId))) return;

        const groupKey = transactionId ? `transaction:${transactionId}` : `movement:${movement.id}`;
        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                key: `legacy-stock:${groupKey}`,
                id: String(transactionId || movement.id || ''),
                number: String(transactionId || movement.id || '').replace(/^(tr|mov)-/, '') || 'anterior',
                legacy: true,
                legacyType: 'stock',
                date: movement.date || saleLocalDay(movement.created_at),
                dateTime: movement.created_at || movement.date,
                timestamp: saleTimestamp(movement.created_at, movement.date),
                clientId: movement.clientId || movement.client_id || '',
                clientName: resolveSaleClient(movement.clientId || movement.client_id || ''),
                professionalId: movement.profId || movement.prof_id || '',
                professionalName: resolveSaleProfessional(movement.profId || movement.prof_id || ''),
                total: 0,
                status: 'pending',
                methods: [],
                origin: movement.appointmentId || movement.appointment_id ? 'appointment' : 'counter',
                serviceQty: 0,
                productQty: 0,
                raw: movement,
                items: [],
                payments: []
            });
        }

        const row = groups.get(groupKey);
        const quantity = Number(movement.qty) || 0;
        const total = Number(movement.total) || (Number(movement.unitPrice || movement.unit_price) || 0) * quantity;
        row.total += total;
        row.productQty += quantity;
        row.items.push(movement);
    });

    return [...groups.values()];
}

function buildSalesHistory() {
    const transactionIds = new Set((data.transactions || []).map(t => String(t.id || '')));
    return [
        ...buildOfficialSaleRows(),
        ...buildLegacyTransactionRows(),
        ...buildOrphanLegacyStockRows(transactionIds)
    ].sort((a, b) => b.timestamp - a.timestamp);
}

function salePeriodStart(period) {
    if (period === 'all') return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (period !== 'today') today.setDate(today.getDate() - (Number(period) - 1));
    return getLocalDateString(today);
}

function filteredSalesHistory(rows) {
    const start = salePeriodStart(salesFilters.period);
    return rows.filter(row => {
        if (start && row.date < start) return false;
        if (salesFilters.client !== 'all' && row.clientId !== salesFilters.client) return false;
        // Venda de dois barbeiros aparece no filtro dos DOIS: `professionalIds`
        // tem todos os donos dos itens, e o registro anterior (sem itens
        // estruturados) continua respondendo pelo seu único id.
        if (salesFilters.professional !== 'all') {
            const donos = row.professionalIds
                || (row.professionalId ? [row.professionalId] : []);
            if (!donos.includes(salesFilters.professional)) return false;
        }
        if (salesFilters.status !== 'all' && row.status !== salesFilters.status) return false;
        if (salesFilters.method !== 'all' && !row.methods.includes(salesFilters.method)) return false;
        return true;
    });
}

function updateSalesSelect(id, placeholder, options, selected) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = `<option value="all">${escapeHTML(placeholder)}</option>` + options.map(option =>
        `<option value="${escapeHTML(option.id)}">${escapeHTML(option.name)}</option>`
    ).join('');
    select.value = options.some(option => option.id === selected) ? selected : 'all';
}

function renderSalesFilters() {
    const clients = [...(data.clients || [])]
        .filter(client => client && client.id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
    const professionals = [...(data.professionals || [])]
        .filter(professional => professional && professional.id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));

    updateSalesSelect('sales-filter-client', 'Todos os clientes', clients, salesFilters.client);
    updateSalesSelect('sales-filter-professional', 'Todos os profissionais', professionals, salesFilters.professional);
}

function renderSalesMetrics(rows) {
    const today = getLocalDateString(new Date());
    const validToday = rows.filter(row =>
        row.date === today && !['cancelled', 'refunded'].includes(row.status)
    );
    const pending = rows.filter(row => ['pending', 'partial', 'on_credit'].includes(row.status));

    document.getElementById('sales-today-count').innerText = validToday.length;
    document.getElementById('sales-today-total').innerText = formatCurrency(
        validToday.reduce((sum, row) => sum + row.total, 0)
    );
    document.getElementById('sales-today-services').innerText = validToday.reduce((sum, row) => sum + row.serviceQty, 0);
    document.getElementById('sales-today-products').innerText = validToday.reduce((sum, row) => sum + row.productQty, 0);
    document.getElementById('sales-pending-count').innerText = pending.length;
}

function saleMethodsHTML(methods) {
    if (!methods.length) return '<span class="sales-payment-chip">Não informado</span>';
    return methods.map(method =>
        `<span class="sales-payment-chip">${escapeHTML(salePaymentMethodLabel(method))}</span>`
    ).join('');
}

function renderSalesTable(rows) {
    const tbody = document.getElementById('sales-history-body');
    if (!tbody) return;

    document.getElementById('sales-result-count').innerText =
        `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;

    if (!rows.length) {
        tbody.innerHTML = `
            <tr><td colspan="10" class="sales-empty-cell">
                <i class="fa-solid fa-receipt"></i>
                Nenhuma venda encontrada para os filtros selecionados.
            </td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(row => `
        <tr>
            <td data-label="Venda">
                <div class="sales-id-cell">
                    <strong>#${escapeHTML(String(row.number))}</strong>
                    ${row.legacy ? '<span class="sales-legacy-label">Registro anterior</span>' : ''}
                </div>
            </td>
            <td data-label="Data e hora">${escapeHTML(saleDateTimeLabel(row))}</td>
            <td data-label="Cliente">${escapeHTML(row.clientName)}</td>
            <td data-label="Profissional">${escapeHTML(row.professionalName)}</td>
            <td data-label="Vendido por">${escapeHTML(row.operatorName || '—')}</td>
            <td data-label="Origem">${escapeHTML(saleOriginLabel(row.origin))}</td>
            <td data-label="Situação">
                <span class="sales-status sales-status-${escapeHTML(row.status)}">${escapeHTML(saleStatusLabel(row.status))}</span>
            </td>
            <td data-label="Pagamento"><div class="sales-payment-list">${saleMethodsHTML(row.methods)}</div></td>
            <td data-label="Total" style="text-align:right;"><strong>${formatCurrency(row.total)}</strong></td>
            <td data-label="Detalhes" style="text-align:right;">
                <button type="button" class="btn-card-action sales-detail-button"
                        data-sale-key="${escapeHTML(row.key)}" title="Visualizar detalhes">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        </tr>`).join('');

    tbody.onclick = event => {
        const button = event.target.closest('.sales-detail-button');
        if (button) openSaleDetails(button.dataset.saleKey);
    };
}

function saleDetailItemsHTML(row) {
    if (!row.items.length) return '';

    if (row.legacy && row.legacyType === 'stock') {
        return `
            <div class="sale-detail-section">
                <h5>Produtos registrados no estoque</h5>
                <div class="table-container">
                    <table class="data-table small-text">
                        <thead><tr><th>Produto</th><th>Qtd.</th><th style="text-align:right;">Total</th></tr></thead>
                        <tbody>${row.items.map(item => `
                            <tr>
                                <td data-label="Produto">${escapeHTML(item.productName || item.product_name || 'Produto')}</td>
                                <td data-label="Qtd.">${Number(item.qty) || 0}</td>
                                <td data-label="Total" style="text-align:right;">${formatCurrency(Number(item.total) || 0)}</td>
                            </tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>`;
    }

    return `
        <div class="sale-detail-section">
            <h5>Itens</h5>
            <div class="table-container">
                <table class="data-table small-text">
                    <thead><tr><th>Tipo</th><th>Item</th><th>Qtd.</th><th style="text-align:right;">Líquido</th></tr></thead>
                    <tbody>${row.items.map(item => `
                        <tr>
                            <td data-label="Tipo">${saleValue(item, 'item_type', 'itemType') === 'service' ? 'Serviço' : 'Produto'}</td>
                            <td data-label="Item">${escapeHTML(saleValue(item, 'item_name', 'itemName') || 'Item')}</td>
                            <td data-label="Qtd.">${Number(item.quantity) || 0}</td>
                            <td data-label="Líquido" style="text-align:right;">${formatCurrency(Number(saleValue(item, 'net_amount', 'netAmount')) || 0)}</td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
}

function saleDetailPaymentsHTML(row) {
    if (!row.payments.length) return '';
    return `
        <div class="sale-detail-section">
            <h5>Pagamentos</h5>
            <div class="table-container">
                <table class="data-table small-text">
                    <thead><tr><th>Forma</th><th>Data</th><th style="text-align:right;">Valor</th></tr></thead>
                    <tbody>${row.payments.map(payment => `
                        <tr>
                            <td data-label="Forma">${escapeHTML(salePaymentMethodLabel(saleValue(payment, 'payment_method', 'paymentMethod')))}</td>
                            <td data-label="Data">${escapeHTML(saleLocalDay(saleValue(payment, 'paid_at', 'paidAt')) || '—')}</td>
                            <td data-label="Valor" style="text-align:right;">${formatCurrency(Number(payment.amount) || 0)}</td>
                        </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
}

window.openSaleDetails = function (key) {
    const row = salesHistoryCache.find(item => item.key === key);
    const content = document.getElementById('sale-detail-content');
    if (!row || !content) return;

    const legacyDescription = row.legacy && row.raw && row.raw.description
        ? `<p><strong>Descrição original:</strong> ${escapeHTML(row.raw.description)}</p>`
        : '';

    content.innerHTML = `
        ${row.legacy ? `
            <div class="sale-detail-note">
                Este é um registro anterior à nova arquitetura. Ele é exibido sem conversão ou alteração do dado original.
                ${legacyDescription}
            </div>` : ''}
        <div class="sale-detail-summary">
            <div class="sale-detail-card"><span>Venda</span><strong>#${escapeHTML(String(row.number))}</strong></div>
            <div class="sale-detail-card"><span>Data</span><strong>${escapeHTML(saleDateTimeLabel(row))}</strong></div>
            <div class="sale-detail-card"><span>Total</span><strong>${formatCurrency(row.total)}</strong></div>
            <div class="sale-detail-card"><span>Cliente</span><strong>${escapeHTML(row.clientName)}</strong></div>
            <div class="sale-detail-card"><span>Profissional</span><strong>${escapeHTML(row.professionalName)}</strong></div>
            <div class="sale-detail-card"><span>Vendido por</span><strong>${escapeHTML(row.operatorName || '—')}</strong></div>
            <div class="sale-detail-card"><span>Situação</span><strong>${escapeHTML(saleStatusLabel(row.status))}</strong></div>
        </div>
        ${saleDetailItemsHTML(row)}
        ${saleDetailPaymentsHTML(row)}`;

    // Recibo só existe para venda oficial: registro anterior não tem itens
    // nem pagamentos estruturados (ver saleDetailItemsHTML/saleDetailPaymentsHTML
    // acima), então não há como reconstruir um documento fiel.
    const btnVer = document.getElementById('btn-sale-receipt-view');
    if (btnVer) {
        btnVer.style.display = row.legacy ? 'none' : '';
        btnVer.onclick = () => gerarReciboVenda(row.key);
    }
    const btnZap = document.getElementById('btn-sale-receipt-whatsapp');
    if (btnZap) {
        btnZap.style.display = row.legacy ? 'none' : '';
        btnZap.onclick = () => enviarReciboPorWhatsApp(row.key);
    }

    openModal('modal-sale-details');
};

function renderSales() {
    renderSalesFilters();
    salesHistoryCache = buildSalesHistory();
    renderSalesMetrics(salesHistoryCache);
    renderSalesTable(filteredSalesHistory(salesHistoryCache));

    // Caixa e pagamentos pendentes vieram do Financeiro na Fase C: são as duas
    // ações que cercam a venda — abrir a gaveta antes, cobrar quem ficou
    // devendo depois — e agora moram na mesma tela em que a venda acontece.
    if (typeof renderCaixaOperacional === 'function') renderCaixaOperacional();
    if (typeof renderPendingPayments === 'function') renderPendingPayments();

    const warning = document.getElementById('sales-schema-warning');
    if (warning) warning.hidden = data.salesSchemaReady !== false;

    // Sem a estrutura no Supabase o checkout falharia no meio do atendimento.
    // Melhor o botao dizer o que falta do que a venda morrer no clique.
    const botaoNovaVenda = document.getElementById('btn-new-sale');
    if (botaoNovaVenda) {
        const liberado = typeof checkoutDisponivel === 'function' ? checkoutDisponivel() : true;
        botaoNovaVenda.disabled = !liberado;
        botaoNovaVenda.title = liberado
            ? ''
            : 'Execute docs/sql/14_vendas_base.sql e docs/sql/15_finalizacao_venda.sql no Supabase.';
    }
}

[
    ['sales-filter-period', 'period'],
    ['sales-filter-client', 'client'],
    ['sales-filter-professional', 'professional'],
    ['sales-filter-status', 'status'],
    ['sales-filter-method', 'method']
].forEach(([id, field]) => {
    document.getElementById(id)?.addEventListener('change', event => {
        salesFilters[field] = event.target.value;
        renderSales();
    });
});
