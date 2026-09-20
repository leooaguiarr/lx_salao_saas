/**
 * ==========================================================================
 * RECIBO DA VENDA (Fase G)
 *
 * Recibo não fiscal de uma venda concluída: reconstrói o que foi vendido a
 *    partir dos itens e pagamentos gravados na hora da venda (sale_items,
 *    sale_payments) — nunca do cadastro atual de serviço/produto. Mudar o
 *    preço de um corte amanhã não muda o recibo de uma venda de ontem.
 *
 *    Reaproveita a infraestrutura de PDF de 16-extratos-pdf.js
 *    (garantirPDF/pdfCabecalho/pdfRodape/estiloTabela) — nenhuma biblioteca
 *    nova, nenhum carregamento novo.
 *
 *    O compartilhamento por WhatsApp NÃO anexa o PDF (o navegador não deixa):
 *    manda um resumo em texto. O PDF continua disponível para visualizar,
 *    imprimir ou salvar pelo próprio visualizador do navegador.
 *
 * Carregado por <script> em index.html, na ordem do numero do arquivo.
 * Tudo compartilha o mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

function montarReciboVenda(row) {
    const doc = new window.jspdf.jsPDF();
    let y = pdfCabecalho(doc, 'Recibo de Venda #' + row.number, saleDateTimeLabel(row));

    const biz = data.businessInfo || {};
    const linhasBiz = [
        biz.address || '',
        [biz.phone, biz.instagram ? '@' + biz.instagram : ''].filter(Boolean).join('  ·  ')
    ].filter(Boolean);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(PDF_CINZA[0], PDF_CINZA[1], PDF_CINZA[2]);
    linhasBiz.forEach((linha, i) => doc.text(linha, 14, y + i * 4));
    y += linhasBiz.length * 4 + 4;

    y = tituloSecao(doc, y, 'Venda');
    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Cliente', 'Profissional', 'Situação']],
        body: [[row.clientName, row.professionalName, saleStatusLabel(row.status)]]
    }));
    y = doc.lastAutoTable.finalY + 8;

    y = tituloSecao(doc, y, 'Itens');
    const linhasItens = row.items.map(item => [
        saleValue(item, 'item_type', 'itemType') === 'service' ? 'Serviço' : 'Produto',
        saleValue(item, 'item_name', 'itemName') || 'Item',
        String(Number(item.quantity) || 0),
        formatCurrency(Number(saleValue(item, 'gross_amount', 'grossAmount')) || 0),
        formatCurrency(Number(saleValue(item, 'net_amount', 'netAmount')) || 0)
    ]);
    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Tipo', 'Item', 'Qtd.', 'Bruto', 'Líquido']],
        body: linhasItens.length ? linhasItens : [[{
            content: 'Sem itens detalhados.', colSpan: 5,
            styles: { halign: 'center', textColor: PDF_CINZA }
        }]],
        columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } }
    }));
    y = doc.lastAutoTable.finalY + 8;

    // Ajustes: só aparecem quando existem. Uma venda sem desconto nem
    // acréscimo não precisa de linha "R$ 0,00" para provar isso.
    const venda = row.raw || {};
    const subtotal = Number(saleValue(venda, 'subtotal')) || row.total;
    const desconto = Number(saleValue(venda, 'discount_amount', 'discountAmount')) || 0;
    const acrescimo = Number(saleValue(venda, 'surcharge_amount', 'surchargeAmount')) || 0;

    y = tituloSecao(doc, y, 'Resumo');
    const linhasResumo = [['Subtotal', formatCurrency(subtotal)]];
    if (desconto > 0) linhasResumo.push(['Desconto', '- ' + formatCurrency(desconto)]);
    if (acrescimo > 0) linhasResumo.push(['Acréscimo', '+ ' + formatCurrency(acrescimo)]);
    linhasResumo.push(['Total', formatCurrency(row.total)]);
    doc.autoTable(Object.assign(estiloTabela(y), {
        body: linhasResumo,
        columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } }
    }));
    y = doc.lastAutoTable.finalY + 8;

    y = tituloSecao(doc, y, 'Pagamentos');
    const linhasPag = row.payments.map(payment => [
        salePaymentMethodLabel(saleValue(payment, 'payment_method', 'paymentMethod')),
        formatCurrency(Number(payment.amount) || 0)
    ]);
    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Forma', 'Valor']],
        body: linhasPag.length ? linhasPag : [[{
            content: 'Nenhum pagamento registrado.', colSpan: 2,
            styles: { halign: 'center', textColor: PDF_CINZA }
        }]],
        columnStyles: { 1: { halign: 'right' } }
    }));
    pdfRodape(doc);
    return doc;
}

/* Acha a venda no histórico já montado e, se não estiver lá, remonta.

   `salesHistoryCache` só é reconstruído quando a aba Vendas é desenhada. O
   recibo passou a ser oferecido logo depois de finalizar a venda, e quem
   fecha uma venda pelo Dashboard nunca passou por aquela aba: a venda existe
   em `data.sales`, mas ainda não no cache. Sem esta remontagem o pop-up
   abriria e os dois botões não fariam nada. */
