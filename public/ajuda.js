/**
 * ==========================================================================
 * GUIA RÁPIDO (AJUDA)
 *
 * O "Desenvolvido por Lexion" do rodapé abre isto: os primeiros passos de
 *    quem acabou de receber o sistema e as perguntas que aparecem depois.
 *
 *    ⚠️ O CONTEÚDO É DADO, não HTML espalhado pela tela. Está tudo nas duas
 *    listas abaixo, em português comum. Ao montar um cliente novo, é aqui que
 *    se corta o que ele não usa — sem mexer em marcação nenhuma.
 *
 *    Escrito para quem está no balcão, não para quem programa: nada de
 *    "registro", "entidade" ou nome de tela que o usuário nunca viu.
 *
 * Carregado por <script> em index.html, DEPOIS de app.js. Tudo compartilha o
 * mesmo escopo global — nao ha modulos nem build.
 * ==========================================================================
 */

/* Ordem de montagem de uma barbearia nova. É uma sequência de verdade: serviço sem
   duração não monta grade, e grade sem horário de funcionamento não abre o
   link. Por isso são passos numerados, e não mais um bloco de perguntas. */
const PRIMEIROS_PASSOS = [
    {
        titulo: 'Cadastre o estabelecimento',
        onde: 'Configurações → Dados do Estabelecimento',
        texto: 'Nome, endereço, telefone e a logo. Aqui também fica o <strong>horário de funcionamento</strong> de cada dia da semana — é ele que decide quais horários o cliente enxerga no link.'
    },
    {
        titulo: 'Cadastre os serviços',
        onde: 'Configurações → Serviços Oferecidos',
        texto: 'Preço e <strong>duração em minutos</strong>. A duração é o que monta a grade: um corte de 40 minutos ocupa 40 minutos da agenda, e o horário seguinte só aparece depois disso.'
    },
    {
        titulo: 'Cadastre a equipe',
        onde: 'Configurações → Profissionais',
        texto: 'Foto e percentual de comissão. Quem estiver marcado como inativo some do link de agendamento e da agenda, sem perder o histórico.'
    },
    {
        titulo: 'Cadastre o que você vende',
        onde: 'Estoque → Produto',
        texto: 'Bebida da geladeira, pomada, shampoo. Informe a quantidade que tem hoje e a partir de quanto quer ser avisado para repor.'
    },
    {
        titulo: 'Abra o caixa no começo do dia',
        onde: 'Financeiro → Abrir Caixa',
        texto: 'Informe o troco inicial. Recebimento em dinheiro com o caixa fechado entra como <strong>pendente</strong>, para o saldo em gaveta não mentir.'
    },
    {
        titulo: 'Divulgue seu link',
        onde: 'Menu → Link de Agendamento',
        texto: 'Copie e cole na bio do Instagram e no WhatsApp. O cliente agenda sozinho, sem criar conta, e o horário cai na sua agenda na hora.'
    }
];

/* As perguntas que o balcão faz de verdade. Agrupadas pelo assunto, não pela
   tela: quem tem a dúvida ainda não sabe em que tela ela mora. */
