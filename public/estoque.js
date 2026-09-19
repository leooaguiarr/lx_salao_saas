/**
 * ==========================================================================
 * PRODUTOS E ESTOQUE
 *
 * Barbearia vende pomada, shampoo e bebida de geladeira. Sem controle,
 * ninguém sabe que a pomada acabou até o cliente pedir.
 *
 * Este arquivo tem quatro partes, nesta ordem:
 *
 *   1. CADASTRO      — o catálogo: nome, preço, mínimo que dispara o aviso.
 *   2. MOVIMENTAÇÃO  — a tela de Estoque e a única porta que altera `stock`.
 *   3. ATENDIMENTO   — "levou a pomada junto?" na hora de pagar o corte.
 *   4. VITRINE       — o que o cliente vê no link público, sem quantidade.
 *
 * ⚠️ registrarMovimento() é A ÚNICA função que altera `stock`. Financeiro,
 *    pagamento do atendimento e a tela de Estoque passam todos por ela, e cada
 *    chamada deixa uma linha no extrato com o motivo. Saldo que muda sem
 *    rastro é saldo que o dono não defende na frente da nota do fornecedor.
 *
 * Carregado por <script> em index.html, DEPOIS de app.js. Tudo compartilha o
 * mesmo escopo global — não há módulos nem build.
 * ==========================================================================
 */

/* ==========================================================================
   1. CADASTRO
   ========================================================================== */

/* --- BASE DE CÁLCULO DO ESTOQUE ------------------------------------------
   Quem está abaixo do mínimo. Usado pelo badge do menu, pelo aviso dentro da
   aba de Estoque e pelo teste. Uma pergunta, uma resposta. */
function produtosAbaixoDoMinimo() {
    return (data.products || []).filter(p =>
        p.active && Number(p.minStock) > 0 && Number(p.stock) <= Number(p.minStock)
    );
}

// Produto esgotado não entra na vitrine pública nem na venda: oferecer o que
// acabou só gera frustração na hora de entregar.
function produtosDisponiveis() {
    return (data.products || []).filter(p => p.active && Number(p.stock) > 0);
}

function categoriasDeProduto() {
    const vistas = new Set();
    (data.products || []).forEach(p => { if (p.category) vistas.add(p.category); });
    return [...vistas].sort();
}

/* --- Tela ---------------------------------------------------------------- */

function renderProdutos() {
    const grade = document.getElementById('estoque-produtos-grid');
    if (!grade) return;

    const lista = data.products || [];
    if (!lista.length) {
        grade.innerHTML = `
            <p class="lista-vazia">
                Nenhum produto cadastrado. Comece pelo que sai da geladeira e pelo que fica na prateleira.
            </p>`;
    } else {
        // Agrupado por categoria: é como a barbearia pensa o estoque, e é como
        // a vitrine é montada para o cliente.
        const porCategoria = {};
        lista.forEach(p => {
            const cat = p.category || 'Sem categoria';
            (porCategoria[cat] = porCategoria[cat] || []).push(p);
        });

        grade.innerHTML = Object.keys(porCategoria).sort().map(cat => `
            <h5 class="produto-categoria">${escapeHTML(cat)}</h5>
            ${porCategoria[cat].sort((a, b) => a.name.localeCompare(b.name)).map(cardDeProduto).join('')}
        `).join('');
    }

    renderAlertaDeEstoqueNaAba();
    preencherCategoriasConhecidas();
}

function cardDeProduto(p) {
    const baixo = p.active && Number(p.minStock) > 0 && Number(p.stock) <= Number(p.minStock);
    const esgotado = Number(p.stock) <= 0;
    const foto = p.photoUrl
        ? `<img src="${escapeHTML(p.photoUrl)}" alt="" class="produto-foto">`
        : `<div class="produto-foto produto-foto-vazia"><i class="fa-solid fa-box"></i></div>`;

    let selo = '';
    if (esgotado) selo = '<span class="produto-selo esgotado">Esgotado</span>';
    else if (baixo) selo = '<span class="produto-selo baixo">Estoque baixo</span>';

    // Movimentar é o que se faz o dia inteiro; editar cadastro é raro. Por isso
    // entrada e saída ficam no card, e o clique no resto abre a edição.
    return `
        <div class="produto-card ${p.active ? '' : 'inativo'}" onclick="openEditProduct('${escapeHTML(p.id)}')">
            ${foto}
            <div class="produto-info">
                <span class="produto-nome">${escapeHTML(p.name)}${p.active ? '' : ' <em>(inativo)</em>'}</span>
                <span class="produto-preco">${formatCurrency(p.price)}</span>
            </div>
            <div class="produto-estoque">
                <span class="produto-qtd ${esgotado ? 'zero' : (baixo ? 'baixo' : '')}">${Number(p.stock)}</span>
                <span class="produto-qtd-rotulo">em estoque</span>
                ${selo}
            </div>
            <div class="produto-acoes" onclick="event.stopPropagation();">
                <button type="button" class="btn-card-action" title="Entrada"
                        onclick="abrirMovimento('in', '${escapeHTML(p.id)}')">
                    <i class="fa-solid fa-arrow-down text-green"></i>
                </button>
                <button type="button" class="btn-card-action" title="Saída"
                        onclick="abrirMovimento('out', '${escapeHTML(p.id)}')">
                    <i class="fa-solid fa-arrow-up text-red"></i>
                </button>
            </div>
        </div>`;
}