function linhaDaVendaParaRecibo(saleKey) {
    let row = salesHistoryCache.find(item => item.key === saleKey);
    if (row || typeof buildSalesHistory !== 'function') return row;

    salesHistoryCache = buildSalesHistory();
    return salesHistoryCache.find(item => item.key === saleKey);
}

// Ver/imprimir: abre o PDF numa aba nova. O próprio visualizador do
// navegador já tem os botões de imprimir e salvar — duplicá-los aqui só
// daria mais um jeito de a barbearia gerar dois arquivos diferentes do
// mesmo recibo.
window.gerarReciboVenda = async function (saleKey) {
    const row = linhaDaVendaParaRecibo(saleKey);
    if (!row) return;
    // No projeto de origem isto era `garantirPDF()`, que baixava o jsPDF sob
    // demanda. O sistema carrega as bibliotecas com <script defer> no
    // index.html e checa com `pdfDisponivel()`, que já avisa por toast quando
    // ainda estão carregando — usar a função da casa evita duas maneiras
    // diferentes de resolver o mesmo problema no mesmo app.
    if (!pdfDisponivel()) return;

    const doc = montarReciboVenda(row);
    window.open(doc.output('bloburl'), '_blank');
};

function resumoReciboTexto(row) {
    const linhas = [
        `*Recibo — ${nomeDoSalao()}*`,
        `Venda #${row.number} · ${saleDateTimeLabel(row)}`
    ];
    if (row.clientName) linhas.push(`Cliente: ${row.clientName}`);
    linhas.push('');

    row.items.forEach(item => {
        const qtd = Number(item.quantity) || 0;
        const liquido = Number(saleValue(item, 'net_amount', 'netAmount')) || 0;
        linhas.push(`${qtd}x ${saleValue(item, 'item_name', 'itemName') || 'Item'} — ${formatCurrency(liquido)}`);
    });

    linhas.push('', `Total: ${formatCurrency(row.total)}`);
    if (row.payments.length) {
        const formas = [...new Set(row.payments.map(payment =>
            salePaymentMethodLabel(saleValue(payment, 'payment_method', 'paymentMethod'))
        ))].join(', ');
        linhas.push(`Pagamento: ${formas}`);
    }
    linhas.push('', 'Obrigado pela preferência!');

    return linhas.join('\n');
}

// Sem telefone do cliente, abre o seletor de contato do próprio WhatsApp em
// vez de travar o botão — mesmo recurso já usado para compartilhar o link de
// agendamento (11-agendamento-publico.js).
window.enviarReciboPorWhatsApp = function (saleKey) {
    const row = linhaDaVendaParaRecibo(saleKey);
    if (!row) return;

    const texto = encodeURIComponent(resumoReciboTexto(row));
    const cliente = (data.clients || []).find(c => c.id === row.clientId);
    const url = cliente && cliente.phone
        ? `https://wa.me/55${String(cliente.phone).replace(/\D/g, '')}?text=${texto}`
        : `https://wa.me/?text=${texto}`;
    window.open(url, '_blank');
};