const DUVIDAS_FREQUENTES = [
    {
        area: 'Agenda e atendimento',
        icone: 'fa-calendar-days',
        itens: [
            {
                p: 'Chegou um cliente sem hora marcada. O que faço?',
                r: 'Clique em <strong>Chegou agora</strong>, no topo da tela ou na Agenda. Você digita o nome e o WhatsApp, e o sistema encaixa a pessoa no primeiro horário livre, escolhendo sozinho o profissional que libera mais cedo. Ninguém precisa decidir nada com o cliente esperando em pé.'
            },
            {
                p: 'Como o cliente acompanha quando chega a vez dele?',
                r: 'Pelo mesmo link da barbearia. Ele abre, informa o WhatsApp e vê a posição dele. A tela <strong>não mostra o nome nem o telefone de mais ninguém</strong> — só horário e situação — porque a página é pública.'
            },
            {
                p: 'A fila não anda. Por quê?',
                r: 'Quem faz a fila andar é o profissional. O card do atendimento tem um botão só, que vai de <em>aguardando</em> para <em>em atendimento</em> e depois <em>concluído</em>. Enquanto ninguém aperta, a fila fica parada para o cliente.'
            },
            {
                p: 'O cliente não apareceu. O que marco?',
                r: 'Abra o atendimento e mude a situação para <strong>Faltou</strong>. Ele sai das contas de faturamento e de comissão, e para de aparecer como pagamento pendente.'
            },
            {
                p: 'Um horário livre não aparece no link do cliente. Por quê?',
                r: 'São três motivos, nesta ordem: a barbearia está fechada nesse dia ou nesse horário; o profissional marcou indisponibilidade; ou o horário está perto demais de agora — o link só oferece horários com <strong>2 horas de antecedência</strong>, porque o cliente ainda precisa se deslocar. No balcão essa regra não vale: o "Chegou agora" oferece o horário de já.'
            },
            {
                p: 'Posso marcar fora do horário de funcionamento?',
                r: 'Pode. Pelo painel o sistema <strong>avisa e salva assim mesmo</strong> — atender um cliente antigo depois de fechar é decisão sua. No link público a regra é dura, porque lá quem escolhe é o cliente, sem ninguém para autorizar.'
            }
        ]
    },
    {
        area: 'Dinheiro e caixa',
        icone: 'fa-wallet',
        itens: [
            {
                p: 'Onde confirmo que o cliente pagou?',
                r: 'No card do atendimento, ou pelo painel <strong>Confirmar Pagamentos</strong> do Dashboard, que lista quem já foi atendido e ainda não foi lançado. Confirmar o pagamento é o que faz o atendimento entrar no faturamento e gerar comissão.'
            },
            {
                p: 'Recebi em dinheiro e o lançamento ficou "pendente".',
                r: 'O caixa está fechado. Dinheiro só entra na gaveta com caixa aberto — senão o saldo do dia mostraria um valor que não está lá. Abra o caixa em <strong>Financeiro → Abrir Caixa</strong> e o lançamento passa a contar.'
            },
            {
                p: 'Como lanço uma despesa (aluguel, conta de luz, material)?',
                r: 'Em <strong>Financeiro → + Saída</strong>. Escolha a categoria, o valor e a forma de pagamento. Saída em dinheiro também depende do caixa aberto.'
            },
            {
                p: 'A comissão do profissional considera o produto vendido?',
                r: 'Não. <strong>A comissão sai só do serviço.</strong> O produto entra no caixa como um lançamento separado e aparece atribuído a quem vendeu, mas fora da conta da comissão.'
            },
            {
                p: 'Confirmei hoje o pagamento de um atendimento de ontem. Em que dia ele conta?',
                r: 'Nos dois, cada um no seu lugar. O <strong>faturamento</strong> conta em ontem, que é o dia do atendimento. O <strong>dinheiro na gaveta</strong> conta hoje, que é quando ele entrou. É por isso que o extrato do dia e o extrato do período podem mostrar números diferentes — e os dois estão certos.'
            },
            {
                p: 'Não consigo fechar o caixa.',
                r: 'Existe atendimento já realizado e sem pagamento lançado. O sistema mostra quais são. Confirme, marque como cortesia ou como falta — fechar caixa por cima de pendência é como o dia "some" do faturamento.'
            }
        ]
    },
    {
        area: 'Produtos e estoque',
        icone: 'fa-boxes-stacked',
        itens: [
            {
                p: 'Como registro a venda de um produto?',
                r: 'Por três caminhos, e todos dão no mesmo lugar:<br>• <strong>Na hora de pagar o corte</strong> — em Confirmar Pagamento, no campo "Levou algum produto?". É onde a venda costuma acontecer de verdade.<br>• <strong>Estoque → Saída → Venda</strong> — para quem entrou só para comprar.<br>• <strong>Financeiro → + Entrada → Venda de Produto</strong> — quando você já está lançando dinheiro.'
            },
            {
                p: 'Chegou mercadoria do fornecedor. Onde lanço?',
                r: 'Em <strong>Estoque → Entrada</strong>, com o motivo "Compra / reposição". Informe o <strong>custo</strong> que você pagou, não o preço de venda. Marcando "lançar no Financeiro", vira uma despesa automaticamente.'
            },
            {
                p: 'O estoque do sistema não bate com a prateleira.',
                r: 'Use <strong>Entrada</strong> ou <strong>Saída</strong> com o motivo <strong>"Acerto de inventário"</strong>. Não existe um campo para digitar o número certo por cima, de propósito: assim toda diferença fica registrada com data e motivo, e você consegue enxergar de onde vem a perda.'
            },
            {
                p: 'Quebrou, venceu ou usei no atendimento. Como registro?',
                r: 'Em <strong>Estoque → Saída</strong>, com o motivo "Perda / quebra / vencido" ou "Uso interno". Baixa do estoque e <strong>não mexe no caixa</strong> — não houve venda. Mas fica no extrato, que é como você descobre quanto está indo embora por mês.'
            },
            {
                p: 'O cliente vê quantos produtos eu tenho?',
                r: 'Não. A vitrine do link mostra nome, categoria e preço — <strong>nunca a quantidade</strong>, que é informação sua. Produto que zera simplesmente some da vitrine, para ninguém pedir o que acabou.'
            },
            {
                p: 'Para que serve o "Avisar abaixo de"?',
                r: 'É o ponto de repor. Quando a quantidade chega nele, o item aparece no aviso do Dashboard e no número ao lado de "Estoque" no menu. Deixe em <strong>0</strong> para desligar o aviso daquele item.'
            },
            {
                p: 'Como sei quem levou cada produto?',
                r: 'Pelo campo <strong>"Quem comprou"</strong>, que aparece na venda — tanto em Estoque → Saída quanto no Financeiro. Ele é opcional, mas quando preenchido o nome do cliente fica na linha do extrato, junto com a data e o motivo. O que saiu na hora de pagar o corte já vem marcado como <strong>"no atendimento"</strong>, sem ninguém precisar digitar.'
            }
        ]
    },
    {
        area: 'Link de agendamento',
        icone: 'fa-share-nodes',
        itens: [
            {
                p: 'Onde encontro o meu link?',
                r: 'No menu, em <strong>Link de Agendamento</strong>. Ali tem o botão de copiar e a mensagem pronta para mandar no WhatsApp.'
            },
            {
                p: 'O cliente diz que o link não abre ou não tem horário.',
                r: 'Confira, nesta ordem: o <strong>horário de funcionamento</strong> do dia está marcado como aberto; existe pelo menos um serviço <strong>ativo</strong>; e existe pelo menos um profissional <strong>ativo</strong>. Faltando qualquer um dos três, a grade fica vazia.'
            },
            {
                p: 'Posso mudar o texto da mensagem de WhatsApp?',
                r: 'Sim, em <strong>Configurações → Dados do Estabelecimento</strong>, no campo "Mensagem Padrão de Agendamento".'
            }
        ]
    },
    {
        area: 'Acesso e senha',
        icone: 'fa-user-lock',
        itens: [
            {
                p: 'Esqueci minha senha.',
                r: 'Na tela de entrada, clique em <strong>"Esqueceu a senha?"</strong> e informe o e-mail do cadastro. Chega um link para criar uma senha nova.'
            },
            {
                p: 'Quero que cada profissional tenha o próprio acesso.',
                r: 'Dá para fazer: cada um entra com o próprio e-mail e enxerga a agenda e a comissão dele, sem acesso às configurações do estabelecimento. A criação desses acessos é feita pela Lexion — chame a gente.'
            },
            {
                p: 'Meus dados ficam salvos onde?',
                r: 'Na nuvem, separados por estabelecimento — nenhuma barbearia enxerga o dado de outra. O aparelho também guarda uma cópia do que já foi carregado, para o sistema continuar mostrando a agenda se a internet cair no meio do expediente.'
            }
        ]
    }
];