function renderAlertaDeEstoqueNaAba() {
    const alvo = document.getElementById('estoque-alerta');
    if (!alvo) return;
    const faltando = produtosAbaixoDoMinimo();
    if (!faltando.length) { alvo.innerHTML = ''; return; }

    alvo.innerHTML = `
        <div class="estoque-alerta">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <div>
                <strong>${faltando.length} ${faltando.length === 1 ? 'item chegou' : 'itens chegaram'} no mínimo:</strong>
                ${faltando.map(p => `${escapeHTML(p.name)} (${Number(p.stock)})`).join(' · ')}
            </div>
        </div>`;
}

/* Estoque no mínimo, no painel que o dono abre primeiro no dia. Chamado pelo
   renderDashboard().

   O painel inteiro fica escondido quando não há nada faltando: card vazio
   ocupando espaço todo dia treina a pessoa a ignorar a área. */
function renderAlertaDeEstoque() {
    const painel = document.getElementById('dash-estoque-panel');
    const lista = document.getElementById('dash-estoque-list');

    const faltando = produtosAbaixoDoMinimo();

    // O mesmo número no menu lateral: quem está em outra tela precisa saber
    // que falta algo sem passar pelo painel.
    const badge = document.getElementById('badge-estoque');
    if (badge) {
        badge.innerText = faltando.length;
        badge.style.display = faltando.length ? '' : 'none';
    }

    if (!painel || !lista) return;

    if (!faltando.length) {
        painel.style.display = 'none';
        lista.innerHTML = '';
        return;
    }

    painel.style.display = '';
    lista.innerHTML = faltando.slice(0, 5).map(p => `
        <div class="crm-alert-card">
            <div class="crm-alert-text">
                <strong>${escapeHTML(p.name)}</strong>
                <span class="crm-alert-subtext">
                    ${Number(p.stock)} em estoque · avisa abaixo de ${Number(p.minStock)}
                </span>
            </div>
            <span class="produto-selo ${Number(p.stock) <= 0 ? 'esgotado' : 'baixo'}">
                ${Number(p.stock) <= 0 ? 'Esgotado' : 'Repor'}
            </span>
        </div>`).join('');
}

function preencherCategoriasConhecidas() {
    const lista = document.getElementById('lista-categorias-produto');
    if (!lista) return;
    lista.innerHTML = categoriasDeProduto().map(c => `<option value="${escapeHTML(c)}">`).join('');
}

/* --- Cadastro do produto -------------------------------------------------- */

window.openEditProduct = function (id) {
    const p = (data.products || []).find(x => x.id === id);
    if (!p) return;
    document.getElementById('product-modal-title').innerText = 'Editar Produto';
    document.getElementById('product-id').value = p.id;
    document.getElementById('product-name').value = p.name || '';
    document.getElementById('product-category').value = p.category || '';
    document.getElementById('product-price').value = p.price ?? 0;
    document.getElementById('product-stock').value = Number(p.stock) || 0;
    document.getElementById('product-min-stock').value = Number(p.minStock) || 0;
    document.getElementById('product-active').checked = p.active !== false;
    document.getElementById('btn-delete-product').style.display = 'inline-flex';

    // Na edição a quantidade some do formulário. Trocar o número aqui mudaria
    // o saldo sem deixar rastro, e o extrato deixaria de explicar o estoque —
    // que é o motivo de ele existir. Para mexer, Entrada ou Saída.
    document.getElementById('product-bloco-estoque').style.display = 'none';
    document.getElementById('product-estoque-atual').style.display = 'block';
    document.getElementById('product-estoque-atual-texto').innerText =
        `${Number(p.stock) || 0} em estoque. Para mudar, use Entrada ou Saída — assim fica no extrato.`;

    const prev = document.getElementById('product-photo-preview');
    prev.src = p.photoUrl || '';
    prev.style.display = p.photoUrl ? 'block' : 'none';
    document.getElementById('product-photo').value = '';

    preencherCategoriasConhecidas();
    openModal('modal-product');
};

function abrirNovoProduto() {
    document.getElementById('product-modal-title').innerText = 'Novo Produto';
    document.getElementById('form-product').reset();
    document.getElementById('product-id').value = '';
    document.getElementById('product-active').checked = true;
    document.getElementById('btn-delete-product').style.display = 'none';
    document.getElementById('product-bloco-estoque').style.display = '';
    document.getElementById('product-estoque-atual').style.display = 'none';
    const prev = document.getElementById('product-photo-preview');
    prev.src = ''; prev.style.display = 'none';
    preencherCategoriasConhecidas();
    openModal('modal-product');
}

function salvarProduto(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('product-id').value;
    const prev = document.getElementById('product-photo-preview');

    const registro = {
        name: sanitizePlainText(document.getElementById('product-name').value),
        category: sanitizePlainText(document.getElementById('product-category').value),
        price: parseFloat(document.getElementById('product-price').value) || 0,
        stock: parseInt(document.getElementById('product-stock').value, 10) || 0,
        minStock: parseInt(document.getElementById('product-min-stock').value, 10) || 0,
        active: document.getElementById('product-active').checked,
        photoUrl: prev.src && prev.src.startsWith('data:') ? prev.src : (prev.src || '')
    };

    if (!registro.name) {
        showToast('Dê um nome ao produto.', 'warning');
        return;
    }

    if (id) {
        const p = data.products.find(x => x.id === id);
        if (p) {
            // A quantidade não vem do cadastro na edição — ver openEditProduct.
            delete registro.stock;
            Object.assign(p, registro);
        }
    } else {
        // A quantidade inicial é saldo de abertura, não movimento: o produto
        // acabou de nascer e não há histórico para explicar.
        data.products.push({ id: 'prod-' + Date.now(), ...registro });
    }

    saveData(STATE_KEYS.PRODUCTS, data.products);
    closeModal('modal-product');
    renderEstoque();
    renderDashboard();
    showToast(id ? 'Produto atualizado.' : 'Produto cadastrado.', 'success');
}

function excluirProduto() {
    const id = document.getElementById('product-id').value;
    if (!id) return;
    if (!confirm('Excluir este produto? Os lançamentos já feitos continuam no financeiro.')) return;

    data.products = data.products.filter(p => p.id !== id);
    saveData(STATE_KEYS.PRODUCTS, data.products);
    if (typeof DataService !== 'undefined' && DataService.deleteItem) {
        DataService.deleteItem('products', id).catch(err => console.warn('Falha ao excluir na nuvem:', err));
    }
    closeModal('modal-product');
    renderEstoque();
    renderDashboard();
    showToast('Produto excluído.', 'warning');
}

/* Foto reduzida a 200px. O projeto grava imagem como data URL, então cada
   produto do catálogo entra no payload que o cliente baixa na fila — 200px é
   o que mantém a vitrine leve sem ficar borrada no celular. */
function lerFotoDoProduto(e) {
    const arquivo = e.target.files && e.target.files[0];
    if (!arquivo) return;
    resizeImageToDataURL(arquivo, 200, (dataUrl) => {
        const prev = document.getElementById('product-photo-preview');
        prev.src = dataUrl;
        prev.style.display = 'block';
    });
}

/* ==========================================================================
   2. MOVIMENTAÇÃO E ANÁLISE

   Antes o estoque era um número solto: mudava e ninguém sabia por quê. Aqui
   ele passa a ter extrato — uma linha por entrada e por saída, com o motivo
   escrito.
   ========================================================================== */

// Motivo é campo obrigatório e fechado: lista curta que o balcão escolhe sem
// pensar. Texto livre aqui viraria "ajuste", "ajuste2", "correção" — e a
// análise do fim do mês não conseguiria agrupar nada.
const MOTIVOS_DE_ENTRADA = {
    compra: 'Compra / reposição',
    devolucao: 'Devolução do cliente',
    ajuste: 'Acerto de inventário'
};

const MOTIVOS_DE_SAIDA = {
    venda: 'Venda',
    perda: 'Perda / quebra / vencido',
    uso_interno: 'Uso interno (no atendimento)',
    ajuste: 'Acerto de inventário'
};

function rotuloDoMotivo(m) {
    return MOTIVOS_DE_ENTRADA[m] || MOTIVOS_DE_SAIDA[m] || m || 'Movimento';
}

/* --- A ÚNICA PORTA POR ONDE O ESTOQUE MUDA --------------------------------
   Na nuvem, quem move é o RPC do docs/add_movimentacao_estoque.sql: o UPDATE
   lá é relativo (`stock - qtd`), então duas vendas ao mesmo tempo somam em vez
   de uma apagar a outra. Sem a migração — ou sem Supabase — a baixa acontece
   aqui mesmo e o extrato fica no aparelho, que é o mesmo caminho do resto do
   app. */