/* --- Tela ---------------------------------------------------------------- */

/* A busca olha o texto INTEIRO, não só o título. Quem procura "troco" ou
   "cerveja" não usa a mesma palavra do cabeçalho, e devolver "nada encontrado"
   nesse caso faz a pessoa concluir que o sistema não faz aquilo. */
function textoDaBusca(pedaco) {
    return pedaco.toLowerCase().replace(/<[^>]+>/g, ' ');
}

// Guarda o número original: filtrado ou não, o passo 5 continua sendo o 5.
function passosQueCombinam(busca) {
    return PRIMEIROS_PASSOS
        .map((passo, i) => ({ passo: passo, num: i + 1 }))
        .filter(({ passo }) => !busca ||
            textoDaBusca(passo.titulo + ' ' + passo.onde + ' ' + passo.texto).includes(busca));
}

function htmlDosPrimeirosPassos(lista) {
    return lista.map(({ passo, num }) => `
        <div class="ajuda-passo">
            <span class="ajuda-passo-num">${num}</span>
            <div>
                <strong class="ajuda-passo-titulo">${escapeHTML(passo.titulo)}</strong>
                <span class="ajuda-passo-onde">${escapeHTML(passo.onde)}</span>
                <p class="ajuda-passo-texto">${passo.texto}</p>
            </div>
        </div>`).join('');
}

function duvidasQueCombinam(busca) {
    return DUVIDAS_FREQUENTES
        .map(g => ({
            g: g,
            itens: g.itens.filter(item => !busca || textoDaBusca(item.p + ' ' + item.r).includes(busca))
        }))
        .filter(x => x.itens.length);
}

function htmlDasDuvidas(grupos, busca) {
    return grupos.map(({ g, itens }) => `
        <section class="ajuda-grupo">
            <h5 class="ajuda-grupo-titulo">
                <i class="fa-solid ${escapeHTML(g.icone)}"></i> ${escapeHTML(g.area)}
            </h5>
            ${itens.map(item => `
                <details class="ajuda-item"${busca ? ' open' : ''}>
                    <summary>${escapeHTML(item.p)}</summary>
                    <div class="ajuda-resposta">${item.r}</div>
                </details>`).join('')}
        </section>`).join('');
}

function renderAjuda(filtro) {
    const passos = document.getElementById('ajuda-passos');
    const duvidas = document.getElementById('ajuda-duvidas');
    if (!passos || !duvidas) return;

    const busca = (filtro || '').trim().toLowerCase();
    const passosVisiveis = passosQueCombinam(busca);
    const grupos = duvidasQueCombinam(busca);

    // A busca vale para o guia inteiro, passos incluídos. Sem isso, procurar
    // uma palavra que só existe nos primeiros passos devolvia "nada
    // encontrado" — a resposta estava ali, escondida pelo próprio filtro.
    const secaoPassos = document.getElementById('ajuda-secao-passos');
    secaoPassos.style.display = passosVisiveis.length ? '' : 'none';
    passos.innerHTML = htmlDosPrimeirosPassos(passosVisiveis);

    // A ordem só é uma instrução quando a lista está inteira.
    document.getElementById('ajuda-passos-descricao').style.display = busca ? 'none' : '';

    if (!passosVisiveis.length && !grupos.length) {
        duvidas.innerHTML = `
            <p class="ajuda-vazio">
                Nada encontrado para <strong>${escapeHTML(filtro)}</strong>.
                Chame o suporte no WhatsApp logo abaixo — se a dúvida chegou até
                aqui, ela merece virar uma resposta nesta lista.
            </p>`;
        return;
    }

    duvidas.innerHTML = htmlDasDuvidas(grupos, busca);
}

window.abrirAjuda = function () {
    const busca = document.getElementById('ajuda-busca');
    if (busca) busca.value = '';
    renderAjuda('');
    openModal('modal-ajuda');
    // Fecha a gaveta do celular: o guia abriu por cima dela e, ao sair, a
    // pessoa voltaria para o menu aberto em vez da tela em que estava.
    document.getElementById('sidebar')?.classList.remove('show');
};

document.getElementById('btn-abrir-ajuda')?.addEventListener('click', abrirAjuda);
document.getElementById('ajuda-busca')?.addEventListener('input', function () {
    renderAjuda(this.value);
});