async function registrarMovimento(mov) {
    const prod = (data.products || []).find(p => p.id === mov.productId);
    if (!prod) return null;

    const qty = Math.max(1, parseInt(mov.qty, 10) || 0);
    const unit = Number(mov.unitPrice) || 0;

    const registro = {
        id: mov.id || ('mov-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
        productId: prod.id,
        productName: prod.name,
        type: mov.type === 'in' ? 'in' : 'out',
        qty: qty,
        reason: mov.reason || 'ajuste',
        unitPrice: unit,
        total: unit * qty,
        clientId: mov.clientId || null,
        appointmentId: mov.appointmentId || null,
        profId: mov.profId || null,
        transactionId: mov.transactionId || null,
        note: mov.note || null,
        date: mov.date || getLocalDateString(new Date()),
        created_at: new Date().toISOString()
    };

    // Nunca deixa negativo: se o estoque do sistema já estava atrás do real, o
    // movimento passa e o saldo zera. Quem corrige é o inventário, não a venda
    // — travar aqui deixaria o cliente esperando no balcão por um número.
    const previsto = Math.max(0, Number(prod.stock) + (registro.type === 'in' ? qty : -qty));

    let resultado = { ok: false };
    try {
        resultado = await DataService.registrarMovimentoEstoque(registro);
    } catch (err) {
        console.warn('Falha ao registrar movimento na nuvem:', err);
    }

    if (resultado.ok && typeof resultado.stock === 'number') {
        prod.stock = resultado.stock;
        // Só o espelho local, NUNCA o upsert do catálogo (o porquê está logo
        // abaixo). Antes o ciclo de 30 segundos corrigia este cache sozinho;
        // agora o catálogo só volta da nuvem de tempos em tempos, e sem esta
        // linha um F5 mostraria o estoque anterior ao movimento.
        try {
            localStorage.setItem(STATE_KEYS.PRODUCTS, JSON.stringify(data.products));
        } catch (e) {
            console.warn('Cache local dos produtos não atualizado:', e);
        }
    } else {
        prod.stock = previsto;
        // Só aqui o catálogo inteiro é regravado. Quando o RPC funciona, ele já
        // atualizou a linha do produto — regravar por cima desfaria a venda de
        // quem estivesse vendendo ao mesmo tempo.
        saveData(STATE_KEYS.PRODUCTS, data.products);
    }

    data.stockMovements = data.stockMovements || [];
    data.stockMovements.push(registro);
    saveData(STATE_KEYS.STOCK_MOVEMENTS, data.stockMovements);

    return registro;
}

/* Lançamento no Financeiro nascido de um movimento de estoque. Mesma regra de
   caixa fechado que vale no lançamento manual: dinheiro sem caixa aberto entra
   como pendente, senão o saldo em gaveta mentiria. */
function lancarTransacaoDeEstoque(dados) {
    const activeRegister = window.getCurrentCashRegister ? window.getCurrentCashRegister() : null;
    let status = 'completed';
    if (!activeRegister && dados.paymentMethod === 'dinheiro') status = 'pending';

    const t = {
        id: 'tr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: dados.type,
        amount: Number(dados.amount) || 0,
        date: dados.date || getLocalDateString(new Date()),
        registradoEm: new Date().toISOString(),
        description: dados.description || '',
        category: dados.category,
        paymentMethod: dados.paymentMethod || 'pix',
        profId: dados.profId || '',
        status: status
    };
    if (dados.productId) t.productId = dados.productId;
    if (dados.productQty) t.productQty = dados.productQty;
    if (dados.clientId) t.clientId = dados.clientId;
    if (dados.appointmentId) t.appointmentId = dados.appointmentId;

    data.transactions.push(t);
    saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
    return t;
}

/* --- BASE DE CÁLCULO DA ANÁLISE ------------------------------------------
   Uma pergunta, uma resposta. A tela, o resumo e o teste leem daqui. */

// Dinheiro parado na prateleira, pelo preço de venda.
function valorEmEstoque() {
    return (data.products || []).reduce((soma, p) =>
        soma + (Number(p.price) || 0) * Math.max(0, Number(p.stock) || 0), 0);
}

function movimentosDesde(dataInicial) {
    return (data.stockMovements || [])
        .filter(m => (m.date || '') >= dataInicial)
        .sort((a, b) => String(b.created_at || b.date).localeCompare(String(a.created_at || a.date)));
}

function dataDeCorte(dias) {
    const d = new Date();
    d.setDate(d.getDate() - (Number(dias) || 30));
    return getLocalDateString(d);
}

/* --- Tela ---------------------------------------------------------------- */

function renderEstoque() {
    renderProdutos();
    renderResumoDoEstoque();
    renderMovimentacoes();
}

function renderResumoDoEstoque() {
    const alvo = document.getElementById('estoque-resumo');
    if (!alvo) return;

    const lista = (data.products || []).filter(p => p.active);
    const faltando = produtosAbaixoDoMinimo();
    const esgotados = lista.filter(p => Number(p.stock) <= 0).length;

    const hoje = getLocalDateString(new Date());
    const vendidoHoje = (data.stockMovements || [])
        .filter(m => m.date === hoje && m.reason === 'venda')
        .reduce((s, m) => s + (Number(m.total) || 0), 0);

    alvo.innerHTML = `
        <div class="metric-card glass-effect">
            <span class="metric-label">Vendido hoje</span>
            <span class="metric-value text-green">${formatCurrency(vendidoHoje)}</span>
        </div>
        <div class="metric-card glass-effect">
            <span class="metric-label">Parado na prateleira</span>
            <span class="metric-value">${formatCurrency(valorEmEstoque())}</span>
        </div>
        <div class="metric-card glass-effect">
            <span class="metric-label">Itens no mínimo</span>
            <span class="metric-value ${faltando.length ? 'text-warning' : ''}">${faltando.length}</span>
        </div>
        <div class="metric-card glass-effect">
            <span class="metric-label">Esgotados</span>
            <span class="metric-value ${esgotados ? 'text-danger' : ''}">${esgotados}</span>
        </div>`;
}

function renderMovimentacoes() {
    const corpo = document.getElementById('estoque-movimentos');
    if (!corpo) return;

    const lista = movimentosDesde(dataDeCorte(90)).slice(0, 20);
    if (!lista.length) {
        corpo.innerHTML = `
            <p class="lista-vazia">
                Nenhuma movimentação ainda. Toda entrada e saída registrada aqui
                vira o extrato que explica o saldo de cada produto.
            </p>`;
        return;
    }

    corpo.innerHTML = lista.map(m => {
        const entrada = m.type === 'in';
        const cliente = m.clientId
            ? (data.clients || []).find(c => c.id === m.clientId)
            : null;
        const detalhe = [
            rotuloDoMotivo(m.reason),
            cliente ? escapeHTML(cliente.name) : '',
            m.appointmentId ? 'no atendimento' : ''
        ].filter(Boolean).join(' · ');

        return `
            <div class="movimento-linha">
                <span class="movimento-icone ${entrada ? 'entrada' : 'saida'}">
                    <i class="fa-solid fa-arrow-${entrada ? 'down' : 'up'}"></i>
                </span>
                <div class="movimento-texto">
                    <strong>${escapeHTML(m.productName || 'Produto')}</strong>
                    <span class="movimento-detalhe">${formatDateStringToBR(m.date)} · ${detalhe}</span>
                </div>
                <span class="movimento-qtd ${entrada ? 'entrada' : 'saida'}">
                    ${entrada ? '+' : '−'}${Number(m.qty)}
                </span>
                <span class="movimento-valor">${Number(m.total) ? formatCurrency(m.total) : ''}</span>
            </div>`;
    }).join('');
}

/* --- Modal de movimentação ------------------------------------------------ */

window.abrirMovimento = function (tipo, produtoId) {
    const form = document.getElementById('form-stock-movement');
    if (form) form.reset();

    document.getElementById('mov-type').value = tipo;
    document.getElementById('stock-movement-title').innerText =
        tipo === 'in' ? 'Entrada no estoque' : 'Saída do estoque';

    const select = document.getElementById('mov-produto');
    const lista = (data.products || []).filter(p => p.active);
    if (!lista.length) {
        showToast('Cadastre um produto antes de movimentar o estoque.', 'warning');
        return;
    }
    select.innerHTML = lista
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${Number(p.stock)} em estoque</option>`)
        .join('');
    if (produtoId) select.value = produtoId;

    const motivos = tipo === 'in' ? MOTIVOS_DE_ENTRADA : MOTIVOS_DE_SAIDA;
    document.getElementById('mov-motivo').innerHTML = Object.keys(motivos)
        .map(k => `<option value="${k}">${motivos[k]}</option>`).join('');

    const clienteSelect = document.getElementById('mov-cliente');
    clienteSelect.innerHTML = '<option value="">Não identificado</option>' +
        (data.clients || []).map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');

    document.getElementById('mov-qtd').value = 1;
    document.getElementById('mov-data').value = getLocalDateString(new Date());
    document.getElementById('mov-lancar').checked = true;
    document.getElementById('mov-obs').value = '';
    document.getElementById('mov-valor').dataset.tocado = '';

    atualizarCamposDoMovimento();
    openModal('modal-stock-movement');
};

/* O formulário muda de cara conforme o motivo. Venda pede cliente e forma de
   pagamento; perda não pede nada disso — e mostrar campo que não se aplica é o
   que faz o balcão preencher qualquer coisa para o formulário liberar. */
function atualizarCamposDoMovimento() {
    const tipo = document.getElementById('mov-type').value;
    const motivo = document.getElementById('mov-motivo').value;
    const prod = (data.products || []).find(p => p.id === document.getElementById('mov-produto').value);

    const ehVenda = tipo === 'out' && motivo === 'venda';
    const ehCompra = tipo === 'in' && motivo === 'compra';
    const mexeNoCaixa = ehVenda || ehCompra;

    document.getElementById('mov-bloco-cliente').style.display = ehVenda ? 'block' : 'none';
    document.getElementById('mov-bloco-caixa').style.display = mexeNoCaixa ? 'block' : 'none';
    document.getElementById('mov-bloco-valor').style.display = mexeNoCaixa ? 'block' : 'none';

    const valor = document.getElementById('mov-valor');
    if (mexeNoCaixa && prod && !valor.dataset.tocado) {
        // Venda usa o preço de tabela; compra começa em branco, porque o custo
        // do fornecedor não é o preço de venda e chutar aqui estragaria o
        // lançamento de despesa.
        valor.value = ehVenda ? Number(prod.price).toFixed(2) : '';
    }

    document.getElementById('mov-rotulo-valor').innerText =
        ehCompra ? 'Custo unitário (R$)' : 'Valor unitário (R$)';
    document.getElementById('mov-rotulo-lancar').innerText = ehCompra
        ? 'Lançar como despesa no Financeiro'
        : 'Lançar a entrada no Financeiro';

    atualizarTotalDoMovimento();
}

function atualizarTotalDoMovimento() {
    const qtd = parseInt(document.getElementById('mov-qtd').value, 10) || 0;
    const unit = parseFloat(document.getElementById('mov-valor').value) || 0;
    const alvo = document.getElementById('mov-total');
    if (alvo) alvo.innerText = qtd && unit ? formatCurrency(qtd * unit) : '—';
}

async function salvarMovimento(e) {
    if (e) e.preventDefault();

    const tipo = document.getElementById('mov-type').value;
    const produtoId = document.getElementById('mov-produto').value;
    const qtd = parseInt(document.getElementById('mov-qtd').value, 10) || 0;
    const motivo = document.getElementById('mov-motivo').value;
    const unit = parseFloat(document.getElementById('mov-valor').value) || 0;
    const clientId = document.getElementById('mov-cliente').value;
    const dataMov = document.getElementById('mov-data').value || getLocalDateString(new Date());
    const obs = sanitizePlainText(document.getElementById('mov-obs').value);
    const lancar = document.getElementById('mov-lancar').checked;
    const forma = document.getElementById('mov-forma').value;

    if (!produtoId || qtd <= 0) {
        showToast('Escolha o produto e uma quantidade maior que zero.', 'warning');
        return;
    }

    const prod = (data.products || []).find(p => p.id === produtoId);
    const ehVenda = tipo === 'out' && motivo === 'venda';
    const ehCompra = tipo === 'in' && motivo === 'compra';

    let transacao = null;
    if (lancar && (ehVenda || ehCompra) && unit > 0) {
        const cliente = clientId ? (data.clients || []).find(c => c.id === clientId) : null;
        transacao = lancarTransacaoDeEstoque({
            type: ehVenda ? 'income' : 'expense',
            amount: unit * qtd,
            date: dataMov,
            description: ehVenda
                ? `${qtd > 1 ? qtd + 'x ' : ''}${prod.name}${cliente ? ' - ' + cliente.name : ''}`
                : `Reposição: ${qtd}x ${prod.name}`,
            category: ehVenda ? 'Produto' : 'Estoque',
            paymentMethod: forma,
            productId: prod.id,
            productQty: qtd,
            clientId: clientId || ''
        });
    }

    await registrarMovimento({
        productId: produtoId,
        type: tipo,
        qty: qtd,
        reason: motivo,
        unitPrice: unit,
        clientId: ehVenda ? clientId : '',
        transactionId: transacao ? transacao.id : '',
        note: obs,
        date: dataMov
    });

    closeModal('modal-stock-movement');
    renderEstoque();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderFinance === 'function' && document.getElementById('page-financeiro')?.classList.contains('active')) {
        renderFinance();
    }

    const novo = Number(prod.stock);
    showToast(
        `${tipo === 'in' ? 'Entrada' : 'Saída'} de ${qtd} registrada. ${escapeHTML(prod.name)}: ${novo} em estoque.`,
        tipo === 'in' ? 'success' : 'info'
    );
}

/* --- Venda de produto no Financeiro --------------------------------------
   Antes, "Venda de Produto" era só um rótulo: valor digitado à mão e nenhum
   produto por trás. Agora escolher o item preenche o valor e desconta do
   estoque no mesmo lançamento — uma escrita só, sem duas verdades.

   A baixa em si acontece no submit do form-transaction (app.js), passando por
   registrarMovimento() como todo o resto. */
function atualizarBlocoDeProduto() {
    const bloco = document.getElementById('trans-produto-bloco');
    const select = document.getElementById('trans-produto');
    if (!bloco || !select) return;

    const ehVendaDeProduto =
        document.getElementById('trans-type').value === 'income' &&
        document.getElementById('trans-category').value === 'Produto';

    bloco.style.display = ehVendaDeProduto ? 'block' : 'none';
    if (!ehVendaDeProduto) return;

    const disponiveis = produtosDisponiveis();
    if (!disponiveis.length) {
        select.innerHTML = '<option value="">Nenhum produto com estoque</option>';
        document.getElementById('trans-produto-aviso').innerText =
            'Cadastre produtos na aba Estoque. O lançamento pode ser salvo mesmo assim, sem baixa.';
        return;
    }
    select.innerHTML = disponiveis.map(p =>
        `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${formatCurrency(p.price)} · ${Number(p.stock)} em estoque</option>`
    ).join('');

    // Quem comprou é opcional, mas é o campo que responde se produto vende
    // mais para quem agenda ou para quem entra só para levar — ver a análise
    // na tela de Estoque.
    const cliente = document.getElementById('trans-produto-cliente');
    if (cliente) {
        cliente.innerHTML = '<option value="">Não identificado</option>' +
            (data.clients || []).map(c =>
                `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');
    }

    document.getElementById('trans-produto-aviso').innerText =
        'O valor é preenchido sozinho e o estoque baixa ao salvar.';
    preencherValorDoProduto();
}

function preencherValorDoProduto() {
    const p = (data.products || []).find(x => x.id === document.getElementById('trans-produto').value);
    if (!p) return;
    const qtd = parseInt(document.getElementById('trans-produto-qtd').value, 10) || 1;
    document.getElementById('trans-amount').value = (Number(p.price) * qtd).toFixed(2);
    const desc = document.getElementById('trans-description');
    if (!desc.value || desc.dataset.autoproduto === '1') {
        desc.value = qtd > 1 ? `${qtd}x ${p.name}` : p.name;
        desc.dataset.autoproduto = '1';
    }
}

/* ==========================================================================
   3. PRODUTO NO ATENDIMENTO

   "Leva a pomada junto?" acontece na hora de pagar o corte, não numa tela
   separada depois.

   O serviço e o produto viram DOIS lançamentos no Financeiro, de propósito.
   Misturar os dois num valor só estragaria o faturamento por serviço, a
   comissão do profissional (que é sobre o serviço) e a própria conta que
   responde de onde vem a venda de produto.
   ========================================================================== */

// O que o cliente pegou nesta visita. Vive só enquanto o modal está aberto:
// atendimento salvo esvazia, atendimento cancelado joga fora.
let carrinhoDoAtendimento = [];

function prepararProdutosDoAtendimento() {
    carrinhoDoAtendimento = [];

    const bloco = document.getElementById('appt-produtos-bloco');
    if (!bloco) return;

    const disponiveis = produtosDisponiveis();

    // A quantidade volta para 1 SEMPRE, mesmo com o bloco escondido. Um valor
    // esquisito parado num campo invisível é o tipo de coisa que trava o
    // formulário e não tem como a pessoa descobrir.
    document.getElementById('appt-produto-qtd').value = 1;

    // v1.6.0: o carrinho de produtos saiu da TELA do agendamento. Vender
    // produto junto com o corte agora é no checkout da aba Vendas, que grava
    // serviço e produto na MESMA venda — antes eram dois caminhos diferentes
    // para a mesma conta, e só um deles gerava recibo.
    //
    // O bloco nunca mais é exibido, mas a função continua montando o seletor e
    // o carrinho normalmente. É de propósito: uma versão anterior desta
    // mudança cortava aqui com um `return`, o que deixava todo o resto da
    // função inalcançável e quebrava a lógica do carrinho junto com a tela —
    // código morto no meio do arquivo é pior do que código sem uso.
    //
    // A remoção de verdade é apagar este carrinho e os 21 pontos que ainda o
    // referenciam em app.js/estoque.js, anotada nos Próximos Passos.
    bloco.style.display = 'none';
    if (!disponiveis.length) { renderCarrinhoDoAtendimento(); return; }

    // A primeira opção é "não levou nada", e é ela que fica escolhida. Sem
    // isso o seletor já abria com um produto selecionado: quem só queria
    // fechar a conta do corte via a cerveja ali e não achava como tirá-la.
    // Nada é cobrado sem clicar no "+", mas a tela precisa dizer isso sozinha.
    document.getElementById('appt-produto').innerHTML =
        '<option value="">Não levou nenhum produto</option>' +
        disponiveis
            .map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${formatCurrency(p.price)}</option>`)
            .join('');

    renderCarrinhoDoAtendimento();
}

window.adicionarProdutoAoAtendimento = function () {
    const id = document.getElementById('appt-produto').value;
    if (!id) {
        showToast('Escolha o produto antes de somar à conta.', 'warning');
        return;
    }

    const qtd = Math.max(1, parseInt(document.getElementById('appt-produto-qtd').value, 10) || 1);
    const prod = (data.products || []).find(p => p.id === id);
    if (!prod) return;

    const disponivel = Number(prod.stock) || 0;
    const jaNoCarrinho = carrinhoDoAtendimento
        .filter(i => i.productId === id)
        .reduce((s, i) => s + i.qty, 0);

    // Aviso, não bloqueio: o estoque do sistema pode estar atrás do real, e
    // quem está com o produto na mão é quem sabe. A regra de não deixar
    // negativo continua valendo lá no movimento.
    if (jaNoCarrinho + qtd > disponivel) {
        showToast(`${prod.name} tem ${disponivel} em estoque. Confira antes de entregar.`, 'warning');
    }

    const existente = carrinhoDoAtendimento.find(i => i.productId === id);
    if (existente) existente.qty += qtd;
    else carrinhoDoAtendimento.push({ productId: id, name: prod.name, price: Number(prod.price) || 0, qty: qtd });

    // Volta para "não levou nada": o item já está na lista abaixo, e deixar o
    // nome dele no seletor faz parecer que ele será cobrado outra vez.
    document.getElementById('appt-produto').value = '';
    document.getElementById('appt-produto-qtd').value = 1;
    renderCarrinhoDoAtendimento();
};

window.removerProdutoDoAtendimento = function (id) {
    carrinhoDoAtendimento = carrinhoDoAtendimento.filter(i => i.productId !== id);
    renderCarrinhoDoAtendimento();
};

function totalDosProdutosDoAtendimento() {
    return carrinhoDoAtendimento.reduce((s, i) => s + i.price * i.qty, 0);
}

function renderCarrinhoDoAtendimento() {
    const lista = document.getElementById('appt-produtos-lista');
    if (!lista) return;

    if (!carrinhoDoAtendimento.length) { lista.innerHTML = ''; return; }

    const servico = parseFloat(document.getElementById('appt-payment-value')?.value) || 0;
    const produtos = totalDosProdutosDoAtendimento();

    lista.innerHTML = carrinhoDoAtendimento.map(i => `
        <div class="appt-produto-item">
            <span class="appt-produto-nome">${i.qty}x ${escapeHTML(i.name)}</span>
            <span class="appt-produto-valor">${formatCurrency(i.price * i.qty)}</span>
            <button type="button" class="btn-card-action" title="Tirar da conta"
                    onclick="removerProdutoDoAtendimento('${escapeHTML(i.productId)}')">
                <i class="fa-solid fa-xmark text-danger"></i>
            </button>
        </div>`).join('') + `
        <div class="appt-produto-total">
            Serviço ${formatCurrency(servico)} + produtos ${formatCurrency(produtos)}
            = <strong>${formatCurrency(servico + produtos)}</strong>
        </div>`;
}

/* Produto só é cobrado quando o pagamento é confirmado. Sem este aviso, quem
   monta a conta e salva com "Não (Pendente)" perde os itens em silêncio e só
   descobre no fim do dia, quando o caixa não fecha. */
function avisarProdutosNaoCobrados() {
    if (!carrinhoDoAtendimento.length) return;
    const total = totalDosProdutosDoAtendimento();
    carrinhoDoAtendimento = [];
    showToast(
        `Os ${formatCurrency(total)} em produtos não foram lançados: confirme o pagamento como "Sim (Pago)" para cobrar.`,
        'warning'
    );
}

/* Chamado quando o atendimento passa a pago (ver triggerFinancialLogging, em
   app.js). Um lançamento só para todos os produtos da visita — no Financeiro
   isso é uma compra, e listar quatro linhas para uma pessoa que levou quatro
   coisas só polui o extrato. O detalhe item a item fica no extrato do estoque,
   que é onde ele é procurado. */
async function concluirVendaDoAtendimento(appt) {
    const itens = carrinhoDoAtendimento.slice();
    carrinhoDoAtendimento = [];
    if (!itens.length) return;

    const cliente = (data.clients || []).find(c => c.id === appt.clientId);
    const total = itens.reduce((s, i) => s + i.price * i.qty, 0);
    const resumo = itens.map(i => `${i.qty}x ${i.name}`).join(', ');

    const transacao = lancarTransacaoDeEstoque({
        type: 'income',
        amount: total,
        date: appt.date,
        description: `Produtos: ${resumo}${cliente ? ' - ' + cliente.name : ''}`,
        category: 'Produto',
        paymentMethod: appt.paymentMethod || 'pix',
        profId: appt.profId || '',
        clientId: appt.clientId || '',
        appointmentId: appt.id
    });

    for (const i of itens) {
        await registrarMovimento({
            productId: i.productId,
            type: 'out',
            qty: i.qty,
            reason: 'venda',
            unitPrice: i.price,
            clientId: appt.clientId || '',
            appointmentId: appt.id,
            profId: appt.profId || '',
            transactionId: transacao.id,
            date: appt.date
        });
    }

    showToast(`${formatCurrency(total)} em produtos somados à conta.`, 'success');

    if (document.getElementById('page-estoque')?.classList.contains('active')) {
        renderEstoque();
    }
    if (typeof renderDashboard === 'function') renderDashboard();
}

/* ==========================================================================
   4. VITRINE — o que a barbearia vende, no celular de quem está esperando

   O melhor momento para isso é a fila: o cliente está sentado, esperando, com
   o celular na mão. Na tela de sucesso ele já resolveu o que veio fazer e está
   indo embora, então lá a vitrine é só um lembrete.

   ⚠️ A lista NÃO traz quantidade: estoque é informação do negócio e a página é
   pública. Esgotado nem aparece (ver docs/add_produtos_e_estoque.sql).
   ========================================================================== */

let vitrineProdutos = null;

async function carregarVitrine() {
    // Uma vez por sessão: o catálogo não muda enquanto o cliente espera, e a
    // fila já consulta o servidor de 30 em 30 segundos.
    if (vitrineProdutos !== null) return vitrineProdutos;
    if (!publicSalonMode || !publicSlug) {
        // Simulador local (Configurações): usa o que está cadastrado na tela.
        vitrineProdutos = produtosDisponiveis();
        return vitrineProdutos;
    }
    vitrineProdutos = await DataService.getPublicProducts(publicSlug);
    return vitrineProdutos;
}

function htmlDaVitrine(produtos, titulo) {
    if (!produtos || !produtos.length) return '';

    const porCategoria = {};
    produtos.forEach(p => {
        const cat = p.category || 'Outros';
        (porCategoria[cat] = porCategoria[cat] || []).push(p);
    });

    const blocos = Object.keys(porCategoria).sort().map(cat => `
        <div class="vitrine-grupo">
            <span class="vitrine-categoria">${escapeHTML(cat)}</span>
            ${porCategoria[cat].map(p => `
                <div class="vitrine-item">
                    ${p.photoUrl ? `<img class="vitrine-foto" src="${escapeHTML(p.photoUrl)}" alt="">` : ''}
                    <span class="vitrine-nome">${escapeHTML(p.name)}</span>
                    <span class="vitrine-preco">${formatCurrency(p.price)}</span>
                </div>`).join('')}
        </div>`).join('');

    return `
        <div class="vitrine">
            <h5 class="vitrine-titulo">${escapeHTML(titulo)}</h5>
            ${blocos}
            <p class="vitrine-aviso">Peça ao seu profissional durante o atendimento.</p>
        </div>`;
}

/* Desenha a vitrine depois que a tela principal já apareceu. Buscar antes de
   mostrar a fila deixaria o cliente olhando tela em branco por causa de um
   catálogo — a informação que ele abriu o link para ver é a vez dele. */
async function anexarVitrine(idDoAlvo, titulo) {
    const produtos = await carregarVitrine();
    const alvo = document.getElementById(idDoAlvo);
    if (!alvo || !produtos || !produtos.length) return;
    alvo.insertAdjacentHTML('beforeend', htmlDaVitrine(produtos, titulo));
}

/* ==========================================================================
   LIGAÇÕES COM A TELA
   ========================================================================== */

document.getElementById('btn-add-product')?.addEventListener('click', abrirNovoProduto);
document.getElementById('form-product')?.addEventListener('submit', salvarProduto);
document.getElementById('btn-delete-product')?.addEventListener('click', excluirProduto);
document.getElementById('product-photo')?.addEventListener('change', lerFotoDoProduto);

document.getElementById('btn-estoque-entrada')?.addEventListener('click', () => abrirMovimento('in'));
document.getElementById('btn-estoque-saida')?.addEventListener('click', () => abrirMovimento('out'));
document.getElementById('form-stock-movement')?.addEventListener('submit', salvarMovimento);
document.getElementById('mov-motivo')?.addEventListener('change', atualizarCamposDoMovimento);
document.getElementById('mov-produto')?.addEventListener('change', () => {
    document.getElementById('mov-valor').dataset.tocado = '';
    atualizarCamposDoMovimento();
});
document.getElementById('mov-qtd')?.addEventListener('input', atualizarTotalDoMovimento);
document.getElementById('mov-valor')?.addEventListener('input', function () {
    this.dataset.tocado = '1';
    atualizarTotalDoMovimento();
});

document.getElementById('trans-category')?.addEventListener('change', atualizarBlocoDeProduto);
document.getElementById('trans-produto')?.addEventListener('change', preencherValorDoProduto);
document.getElementById('trans-produto-qtd')?.addEventListener('input', preencherValorDoProduto);
document.getElementById('trans-description')?.addEventListener('input', function () {
    // Digitou por cima: para de sobrescrever a descrição.
    this.dataset.autoproduto = '0';
});

document.getElementById('btn-appt-add-produto')?.addEventListener('click', adicionarProdutoAoAtendimento);
document.getElementById('appt-payment-value')?.addEventListener('input', renderCarrinhoDoAtendimento);

// O piso de 1 vive aqui, e não no `min` do HTML. No `change` (sai do campo ou
// clica na setinha), não no `input`: corrigir enquanto a pessoa digita
// atrapalha quem está apagando para trocar o número.
document.getElementById('appt-produto-qtd')?.addEventListener('change', function () {
    if (!this.value || parseInt(this.value, 10) < 1) this.value = 1;
});
