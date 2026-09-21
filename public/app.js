/**
 * ==========================================================================
 * LEXION APP CORE LOGIC
 * ==========================================================================
 */

// --- CONFIG & STATE INITIALIZATION ---
const STATE_KEYS = {
    SERVICES: 'lexion_services',
    PROFESSIONALS: 'lexion_professionals',
    CLIENTS: 'lexion_clients',
    APPOINTMENTS: 'lexion_appointments',
    LEADS: 'lexion_leads',
    TRANSACTIONS: 'lexion_transactions',
    BUSINESS_INFO: 'lexion_business_info',
    AUTOMATION_RULES: 'lexion_automation_rules',
    MESSAGE_JOBS: 'lexion_message_jobs',
    CASH_REGISTERS: 'lexion_cash_registers',
    PROFESSIONAL_BLOCKS: 'lexion_professional_blocks',
    PRODUCTS: 'lexion_products',
    STOCK_MOVEMENTS: 'lexion_stock_movements',
    // Evolução de Vendas (docs/14 a 28). Mesmos nomes do projeto de origem,
    // de propósito: o cache local é lido e escrito pelos módulos portados.
    SALES: 'lexion_sales',
    SALE_ITEMS: 'lexion_sale_items',
    SALE_PAYMENTS: 'lexion_sale_payments',
    SALE_COMMISSIONS: 'lexion_sale_commissions',
    RECEIVABLES: 'lexion_receivables',
    RECEIVABLE_INSTALLMENTS: 'lexion_receivable_installments',
    RECEIVABLE_PAYMENTS: 'lexion_receivable_payments',
    LOYALTY_PROGRAMS: 'lexion_loyalty_programs',
    LOYALTY_MOVEMENTS: 'lexion_loyalty_movements',
    SALON_MEMBERS: 'lexion_salon_members'
};

// Logomarca exibida enquanto o salão não envia a sua nas Configurações.
const LOGO_PADRAO = '/assets/logo_lexion.png';

// Versão exibida no rodapé do login.
const VERSAO_DO_SISTEMA = '2.0.0';

let currentSelectedDate = new Date();

function seedDefaultAutomationRules() {
    if (!localStorage.getItem(STATE_KEYS.AUTOMATION_RULES)) {
        localStorage.setItem(STATE_KEYS.AUTOMATION_RULES, JSON.stringify([
            { id: 'rule-confirm', name: 'Confirmar agendamento', description: '24 horas antes', icon: 'fa-circle-check', enabled: true },
            { id: 'rule-reminder', name: 'Lembrete final', description: '2 horas antes', icon: 'fa-clock', enabled: true },
            { id: 'rule-followup', name: 'Pós-atendimento', description: '2 horas depois', icon: 'fa-star', enabled: true }
        ]));
    }
}

// Global data objects loaded from localStorage
let data = {
    services: [],
    professionals: [],
    clients: [],
    appointments: [],
    leads: [],
    transactions: [],
    businessInfo: {},
    automationRules: [],
    messageJobs: [],
    cashRegisters: [],
    professionalBlocks: [],
    products: [],
    stockMovements: [],
    sales: [],
    saleItems: [],
    salePayments: [],
    saleCommissions: [],
    receivables: [],
    receivableInstallments: [],
    receivablePayments: [],
    loyaltyPrograms: [],
    loyaltyMovements: [],
    // Quem tem login neste salão (docs/28). Não guarda e-mail nem senha: só o
    // vínculo login → profissional, que é o que traduz o `sold_by` de uma venda
    // para um nome na tela.
    salonMembers: [],
    // False somente quando o login existe MAS a migração não foi aplicada. A
    // aba continua abrindo e avisa o passo que falta, sem derrubar o resto do
    // app. Todas começam `true` porque o banco do SaaS já tem os scripts
    // 14 a 28 aplicados — quem corrige isso é o loadAll.
    salesSchemaReady: true,
    commissionsSchemaReady: true,
    creditSchemaReady: true,
    loyaltySchemaReady: true,
    // Este tem consequência diferente dos outros: mandar uma coluna que não
    // existe faz o Supabase RECUSAR o upsert inteiro, e o dono perderia o
    // cadastro do profissional ao salvar. Por isso `professionals.email` só
    // entra no payload quando a coluna existe de verdade.
    accessSchemaReady: true
};

// Quando foi a última vez que o cadastro (profissionais, produtos, dados do
// estabelecimento) veio da nuvem. É por esta marca que o ciclo automático
// decide, de tempos em tempos, pedir a carga completa de novo.
let ultimaCargaCompleta = 0;

async function loadData(escopo = 'completo') {
    const loaded = await DataService.loadAll(STATE_KEYS, { escopo: escopo });
    data.services = sanitizeForStorage(loaded.services);
    data.clients = sanitizeForStorage(loaded.clients);
    data.appointments = sanitizeForStorage(loaded.appointments);
    data.leads = sanitizeForStorage(loaded.leads);
    data.transactions = sanitizeForStorage(loaded.transactions);
    data.cashRegisters = sanitizeForStorage(loaded.cashRegisters) || [];
    data.professionalBlocks = sanitizeForStorage(loaded.professionalBlocks) || [];
    data.stockMovements = sanitizeForStorage(loaded.stockMovements) || [];
    data.sales = sanitizeForStorage(loaded.sales) || [];
    data.saleItems = sanitizeForStorage(loaded.saleItems) || [];
    data.salePayments = sanitizeForStorage(loaded.salePayments) || [];
    data.saleCommissions = sanitizeForStorage(loaded.saleCommissions) || [];
    data.salesSchemaReady = loaded.salesSchemaReady !== false;
    data.commissionsSchemaReady = loaded.commissionsSchemaReady !== false;
    data.receivables = sanitizeForStorage(loaded.receivables) || [];
    data.receivableInstallments = sanitizeForStorage(loaded.receivableInstallments) || [];
    data.receivablePayments = sanitizeForStorage(loaded.receivablePayments) || [];
    data.creditSchemaReady = loaded.creditSchemaReady !== false;
    data.loyaltyPrograms = sanitizeForStorage(loaded.loyaltyPrograms) || [];
    data.loyaltyMovements = sanitizeForStorage(loaded.loyaltyMovements) || [];
    data.loyaltySchemaReady = loaded.loyaltySchemaReady !== false;
    data.salonMembers = sanitizeForStorage(loaded.salonMembers) || [];

    /* --- O CADASTRO QUE O CICLO NÃO PEDE -----------------------------------
       `undefined` aqui NÃO quer dizer "está vazio": quer dizer "não foi
       perguntado nesta volta" (ver o aviso no retorno de loadAll, em api.js).
       Atribuir mesmo assim apagaria da tela o que a nuvem nem foi consultada
       sobre — e como refreshCloudData engole a exceção, o estrago apareceria
       como agenda sem barbeiro e checkout sem produto, sem erro nenhum.
       Nunca troque estes `if` por `|| []`. */
    if (loaded.professionals !== undefined) {
        data.professionals = sanitizeForStorage(loaded.professionals) || [];
        // Sem a migração 28 a coluna não vem na resposta do Supabase. Com a
        // lista vazia não dá para concluir nada, e o padrão é "existe": o banco
        // do SaaS já rodou o 28. Mora junto com `professionals` porque lê
        // `professionals[0]` — solto, estouraria na volta em que ela não veio.
        data.accessSchemaReady = !data.professionals.length || 'email' in data.professionals[0];
    }
    if (loaded.products !== undefined) {
        data.products = sanitizeForStorage(loaded.products) || [];
    }
    if (loaded.businessInfo !== undefined) {
        data.businessInfo = sanitizeForStorage(loaded.businessInfo) || {};
        // Campos que existem apenas no localStorage (não têm coluna no Supabase)
        const localBiz = JSON.parse(localStorage.getItem(STATE_KEYS.BUSINESS_INFO) || '{}');
        if (!data.businessInfo.whatsappBookingMessage && localBiz.whatsappBookingMessage) {
            data.businessInfo.whatsappBookingMessage = localBiz.whatsappBookingMessage;
        }

        // Aplica o tema dinâmico e os controles de planos SaaS
        if (window.ThemeManager) {
            window.ThemeManager.applyTheme(data.businessInfo);
        }
        if (window.SaaSPlanManager) {
            window.SaaSPlanManager.init(data.businessInfo);
        }
    }

    // Fica aqui, e não no refreshCloudData, para que as recargas do crediário,
    // da fidelidade também adiem o próximo cadastro: elas já
    // trouxeram tudo.
    if (escopo === 'completo') ultimaCargaCompleta = Date.now();
    data.automationRules = sanitizeForStorage(loaded.automationRules);
    data.messageJobs = sanitizeForStorage(loaded.messageJobs);

    // Os avisos do sino e os dias restantes de teste saem destes mesmos dados;
    // sem isto a barra continuaria mostrando o retrato da carga anterior.
    if (typeof atualizarBarraSuperior === 'function') atualizarBarraSuperior();
}

function saveData(key, value) {
    const sanitizedValue = sanitizeForStorage(value);
    replaceInPlace(value, sanitizedValue);
    DataService.save(key, sanitizedValue).catch(console.error);
    // Como a variável global 'data' já foi modificada antes de chamar saveData,
    // não precisamos bloquear a UI para redesenhar.
}

// --- UTILITY FUNCTIONS ---
function formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function formatDateDisplay(date) {
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    let formatted = date.toLocaleDateString('pt-BR', options);
    // Capitalize first letter
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function getLocalDateString(date) {
    // Returns YYYY-MM-DD
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function timeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function sanitizePlainText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .normalize('NFC')
        .replace(/[<>]/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeSlug(value) {
    return sanitizePlainText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function sanitizeForStorage(value) {
    if (Array.isArray(value)) return value.map(item => sanitizeForStorage(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeForStorage(entry)]));
    }
    if (typeof value === 'string') return sanitizePlainText(value);
    return value;
}

function replaceInPlace(target, source) {
    if (!target || typeof target !== 'object') return;
    if (Array.isArray(target) && Array.isArray(source)) {
        target.splice(0, target.length, ...source);
        return;
    }
    if (!Array.isArray(target) && source && typeof source === 'object' && !Array.isArray(source)) {
        Object.keys(target).forEach(key => delete target[key]);
        Object.assign(target, source);
    }
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

/* --- PAGINAÇÃO DAS TABELAS LONGAS -----------------------------------------

   Clientes, lançamentos do Financeiro e o clube de Fidelidade desenhavam a
   lista inteira de uma vez. Com mil clientes são mil linhas montadas no DOM a
   cada redesenho — e o redesenho acontece sozinho, a cada volta do ciclo
   automático. É o que faz o celular do balcão engasgar ao abrir a aba.

   Isto NÃO muda o que vem da nuvem: os dados já chegaram inteiros. Muda quanto
   o navegador precisa desenhar por vez. */
const LINHAS_POR_PAGINA = 20;
const paginaDaTabela = {};

// Quem redesenha cada tabela, pelo NOME da função: os botões são recriados a
// cada volta, e guardar a referência aqui amarraria este arquivo ao
// fidelidade.js, que só carrega depois.
const REDESENHA_TABELA = {
    clientes: 'renderClients',
    financeiro: 'renderFinance',
    fidelidade: 'renderTabelaDeFidelidade'
};

/* Filtro novo, busca nova: volta para a primeira página. Continuar na página 7
   de uma lista que encolheu para duas mostraria uma tabela vazia — e quem está
   no balcão concluiria que o cliente sumiu do sistema. */
function voltarAPrimeiraPagina(chave) {
    paginaDaTabela[chave] = 1;
}

// Só as linhas da página atual, corrigindo a página quando a lista encolheu
// por baixo dela.
function fatiaDaPagina(chave, linhas) {
    const totalPaginas = Math.max(1, Math.ceil(linhas.length / LINHAS_POR_PAGINA));
    const pagina = Math.min(paginaDaTabela[chave] || 1, totalPaginas);
    paginaDaTabela[chave] = pagina;
    const inicio = (pagina - 1) * LINHAS_POR_PAGINA;
    return linhas.slice(inicio, inicio + LINHAS_POR_PAGINA);
}

function renderPaginacao(elementoId, chave, totalDeLinhas) {
    const alvo = document.getElementById(elementoId);
    if (!alvo) return;

    const totalPaginas = Math.max(1, Math.ceil(totalDeLinhas / LINHAS_POR_PAGINA));
    // Cabendo tudo numa página, os controles somem em vez de ficarem
    // desabilitados: numa lista curta eles só ocupariam a tela do celular.
    if (totalPaginas <= 1) {
        alvo.innerHTML = '';
        alvo.hidden = true;
        return;
    }

    const pagina = Math.min(paginaDaTabela[chave] || 1, totalPaginas);
    const primeira = (pagina - 1) * LINHAS_POR_PAGINA + 1;
    const ultima = Math.min(pagina * LINHAS_POR_PAGINA, totalDeLinhas);

    alvo.hidden = false;
    alvo.innerHTML = `
        <span class="paginacao-conta">${primeira}–${ultima} de ${totalDeLinhas}</span>
        <div class="paginacao-botoes">
            <button type="button" class="btn btn-secondary btn-sm" ${pagina === 1 ? 'disabled' : ''}
                    data-pagina-chave="${escapeHTML(chave)}" data-pagina-passo="-1">
                <i class="fa-solid fa-chevron-left"></i> Anterior
            </button>
            <span class="paginacao-atual">${pagina} / ${totalPaginas}</span>
            <button type="button" class="btn btn-secondary btn-sm" ${pagina === totalPaginas ? 'disabled' : ''}
                    data-pagina-chave="${escapeHTML(chave)}" data-pagina-passo="1">
                Próxima <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>`;
}

// Delegação no documento: os botões são refeitos a cada redesenho, e um
// listener por botão vazaria um a cada volta do ciclo automático.
document.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-pagina-chave]');
    if (!botao || botao.disabled) return;
    const chave = botao.getAttribute('data-pagina-chave');
    const passo = parseInt(botao.getAttribute('data-pagina-passo'), 10) || 0;
    paginaDaTabela[chave] = Math.max(1, (paginaDaTabela[chave] || 1) + passo);
    const redesenha = window[REDESENHA_TABELA[chave]];
    if (typeof redesenha === 'function') redesenha();
});

// Calculate days between two dates
function daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Dias desde a última visita, contados a partir de agora.
//
// daysBetween usa Math.abs, ou seja, mede distância e não sentido. Para
// "há quantos dias veio" isso é perigoso: uma última visita registrada com
// data futura (acontece ao marcar como concluído um horário de amanhã)
// viraria um número positivo grande e o cliente seria dado como sumido.
// Aqui data futura vale zero — ele acabou de vir, não sumiu.
function diasDesdeAVisita(ultimaVisita) {
    if (!ultimaVisita) return null;
    const visita = new Date(ultimaVisita + 'T12:00:00');
    if (isNaN(visita.getTime())) return null;

    // Os DOIS lados ancorados ao meio-dia. "Há quantos dias veio" é uma conta
    // entre DATAS, não entre instantes: comparando o meio-dia da visita com a
    // hora corrente, uma visita de 40 dias atrás media 39,83 dias às 8 da
    // manhã, e o Math.floor devolvia 39. O sistema contava um dia a menos em
    // toda a base durante a manhã inteira, e voltava ao normal depois do
    // almoço — e o efeito aparecia justamente na fronteira que importa: quem
    // tem frequência de 30 dias e veio há 30 não entrava como "Atrasado" na
    // lista de Clientes nem em "Clientes p/ Retorno" no Dashboard.
    const hoje = new Date();
    hoje.setHours(12, 0, 0, 0);

    if (visita >= hoje) return 0;   // veio hoje, ou tem horário marcado à frente
    // Math.round, e não floor: com os dois lados no meio-dia a divisão já é
    // inteira, mas o horário de verão desloca a diferença em uma hora e o
    // floor transformaria isso em um dia inteiro a menos.
    return Math.round((hoje - visita) / (1000 * 60 * 60 * 24));
}

// Toast Notifications System
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'danger') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${icon}`;
    const textEl = document.createElement('span');
    textEl.textContent = sanitizePlainText(message);
    toast.append(iconEl, textEl);

    container.appendChild(toast);

    // Auto remove toast
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- APP NAVIGATION ---
function initNavigation() {
    const menuItems = document.querySelectorAll('.menu-item');
    const tabItems = document.querySelectorAll('.tab-item');
    const sections = document.querySelectorAll('.page-section');
    const pageTitle = document.getElementById('page-title');

    /* O endereço da aba vive no HASH (#vendas), nunca no caminho — e isso é
       decisão, não limitação. O caminho pertence ao link público, onde
       `/lexion` é o exemplo de slug: com a aba no caminho, quem recebesse o
       link de agendamento poderia trocar o slug por `/configuracoes` e cair na
       tela de login do painel. Atrás do `#`, ninguém tropeça nisso. */
    const ABAS_CONHECIDAS = [...menuItems].map(m => m.getAttribute('data-target')).filter(Boolean);

    function abaDoEndereco() {
        const alvo = decodeURIComponent(String(location.hash || '').replace(/^#\/?/, '')).trim();
        return ABAS_CONHECIDAS.includes(alvo) ? alvo : '';
    }

    function switchTab(target) {
        if (typeof DataService !== 'undefined' && DataService.ehBarbeiro && DataService.ehBarbeiro()) {
            if (typeof ABAS_SO_DO_DONO !== 'undefined' && ABAS_SO_DO_DONO.includes(target)) {
                target = 'agenda';
            }
        }

        // Abrir Estoque ou Configurações é justamente quando o cadastro
        // importa. Zerar a marca não pede nada agora: faz a próxima volta do
        // ciclo vir completa, e o cadastro chega sem custo extra.
        if (target === 'estoque' || target === 'configuracoes') ultimaCargaCompleta = 0;

        // Update active sidebar item
        menuItems.forEach(m => {
            if (m.getAttribute('data-target') === target) m.classList.add('active');
            else m.classList.remove('active');
        });

        // Update active mobile tab bar item
        tabItems.forEach(t => {
            if (t.getAttribute('data-target') === target) t.classList.add('active');
            else t.classList.remove('active');
        });

        // Show active section
        sections.forEach(sec => sec.classList.remove('active'));
        const activeSection = document.getElementById(`page-${target}`);
        if (activeSection) {
            activeSection.classList.add('active');
        }

        // Update header title
        let titleText = target;
        const menuItem = document.querySelector(`.menu-item[data-target="${target}"]`);
        if (menuItem) {
            titleText = menuItem.querySelector('span').innerText;
        }
        pageTitle.innerText = titleText;

        // Carimba a aba no endereço, para o F5 voltar onde a pessoa estava e
        // o botão "voltar" do navegador andar entre as abas. A comparação
        // evita o vaivém: escrever o hash dispara `hashchange`, que chamaria
        // switchTab de novo.
        if (abaDoEndereco() !== target) location.hash = target;

        // Load section-specific data/rendering
        renderPageData(target);

        // Close mobile sidebar if open
        document.getElementById('sidebar').classList.remove('show');
    }

    // Voltar/avançar do navegador, e link colado com #aba.
    window.addEventListener('hashchange', () => {
        const alvo = abaDoEndereco();
        const atual = document.querySelector('.menu-item.active')?.getAttribute('data-target');
        if (alvo && alvo !== atual) switchTab(alvo);
    });

    // Abre na aba que veio no endereço. Sem hash (ou com um desconhecido),
    // segue no dashboard, que é o que o HTML já marca como ativo.
    const abaInicial = abaDoEndereco();
    if (abaInicial) switchTab(abaInicial);

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('data-target');
            switchTab(target);
        });
    });

    tabItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('data-target');
            switchTab(target);
        });
    });

    // Custom links inside dashboard cards/buttons to switch tabs
    document.body.addEventListener('click', (e) => {
        const clickTabEl = e.target.closest('.click-tab');
        if (clickTabEl) {
            const target = clickTabEl.getAttribute('data-target');
            switchTab(target);
        }
    });

    // Mobile Sidebar Toggles
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const closeBtn = document.getElementById('sidebar-close-btn');
    const sidebar = document.getElementById('sidebar');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => sidebar.classList.add('show'));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => sidebar.classList.remove('show'));
    }
}

function renderPageData(pageId) {
    if (typeof DataService !== 'undefined' && DataService.ehBarbeiro && DataService.ehBarbeiro()) {
        if (typeof ABAS_SO_DO_DONO !== 'undefined' && ABAS_SO_DO_DONO.includes(pageId)) {
            document.querySelector('.menu-item[data-target="agenda"]')?.click();
            return;
        }
    }
    switch (pageId) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'agenda':
            renderAgenda();
            break;
        // As quatro abas da Evolução de Vendas. As funções vivem nos arquivos
        // carregados depois deste (vendas-base.js, comissoes.js, crediario.js,
        // fidelidade.js), e o escopo é o mesmo — não há import.
        case 'vendas':
            renderSales();
            break;
        case 'mensagens':
            renderMessages();
            break;
        case 'clientes':
            renderClients();
            break;
        case 'fidelidade':
            renderFidelidade();
            break;
        case 'leads':
            renderLeadsKanban();
            break;
        case 'estoque':
            renderEstoque();
            break;
        case 'comissoes':
            renderComissoes();
            break;
        case 'crediario':
            renderCrediario();
            break;
        case 'financeiro':
            renderFinance();
            break;
        case 'configuracoes':
            renderConfig();
            break;
    }
}

// --- ATUALIZAÇÃO AUTOMÁTICA ---
// Agendamentos feitos pelo link público entram direto na nuvem; aqui o painel
// busca as novidades sozinho, sem o usuário precisar recarregar a página.
// Abas de formulário (Configurações/Simulador) não são redesenhadas para não
// apagar o que o usuário estiver digitando.
//
// O CUSTO DE CADA VOLTA. Não há filtro de data ainda: cada ciclo baixa as
// tabelas inteiras, e o plano gratuito do Supabase dá 5 GB de saída por mês.
// A 30 segundos, e carregando as três tabelas de foto, uma única tela aberta o
// dia todo consumia a cota sozinha antes do fim do mês. Antes de baixar este
// número de novo, MEÇA: DevTools > Network, filtro `rest/v1`, seis minutos.
const AUTO_REFRESH_TABS = ['dashboard', 'agenda', 'mensagens', 'clientes', 'leads', 'estoque', 'financeiro'];
const INTERVALO_CICLO = 120000;               // 2 min, salão aberto
const INTERVALO_FORA_DO_EXPEDIENTE = 600000;  // 10 min, salão fechado
const INTERVALO_CADASTRO = 1200000;           // 20 min: a volta vem completa

/* Fora do expediente ninguém está no balcão e o link público manda pouco, mas
   a tela costuma ficar ligada: sem este freio, uma madrugada inteira gasta
   tanto quanto um dia de trabalho. Quem voltar para a tela dispara o `focus` e
   atualiza na hora, então nada fica velho na mão de ninguém. Meia hora de
   folga nas duas pontas, para quem abre a loja já encontrar a tela viva. */
function intervaloDoCiclo() {
    const funcionamento = typeof funcionamentoDoDia === 'function'
        ? funcionamentoDoDia(getLocalDateString(new Date())) : null;
    if (!funcionamento) return INTERVALO_CICLO;
    if (!funcionamento.aberto) return INTERVALO_FORA_DO_EXPEDIENTE;

    const agora = new Date();
    const minutos = agora.getHours() * 60 + agora.getMinutes();
    const abre = minutosDoHorario(funcionamento.abre);
    const fecha = minutosDoHorario(funcionamento.fecha);
    // Horário inválido no cadastro devolve null: na dúvida, ritmo normal.
    if (abre === null || fecha === null) return INTERVALO_CICLO;
    return (minutos >= abre - 30 && minutos <= fecha + 30)
        ? INTERVALO_CICLO
        : INTERVALO_FORA_DO_EXPEDIENTE;
}

let cloudRefreshBusy = false;
let ultimoRefresh = 0;
async function refreshCloudData(opcoes) {
    if (!DataService.isSupabaseConfigured() || !DataService.isAuthenticated()) return;
    if (cloudRefreshBusy || document.hidden) return;
    if (document.querySelector('.modal.show')) return; // não interrompe quem está com um cadastro aberto
    cloudRefreshBusy = true;
    try {
        // De 20 em 20 minutos a volta vem completa: é o que traz o profissional
        // editado no celular do dono, o produto cadastrado em outro login e a
        // foto trocada em outro aparelho. No resto do tempo, cadastro não
        // trafega. Quem chega pela volta à aba (`focus`) pede completa sempre.
        const venceu = Date.now() - ultimaCargaCompleta >= INTERVALO_CADASTRO;
        const completo = (opcoes && opcoes.completo === true) || venceu;
        await loadData(completo ? 'completo' : 'ciclo');
        ultimoRefresh = Date.now();
        const activeTab = document.querySelector('.menu-item.active')?.getAttribute('data-target') || 'dashboard';
        if (AUTO_REFRESH_TABS.includes(activeTab)) renderPageData(activeTab);
    } catch (err) {
        console.error('Erro na atualização automática:', err);
    } finally {
        cloudRefreshBusy = false;
    }
}

setInterval(() => {
    if (Date.now() - ultimoRefresh >= intervaloDoCiclo()) refreshCloudData();
}, INTERVALO_CICLO);
// Arrow function, e não a referência nua da função: `addEventListener` entrega
// o Event como primeiro argumento, e ele cairia no lugar das opções.
window.addEventListener('focus', () => refreshCloudData({ completo: true }));
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCloudData({ completo: true });
});

// --- MODAL ENGINE ---
function initModals() {
    // Select all close triggers
    const closeButtons = document.querySelectorAll('[data-close-modal]');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-close-modal');
            closeModal(modalId);
        });
    });

    // Backdrop click closures
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(bd => {
        bd.addEventListener('click', (e) => {
            if (e.target === bd) {
                closeModal(bd.id);
            }
        });
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';

        // Reset form if modal contains one
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
            const hiddenId = form.querySelector('input[type="hidden"]');
            if (hiddenId) hiddenId.value = '';

            // Hide delete buttons by default in edit forms
            const delBtn = form.querySelector('.btn-danger');
            if (delBtn) delBtn.style.display = 'none';
        }
    }
}

// --- 1. DASHBOARD COMPONENT ---
function renderDashboard() {
    // Estoque no mínimo: o painel que o dono abre primeiro no dia e o mesmo
    // número no menu lateral, para quem está em outra tela.
    if (typeof renderAlertaDeEstoque === 'function') renderAlertaDeEstoque();

    const todayStr = getLocalDateString(currentSelectedDate); // '2026-07-08'
    const todayAppts = data.appointments.filter(a => a.date === todayStr && a.status !== 'cancelled');

    // 1. Calculate values
    let revenueExpected = 0;
    let revenueReceived = 0;
    let totalDoneOrConfirmed = 0;

    todayAppts.forEach(appt => {
        const service = data.services.find(s => s.id === appt.serviceId);
        const price = service ? service.price : 0;

        revenueExpected += price;
        if (appt.paymentStatus === 'paid') {
            revenueReceived += price;
        }
        // Tudo que não foi cancelado nem faltou conta como atendimento do dia.
        // Listar os status um a um deixava o 'in_progress' de fora e o número
        // do painel caía quando o barbeiro começava a atender.
        if (appt.status !== 'cancelled' && appt.status !== 'no_show') {
            totalDoneOrConfirmed++;
        }
    });

    // Update Indicators
    document.getElementById('dash-total-appts').innerText = todayAppts.length;
    document.getElementById('dash-expected-revenue').innerText = formatCurrency(revenueExpected);
    document.getElementById('dash-actual-revenue').innerText = formatCurrency(revenueReceived);

    // Clients recall counts
    const recallClients = getRecallClients();
    document.getElementById('dash-recall-count').innerText = recallClients.length;

    // Update red badge for CRM menu item
    const badgeRecall = document.getElementById('badge-recall');
    if (recallClients.length > 0) {
        badgeRecall.innerText = recallClients.length;
        badgeRecall.style.display = 'block';
    } else {
        badgeRecall.style.display = 'none';
    }

    // Leads indicators
    const activeLeads = data.leads.filter(l => l.stage !== 'scheduled' && l.stage !== 'lost');
    const badgeLeads = document.getElementById('badge-leads');
    if (activeLeads.length > 0) {
        badgeLeads.innerText = activeLeads.length;
        badgeLeads.style.display = 'block';
    } else {
        badgeLeads.style.display = 'none';
    }

    const pendingLeadsCount = data.leads.filter(l => l.stage === 'new' || l.stage === 'talking' || l.stage === 'link_sent').length;
    document.getElementById('dash-leads-pending-count').innerText = `${pendingLeadsCount} leads`;
    // Conversion progress bar (percentage of scheduled vs total)
    const totalLeads = data.leads.length;
    const convertedLeads = data.leads.filter(l => l.stage === 'scheduled').length;
    const leadConversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
    document.getElementById('dash-leads-progress-bar').style.width = `${leadConversionRate}%`;

    // 2. Render Today's Agenda List
    const atendimentosList = document.getElementById('dash-atendimentos-list');
    atendimentosList.innerHTML = '';

    // "Próximos" = só o que ainda vai acontecer (ou está em andamento agora);
    // atendimentos de horários já passados saem da lista, mas seguem nos KPIs
    const now = new Date();
    const realTodayStr = getLocalDateString(now);

    // Get all future appointments starting from NOW
    let allUpcoming = data.appointments.filter(appt => {
        if (appt.status === 'cancelled' || appt.status === 'done' || appt.status === 'no_show') return false;
        if (appt.date < realTodayStr) return false;

        // se for hoje, verifica se já passou do horário de fim
        if (appt.date === realTodayStr) {
            const service = data.services.find(s => s.id === appt.serviceId);
            const [hours, minutes] = appt.time.split(':').map(Number);
            const end = new Date(now);
            end.setHours(hours, minutes + (service?.duration || 30), 0, 0);
            return end >= now;
        }

        // se for de amanhã em diante, inclui
        return true;
    });

    // Sort chronologically (date then time)
    allUpcoming.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });

    // Take up to 10
    const upcomingAppts = allUpcoming.slice(0, 10);


    if (upcomingAppts.length === 0) {
        atendimentosList.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                <i class="fa-regular fa-calendar-minus" style="font-size: 32px; margin-bottom: 12px; display: block;"></i>
                ${todayAppts.length > 0 ? 'Os atendimentos de hoje já passaram do horário.' : 'Nenhum agendamento para hoje.'}
            </div>
        `;
    } else {
        upcomingAppts.forEach(appt => {
            const client = data.clients.find(c => c.id === appt.clientId) || { name: 'Cliente Desconhecido', phone: '' };
            const service = data.services.find(s => s.id === appt.serviceId) || { name: 'Serviço Desconhecido', price: 0, duration: 30 };
            const professional = data.professionals.find(p => p.id === appt.profId) || { name: 'Profissional' };

            let dateLabel = '';
            const [yyyy, mm, dd] = appt.date.split('-');

            const tomorrowDate = new Date();
            tomorrowDate.setDate(tomorrowDate.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrowDate);

            let dateText = `${dd}/${mm}`;
            let colorVar = "var(--text-muted)";

            if (appt.date === realTodayStr) {
                dateText = "Hoje";
                colorVar = "var(--primary)";
            } else if (appt.date === tomorrowStr) {
                dateText = "Amanhã";
                colorVar = "var(--info)";
            }

            dateLabel = `<span style="font-size: 11px; color: ${colorVar}; font-weight: 800; display: block; margin-top: 4px; letter-spacing: 0.5px; text-transform: uppercase;">${dateText}</span>`;

            const dayClass = (appt.date === realTodayStr) ? 'is-hoje' : 'is-futuro';
            const card = document.createElement('div');
            card.className = `atendimento-card status-${appt.status} ${dayClass}`;
            card.innerHTML = `
                <div class="appt-time-box">
                    <span class="appt-time">${appt.time}</span>
                    <span class="appt-duration">${service.duration} min</span>
                    ${dateLabel}
                </div>
                <div class="appt-client-info">
                    <strong class="appt-client-name">${escapeHTML(client.name)}</strong>
                    <span class="appt-service-tag">${service.name} • c/ <strong>${professional.name}</strong></span>
                </div>
                <div class="appt-meta-tags">
                    <span class="status-badge ${appt.status}">${translateStatus(appt.status)}</span>
                </div>
                <div class="appt-price">${formatCurrency(service.price)}</div>
                <div class="appt-actions">
                    ${botaoDeVezDoCliente(appt)}
                    <button class="btn-card-action" onclick="openEditAppointment('${appt.id}')" title="Editar Atendimento">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </div>
            `;
            atendimentosList.appendChild(card);
        });
    }

    // 3. Render CRM Recommended Actions (suggest return)
    const crmList = document.getElementById('dash-crm-list');
    crmList.innerHTML = '';

    const limitRecallList = recallClients.slice(0, 3); // top 3 for dashboard
    if (limitRecallList.length === 0) {
        crmList.innerHTML = `
            <div style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 15px;">
                Todos os clientes estão com retornos em dia!
            </div>
        `;
    } else {
        limitRecallList.forEach(client => {
            const card = document.createElement('div');
            card.className = 'crm-alert-card';
            card.innerHTML = `
                <div class="crm-alert-text">
                    <strong>${escapeHTML(client.name)}</strong>
                    <span class="crm-alert-subtext">Corte habitual a cada ${frequenciaDoCliente(client)} dias. Último há ${client.daysSinceLast} dias.</span>
                </div>
                <button class="btn btn-primary btn-sm" onclick="openWhatsAppCRMSimulator('${client.id}')">
                    <i class="fa-brands fa-whatsapp"></i> Chamar
                </button>
            `;
            crmList.appendChild(card);
        });
    }


    // 3.8 Render Birthdays
    const birthdaysList = document.getElementById('dash-birthdays-list');
    if (birthdaysList) {
        birthdaysList.innerHTML = '';

        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();

        // Calculate upcoming birthdays (next 7 days)
        const upcomingBirthdays = data.clients.filter(client => {
            if (!client.birth) return false;
            // birth format: YYYY-MM-DD
            const parts = client.birth.split('-');
            if (parts.length !== 3) return false;

            const birthMonth = parseInt(parts[1], 10);
            const birthDay = parseInt(parts[2], 10);

            // Check if birthday is today or within next 7 days (ignoring year)
            const clientDate = new Date(today.getFullYear(), birthMonth - 1, birthDay);
            const diffTime = clientDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // If birthday already passed this year, check next year
            if (diffDays < 0) {
                const nextYearDate = new Date(today.getFullYear() + 1, birthMonth - 1, birthDay);
                const nextDiffTime = nextYearDate - today;
                const nextDiffDays = Math.ceil(nextDiffTime / (1000 * 60 * 60 * 24));
                return nextDiffDays >= 0 && nextDiffDays <= 7;
            }

            return diffDays >= 0 && diffDays <= 7;
        });

        // Sort by how close they are
        upcomingBirthdays.sort((a, b) => {
            const getDiff = (client) => {
                const parts = client.birth.split('-');
                let cDate = new Date(today.getFullYear(), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                if (cDate < today) cDate.setFullYear(today.getFullYear() + 1);
                return cDate - today;
            };
            return getDiff(a) - getDiff(b);
        });

        if (upcomingBirthdays.length === 0) {
            birthdaysList.innerHTML = `
                <div style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 15px;">
                    Nenhum cliente faz aniversário nos próximos 7 dias.
                </div>
            `;
        } else {
            upcomingBirthdays.forEach(client => {
                const parts = client.birth.split('-');
                const bDay = parseInt(parts[2], 10);
                const bMonth = parseInt(parts[1], 10);

                let dayText = `${bDay}/${bMonth < 10 ? '0' + bMonth : bMonth}`;
                if (bMonth === currentMonth && bDay === currentDay) {
                    dayText = 'Hoje! 🎈';
                } else if (bMonth === currentMonth && bDay === currentDay + 1) {
                    dayText = 'Amanhã';
                }

                // A mensagem sai do que está salvo nas Configurações. escapeHTML
                // NÃO entra aqui: o texto vai para a URL do WhatsApp, não para o
                // HTML — escapar transformaria "&" em "&amp;" na mensagem enviada.
                const msg = encodeURIComponent(aplicarTagsWhatsApp(mensagemDeAniversario(), {
                    nome: primeiroNomeApresentavel(client.name)
                }));

                const card = document.createElement('div');
                card.className = 'crm-alert-card';
                card.style.borderLeftColor = '#f43f5e'; // rose color for birthday
                card.innerHTML = `
                    <div class="crm-alert-text">
                        <strong>${escapeHTML(client.name)}</strong>
                        <span class="crm-alert-subtext">Faz aniversário: ${dayText}</span>
                    </div>
                    <a href="https://wa.me/${client.phone.replace(/\D/g, '')}?text=${msg}" target="_blank" class="btn btn-sm" style="background: #f43f5e; color: white;">
                        <i class="fa-brands fa-whatsapp"></i> Parabéns
                    </a>
                `;
                birthdaysList.appendChild(card);
            });
        }
    }

    // 4. Render Recent Leads panel
    const recentLeadsPanel = document.getElementById('dash-recent-leads');
    recentLeadsPanel.innerHTML = '';
    const limitLeads = data.leads.filter(l => l.stage !== 'scheduled' && l.stage !== 'lost').slice(0, 3);

    if (limitLeads.length === 0) {
        recentLeadsPanel.innerHTML = `
            <div style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 15px;">
                Nenhum lead em aberto no momento.
            </div>
        `;
    } else {
        limitLeads.forEach(lead => {
            const row = document.createElement('div');
            row.className = 'recent-lead-row';
            row.innerHTML = `
                <div>
                    <span class="recent-lead-name">${escapeHTML(lead.name)}</span>
                    <span class="recent-lead-source"><i class="fa-brands fa-${escapeHTML(lead.source)} lead-source-icon ${escapeHTML(lead.source)}"></i> ${escapeHTML(lead.phone)}</span>
                </div>
                <span class="status-badge" style="background-color: var(--bg-tertiary); color: var(--text-muted); font-size: 9px;">${translateLeadStage(lead.stage)}</span>
            `;
            recentLeadsPanel.appendChild(row);
        });
    }
}

// Calculates which clients are overdue for return based on lastVisit and frequency
function getRecallClients() {
    return data.clients.filter(client => {
        if (!client.lastVisit) return false;
        const daysSinceLast = diasDesdeAVisita(client.lastVisit);
        if (daysSinceLast === null) return false;
        client.daysSinceLast = daysSinceLast;
        // Usa a frequência medida quando o cliente já tem histórico suficiente;
        // o campo do cadastro (30 por padrão) é só o palpite inicial.
        return daysSinceLast > frequenciaDoCliente(client);
    }).sort((a, b) => b.daysSinceLast - a.daysSinceLast); // biggest delay first
}

/* De onde vem a frequência de retorno de cada cliente.

   `false` (MANUAL): vale o número que o dono preenche no cadastro do cliente,
   campo "Frequência Média de Retorno". Decisão do dono em 18/09/2026, no começo
   da operação: o sistema ainda tem poucas semanas de histórico, e uma média
   tirada de duas visitas diria mais sobre o acaso do que sobre o cliente.

   `true` (AUTOMÁTICA): vale a média medida entre as visitas — agendamentos
   concluídos e vendas de balcão, contadas por dia (ver calculateClientStats);
   o cadastro só entra enquanto o cliente tiver menos de duas visitas.

   É daqui que saem a coluna "Frequência" da lista, o "Em dia / Atrasado", o
   CRM de retorno, o contador do Dashboard e o "retorno em X dias" da ficha. Para
   o automático, basta trocar para `true`: o cálculo continua pronto e testado
   (testes/testa_frequencia.js cobre os dois modos). */
let FREQUENCIA_DE_RETORNO_AUTOMATICA = false;

// Frequência de retorno do cliente, em dias — no modo escolhido acima.
// `stats` é opcional: quem já calculou (a lista de Clientes) passa o que tem,
// em vez de refazer a conta inteira para cada cliente.
function frequenciaDoCliente(client, stats) {
    if (FREQUENCIA_DE_RETORNO_AUTOMATICA) {
        const medida = (stats || calculateClientStats(client.id)).averageFrequency;
        if (medida !== null) return medida;
    }
    return Number(client.frequency) || 30;
}

// Translators
function translateStatus(st) {
    const match = {
        scheduled: 'Agendado',
        confirmed: 'Confirmado',
        in_progress: 'Em atendimento',
        done: 'Concluído',
        no_show: 'Faltou',
        cancelled: 'Cancelado'
    };
    return match[st] || st;
}

// Status que ainda contam como "vai acontecer". Existe porque a fila do
// cliente e a agenda do barbeiro precisam da mesma definição — quem já foi
// atendido, faltou ou cancelou sai da fila.
function atendimentoEmAberto(status) {
    return status !== 'done' && status !== 'no_show' && status !== 'cancelled';
}

/* --- A vez do cliente, em um toque -------------------------------------
   O barbeiro atualiza o status entre um corte e outro, com o cliente na
   cadeira. Abrir modal, escolher no select e salvar não acontece nesse
   contexto — e, se não acontecer, a fila que o cliente acompanha mente.
   Por isso o card tem um botão só, que avança para o próximo passo. */
function botaoDeVezDoCliente(appt) {
    if (appt.date !== getLocalDateString(new Date())) return '';
    if (!atendimentoEmAberto(appt.status)) return '';

    if (appt.status === 'in_progress') {
        return `<button class="btn-card-action btn-vez concluir" onclick="avancarAtendimento('${appt.id}', 'done')" title="Concluir atendimento">
                    <i class="fa-solid fa-check"></i>
                </button>`;
    }
    return `<button class="btn-card-action btn-vez iniciar" onclick="avancarAtendimento('${appt.id}', 'in_progress')" title="Iniciar atendimento">
                <i class="fa-solid fa-play"></i>
            </button>`;
}

window.avancarAtendimento = function (apptId, novoStatus) {
    const appt = data.appointments.find(a => a.id === apptId);
    if (!appt) return;

    // Um cliente por vez: começar outro atendimento fecha o anterior que ficou
    // aberto. Sem isso a fila mostraria duas pessoas "em atendimento" e o
    // cliente não saberia de quem é a vez.
    if (novoStatus === 'in_progress') {
        data.appointments.forEach(a => {
            if (a.profId === appt.profId && a.date === appt.date && a.status === 'in_progress') {
                a.status = 'done';
            }
        });
    }

    appt.status = novoStatus;
    saveData(STATE_KEYS.APPOINTMENTS, data.appointments);
    renderDashboard();
    if (typeof renderAgenda === 'function') renderAgenda();

    const cliente = data.clients.find(c => c.id === appt.clientId);
    const nome = cliente ? primeiroNomeApresentavel(cliente.name) : 'Atendimento';
    showToast(novoStatus === 'in_progress' ? `${nome} em atendimento.` : `${nome}: atendimento concluído.`, 'success');
};

function translateLeadStage(st) {
    const match = {
        new: 'Novo Lead',
        talking: 'Conversando',
        link_sent: 'Link Enviado',
        scheduled: 'Agendado',
        follow_up: 'Retorno',
        lost: 'Perdido'
    };
    return match[st] || st;
}

// --- 2. AGENDA COMPONENT ---
function renderAgenda() {
    // Current display title
    document.getElementById('agenda-current-date-title').innerText = formatDateDisplay(currentSelectedDate);

    // Set value in appointment modal date field to current selected date
    document.getElementById('appt-date').value = getLocalDateString(currentSelectedDate);

    // Populate professional columns headers
    const headerCols = document.getElementById('calendar-header-cols');
    const colsContainer = document.getElementById('calendar-columns-container');
    headerCols.innerHTML = '';
    colsContainer.innerHTML = '';

    const activeProfs = data.professionals.filter(p => p.active);

    // Mobile professional switcher list populate
    const profSwitcher = document.getElementById('mobile-prof-switcher');
    if (profSwitcher) {
        profSwitcher.innerHTML = '';
        if (!window.mobileSelectedProfId && activeProfs.length > 0) {
            window.mobileSelectedProfId = activeProfs[0].id;
        }
        activeProfs.forEach(prof => {
            const btn = document.createElement('button');
            btn.className = `prof-switch-btn ${window.mobileSelectedProfId === prof.id ? 'active' : ''}`;
            btn.innerText = prof.name.split(' ')[0];
            btn.addEventListener('click', () => {
                window.mobileSelectedProfId = prof.id;
                renderAgenda();
            });
            profSwitcher.appendChild(btn);
        });
    }

    // Time Axis Rendering (9:00 to 19:00)
    const timeAxis = document.getElementById('calendar-time-axis');
    timeAxis.innerHTML = '';
    for (let hour = 9; hour < 19; hour++) {
        const timeLabel = document.createElement('div');
        timeLabel.className = 'time-axis-label';
        timeLabel.innerText = `${String(hour).padStart(2, '0')}:00`;
        timeAxis.appendChild(timeLabel);
    }

    if (activeProfs.length === 0) {
        headerCols.innerHTML = `<div class="calendar-header-col" style="border:none;">Cadastre profissionais ativos nas Configurações.</div>`;
        return;
    }

    // Detecta clientes com múltiplos agendamentos na mesma semana (duplicata)
    const selectedDateObj = typeof currentSelectedDate === 'string' ? new Date(currentSelectedDate + 'T12:00:00') : currentSelectedDate;
    const dayOfWeek = selectedDateObj.getDay(); // 0=Sun
    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    const weekStart = new Date(selectedDateObj);
    weekStart.setDate(selectedDateObj.getDate() - (isoDay - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekStartStr = getLocalDateString(weekStart);
    const weekEndStr = getLocalDateString(weekEnd);

    const weekAppointments = data.appointments.filter(a =>
        a.status !== 'cancelled' && a.clientId && a.date >= weekStartStr && a.date <= weekEndStr
    );
    // Conta agendamentos por clientId na semana
    const clientWeekCount = {};
    weekAppointments.forEach(a => {
        clientWeekCount[a.clientId] = (clientWeekCount[a.clientId] || 0) + 1;
    });
    // Set de clientIds com 2+ agendamentos na semana
    const duplicateWeekClients = new Set();
    Object.entries(clientWeekCount).forEach(([cid, count]) => {
        if (count >= 2) duplicateWeekClients.add(cid);
    });

    activeProfs.forEach(prof => {
        // 1. Render column header
        const colHeader = document.createElement('div');
        colHeader.className = 'calendar-header-col';
        if (window.mobileSelectedProfId === prof.id) {
            colHeader.classList.add('active-mobile-col');
        }
        colHeader.innerText = prof.name;
        headerCols.appendChild(colHeader);

        // 2. Render column body
        const col = document.createElement('div');
        col.className = 'calendar-col';
        if (window.mobileSelectedProfId === prof.id) {
            col.classList.add('active-mobile-col');
        }
        col.setAttribute('data-prof-id', prof.id);

        // Render dashed background grid lines
        const gridLines = document.createElement('div');
        gridLines.className = 'calendar-grid-lines';
        for (let i = 9; i < 19; i++) {
            const line = document.createElement('div');
            line.className = 'grid-line';
            gridLines.appendChild(line);
        }
        col.appendChild(gridLines);

        // 3. Filter and position appointments for this professional & selected date
        const dateStr = getLocalDateString(currentSelectedDate);
        const profApptsRaw = data.appointments.filter(a => a.profId === prof.id && a.date === dateStr && a.status !== 'cancelled');

        const events = profApptsRaw.map(appt => {
            const client = data.clients.find(c => c.id === appt.clientId) || { name: 'Cliente', phone: '' };
            const service = data.services.find(s => s.id === appt.serviceId) || { name: 'Serviço', price: 0, duration: 30 };
            const [startHour, startMin] = appt.time.split(':').map(Number);
            const start = (startHour - 9) * 60 + startMin;
            const duration = parseInt(service.duration, 10) || 30;
            const end = start + duration;
            return { appt, client, service, start, end, duration };
        });

        events.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return b.end - a.end;
        });

        let clusters = [];
        let currentCluster = { events: [], maxEnd: -1 };

        events.forEach(ev => {
            if (ev.start < currentCluster.maxEnd) {
                currentCluster.events.push(ev);
                currentCluster.maxEnd = Math.max(currentCluster.maxEnd, ev.end);
            } else {
                if (currentCluster.events.length > 0) {
                    clusters.push(currentCluster);
                }
                currentCluster = { events: [ev], maxEnd: ev.end };
            }
        });
        if (currentCluster.events.length > 0) {
            clusters.push(currentCluster);
        }

        clusters.forEach(cluster => {
            let columns = [];
            cluster.events.forEach(ev => {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    const col = columns[i];
                    const lastEvent = col[col.length - 1];
                    if (ev.start >= lastEvent.end) {
                        col.push(ev);
                        ev.colIndex = i;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    columns.push([ev]);
                    ev.colIndex = columns.length - 1;
                }
            });

            const numCols = columns.length;
            cluster.events.forEach(ev => {
                ev.width = 100 / numCols;
                ev.left = (100 / numCols) * ev.colIndex;
            });
        });

        events.forEach(ev => {
            const topPosition = ev.start;

            // Only show if within calendar range (09:00 to 19:00 = 600px total height)
            if (topPosition >= 0 && topPosition < 600) {
                const eventEl = document.createElement('div');
                eventEl.className = `calendar-appt-event ${ev.appt.status}`;

                // Marca visualmente se o cliente tem 2+ agendamentos na semana
                const isDuplicateWeek = ev.appt.clientId && duplicateWeekClients.has(ev.appt.clientId);
                if (isDuplicateWeek) {
                    eventEl.classList.add('duplicate-week-appt');
                }

                eventEl.style.top = `${topPosition}px`;
                eventEl.style.height = `${ev.duration}px`;

                eventEl.style.width = `calc(${ev.width}% - 6px)`;
                eventEl.style.left = `calc(${ev.left}% + 3px)`;
                eventEl.style.right = 'auto'; // override CSS default right:4px

                const duplicateBadge = isDuplicateWeek
                    ? `<span class="duplicate-week-badge" title="Cliente com ${clientWeekCount[ev.appt.clientId]} agendamentos nesta semana"><i class="fa-solid fa-clone"></i></span>`
                    : '';

                eventEl.innerHTML = `
                    <div style="padding-right: 20px; overflow: hidden;">
                        <div class="event-title" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">
                            ${duplicateBadge}${escapeHTML(ev.client.name)}
                        </div>
                        <div class="event-desc" style="font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; opacity: 0.9;">
                            ${escapeHTML(ev.service.name)}
                        </div>
                    </div>
                    <div class="event-time" style="position: absolute; bottom: 4px; right: 6px; font-size: 9px; font-weight: 600; line-height: 1;">${ev.appt.time}</div>
                    ${renderAppointmentStatusBadge(ev.appt, ev.duration)}
                `;

                eventEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditAppointment(ev.appt.id);
                });

                col.appendChild(eventEl);
            }
        });

        // Click column space to create quick appointment at that approximate hour
        col.addEventListener('click', (e) => {
            const rect = col.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            // 60px = 1 hour. Calculate hour.
            const clickedHour = Math.floor(clickY / 60) + 9;
            const clickedMinute = Math.floor((clickY % 60) / 10) * 10; // Round to nearest 10 mins

            const timeStr = `${String(clickedHour).padStart(2, '0')}:${String(clickedMinute).padStart(2, '0')}`;
            openNewAppointmentModal(prof.id, timeStr);
        });

        colsContainer.appendChild(col);
    });

    // Check for end-of-day pending payments alert
    const todayStr = getLocalDateString(new Date());
    if (currentSelectedDate === todayStr) {
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();

        let hasPendingPast = false;
        data.appointments.forEach(a => {
            if (a.date === todayStr && a.paymentStatus === 'pending' && a.status !== 'cancelled') {
                const s = data.services.find(srv => srv.id === a.serviceId);
                const endM = timeToMinutes(a.time) + (s ? parseInt(s.duration) : 30);
                if (nowMins > endM) hasPendingPast = true;
            }
        });

        // Show alert if there are pending appointments and the day is mostly over (e.g. after 18:00 or just any pending past)
        if (hasPendingPast) {
            const alertDiv = document.createElement('div');
            alertDiv.style.cssText = "margin: 10px 20px; padding: 12px 16px; background: rgba(231,76,60,0.1); border: 1px solid rgba(231,76,60,0.3); border-radius: 8px; color: #e74c3c; font-size: 13px; display: flex; align-items: center; gap: 10px;";
            alertDiv.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="font-size: 18px;"></i> <div><strong>Atenção:</strong> Você tem atendimentos finalizados hoje que ainda constam com pagamento pendente. Lembre-se de confirmar o recebimento!</div>';
            document.querySelector('.calendar-container').prepend(alertDiv);
        }
    }
}

// Navigation helpers for agenda
let currentAgendaView = 'day';
document.getElementById('btn-agenda-prev').addEventListener('click', () => {
    if (currentAgendaView === 'month') currentSelectedDate.setMonth(currentSelectedDate.getMonth() - 1);
    else currentSelectedDate.setDate(currentSelectedDate.getDate() - (currentAgendaView === 'week' ? 7 : 1));
    currentAgendaView === 'day' ? renderAgenda() : renderAlternateCalendar(currentAgendaView);
});

document.getElementById('btn-agenda-next').addEventListener('click', () => {
    if (currentAgendaView === 'month') currentSelectedDate.setMonth(currentSelectedDate.getMonth() + 1);
    else currentSelectedDate.setDate(currentSelectedDate.getDate() + (currentAgendaView === 'week' ? 7 : 1));
    currentAgendaView === 'day' ? renderAgenda() : renderAlternateCalendar(currentAgendaView);
});

// View switch placeholders (simulated alert info)
const agendaViewButtons = document.querySelectorAll('.agenda-filters button');
agendaViewButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        agendaViewButtons.forEach(b => b.classList.remove('btn-active'));
        btn.classList.add('btn-active');

        const wrapper = document.querySelector('.calendar-wrapper');
        const altView = document.getElementById('calendar-alternate-view');

        currentAgendaView = btn.id.replace('btn-agenda-view-', '');
        if (currentAgendaView === 'day') {
            wrapper.style.display = 'flex';
            altView.style.display = 'none';
            renderAgenda();
        } else {
            wrapper.style.display = 'none';
            altView.style.display = 'block';
            renderAlternateCalendar(currentAgendaView);
        }
    });
});

// Appt CRUD Triggers
function openNewAppointmentModal(profId = '', timeVal = '09:00') {
    populateApptFormSelects();

    document.getElementById('appt-create-fields').style.display = 'block';
    document.getElementById('appt-create-fields-secondary').style.display = 'block';
    document.getElementById('appt-readonly-summary').style.display = 'none';

    document.getElementById('appt-edit-actions').style.display = 'none';
    document.getElementById('appt-edit-time-fields').style.display = 'block';
    document.getElementById('appt-edit-payment-fields').style.display = 'block';

    document.getElementById('appointment-modal-title').innerText = 'Novo Agendamento';
    document.getElementById('appt-id').value = '';
    document.getElementById('appt-date').value = getLocalDateString(currentSelectedDate);
    document.getElementById('appt-time').value = timeVal;
    document.getElementById('appt-payment-value').value = '';

    if (profId) {
        document.getElementById('appt-prof-select').value = profId;
    }

    document.getElementById('btn-delete-appointment').style.display = 'none';
    if (typeof prepararProdutosDoAtendimento === 'function') prepararProdutosDoAtendimento();
    renderAppointmentMessageTimeline('');
    openModal('modal-appointment');
}

document.getElementById('btn-new-appointment').addEventListener('click', () => openNewAppointmentModal());
document.getElementById('btn-quick-appointment').addEventListener('click', () => openNewAppointmentModal());

// Select elements populate helper
function populateApptFormSelects() {
    const clientSelect = document.getElementById('appt-client-select');
    const serviceSelect = document.getElementById('appt-service-select');
    const profSelect = document.getElementById('appt-prof-select');

    // Populate Clients
    clientSelect.innerHTML = '<option value="">-- Selecione o Cliente --</option>';
    data.clients.forEach(cli => {
        clientSelect.innerHTML += `<option value="${cli.id}">${escapeHTML(cli.name)} (${escapeHTML(cli.phone)})</option>`;
    });

    // Populate Services
    serviceSelect.innerHTML = '<option value="">-- Selecione o Serviço --</option>';
    data.services.filter(s => s.active).forEach(srv => {
        serviceSelect.innerHTML += `<option value="${srv.id}">${escapeHTML(srv.name)} (${formatCurrency(srv.price)})</option>`;
    });

    // Populate Professionals
    profSelect.innerHTML = '<option value="">-- Selecione o Profissional --</option>';
    data.professionals.filter(p => p.active).forEach(prof => {
        profSelect.innerHTML += `<option value="${prof.id}">${escapeHTML(prof.name)}</option>`;
    });
}

/* O cliente (ou o serviço, ou o profissional) do atendimento pode ter sido
   excluído depois. Sem isto o `select` fica sem valor, o atendimento perde a
   referência ao ser salvo, e o histórico do dia vira um registro órfão — e,
   como o campo é obrigatório e fica escondido no modo pagamento, ele ainda
   travava o "Salvar Pagamento" sem erro visível.

   Uma opção com o id original mantém a ligação e deixa na tela o que
   aconteceu, em vez de um campo em branco que ninguém sabe explicar. */
function garantirOpcaoDoRegistro(select, valor, rotulo) {
    if (!select || !valor) return;
    if (!Array.from(select.options).some(o => o.value === valor)) {
        const opt = document.createElement('option');
        opt.value = valor;
        opt.text = rotulo;
        select.appendChild(opt);
    }
    select.value = valor;
}

function openEditAppointment(apptId, mode = 'edit') {
    const appt = data.appointments.find(a => a.id === apptId);
    if (!appt) return;

    const modalTitle = document.getElementById('appointment-modal-title');
    const saveBtn = document.getElementById('btn-save-appointment');
    if (mode === 'pay') {
        if (modalTitle) modalTitle.innerText = "Confirmar Pagamento";
        if (saveBtn) saveBtn.innerText = "Salvar Pagamento";
    } else {
        if (modalTitle) modalTitle.innerText = "Agendamento";
        if (saveBtn) saveBtn.innerText = "Salvar Agendamento";
    }

    populateApptFormSelects();

    document.getElementById('appt-create-fields').style.display = 'none';
    document.getElementById('appt-create-fields-secondary').style.display = 'none';
    document.getElementById('appt-readonly-summary').style.display = 'block';

    if (mode === 'pay') {
        document.getElementById('appt-edit-actions').style.display = 'none';
        document.getElementById('appt-edit-time-fields').style.display = 'none';
        document.getElementById('appt-edit-payment-fields').style.display = 'block';
    } else {
        document.getElementById('appt-edit-actions').style.display = 'flex';
        document.getElementById('appt-edit-time-fields').style.display = 'none';
        document.getElementById('appt-edit-payment-fields').style.display = 'none';

        // Mostra os dois botões novamente caso tenham sido ocultados anteriormente
        const actionBtns = document.querySelectorAll('#appt-edit-actions button');
        actionBtns.forEach(btn => btn.style.display = 'flex');
    }

    const client = data.clients.find(c => c.id === appt.clientId);
    const service = data.services.find(s => s.id === appt.serviceId);
    const prof = data.professionals.find(p => p.id === appt.profId);

    document.getElementById('summary-client-name').innerText = client ? client.name : 'Cliente';
    document.getElementById('summary-service-name').innerText = service ? service.name : 'Serviço';
    document.getElementById('summary-prof-name').innerText = prof ? `Com ${prof.name.split(' ')[0]}` : 'Profissional';

    // O título já foi decidido lá em cima pelo modo. Reescrevê-lo aqui apagava
    // o "Confirmar Pagamento" e devolvia "Agendamento", justamente na tela em
    // que a pessoa está fechando a conta.
    document.getElementById('appt-id').value = appt.id;
    garantirOpcaoDoRegistro(document.getElementById('appt-client-select'),
        appt.clientId, (client ? client.name : 'Cliente excluído'));
    garantirOpcaoDoRegistro(document.getElementById('appt-service-select'),
        appt.serviceId, (service ? service.name : 'Serviço excluído'));
    garantirOpcaoDoRegistro(document.getElementById('appt-prof-select'),
        appt.profId, (prof ? prof.name : 'Profissional excluído'));
    document.getElementById('appt-date').value = appt.date;
    document.getElementById('appt-time').value = appt.time;
    document.getElementById('appt-status').value = appt.status;
    document.getElementById('appt-payment').value = appt.paymentStatus;
    document.getElementById('appt-payment-method').value = appt.paymentMethod || 'pix';

    // Set payment value if it exists, otherwise use the original service price
    document.getElementById('appt-payment-value').value = appt.price !== undefined ? appt.price : (service ? service.price : '');

    document.getElementById('appt-notes').value = appt.notes || '';

    // Show delete button
    document.getElementById('btn-delete-appointment').style.display = 'block';

    // Add event listener to payment status to auto zero the value
    const paymentSelect = document.getElementById('appt-payment');
    const paymentValueInput = document.getElementById('appt-payment-value');

    paymentSelect.onchange = function () {
        if (this.value === 'free') {
            paymentValueInput.value = 0;
            paymentValueInput.disabled = true;
        } else {
            paymentValueInput.disabled = false;
            if (paymentValueInput.value == 0) {
                paymentValueInput.value = service ? service.price : '';
            }
        }
    };
    // Trigger to set initial state
    paymentSelect.dispatchEvent(new Event('change'));

    if (typeof prepararProdutosDoAtendimento === 'function') prepararProdutosDoAtendimento();

    renderAppointmentMessageTimeline(apptId);
    openModal('modal-appointment');
}

// Appt form submission
document.getElementById('form-appointment').addEventListener('submit', (e) => {
    e.preventDefault();

    const id = document.getElementById('appt-id').value;
    const clientId = document.getElementById('appt-client-select').value;
    const serviceId = document.getElementById('appt-service-select').value;
    const profId = document.getElementById('appt-prof-select').value;
    const date = document.getElementById('appt-date').value;
    const time = document.getElementById('appt-time').value;
    const status = document.getElementById('appt-status').value;
    const paymentStatus = document.getElementById('appt-payment').value;
    const paymentMethod = document.getElementById('appt-payment-method').value;
    const notes = document.getElementById('appt-notes').value;

    // Validação no JS porque o formulário passou a ser `novalidate` — ver o
    // comentário na tag, em index.html. O formulário esconde metade dos campos
    // conforme o modo (pagamento, horário, criação) e a validação do navegador
    // não sabe disso: um obrigatório escondido e vazio fazia o botão parar de
    // responder, sem erro visível e sem como a pessoa descobrir o motivo. Aqui
    // a falta de um campo vira mensagem.
    const faltando = [];
    if (!clientId) faltando.push('o cliente');
    if (!serviceId) faltando.push('o serviço');
    if (!profId) faltando.push('o profissional');
    if (!date) faltando.push('a data');
    if (!time) faltando.push('o horário');

    if (faltando.length) {
        document.getElementById('appt-create-fields').style.display = 'block';
        document.getElementById('appt-edit-time-fields').style.display = 'block';
        showToast('Falta preencher ' + faltando.join(', ') + '.', 'warning');
        return;
    }

    const selectedService = data.services.find(s => s.id === serviceId);
    let price = document.getElementById('appt-payment-value').value;
    if (!price || price.trim() === '') {
        price = selectedService ? selectedService.price : 0;
    } else {
        price = parseFloat(price);
    }

    const newAppt = { id, clientId, serviceId, profId, date, time, status, paymentStatus, paymentMethod, notes };

    const newStart = timeToMinutes(time);
    const newEnd = newStart + (selectedService?.duration || 30);

    let isTimeChanged = true;
    if (id) {
        const originalAppt = data.appointments.find(a => a.id === id);
        if (originalAppt &&
            originalAppt.date === date &&
            originalAppt.time === time &&
            originalAppt.serviceId === serviceId &&
            originalAppt.profId === profId) {
            isTimeChanged = false;
        }
    }

    if (isTimeChanged) {
        const conflict = data.appointments.find(a => {
            if (a.profId !== profId || a.date !== date || a.id === id || a.status === 'cancelled') return false;
            const existingService = data.services.find(s => s.id === a.serviceId);
            const existingStart = timeToMinutes(a.time);
            const existingEnd = existingStart + (existingService?.duration || 30);
            return newStart < existingEnd && newEnd > existingStart;
        });

        if (conflict) {
            const otherClient = data.clients.find(c => c.id === conflict.clientId) || { name: 'Outro' };
            showToast(`Conflito: o horário sobrepõe o atendimento de ${otherClient.name}.`, 'danger');
            return;
        }

        // Indisponibilidade e horário de funcionamento AVISAM, mas não impedem:
        // o encaixe fora do expediente é decisão da barbearia, que às vezes
        // atende um cliente antigo depois de fechar. No link público a regra é
        // dura — lá quem escolhe é o cliente, sem ninguém para autorizar.
        if (profissionalBloqueado(profId, date, newStart, newEnd)) {
            const prof = data.professionals.find(p => p.id === profId) || { name: 'O profissional' };
            showToast(`Atenção: ${prof.name} marcou indisponibilidade nesse horário. O agendamento foi salvo mesmo assim.`, 'warning');
        } else {
            const expediente = funcionamentoDoDia(date);
            const abre = minutosDoHorario(expediente.abre);
            const fecha = minutosDoHorario(expediente.fecha);
            if (!expediente.aberto) {
                showToast('Atenção: a barbearia não abre neste dia. O agendamento foi salvo mesmo assim.', 'warning');
            } else if (newStart < abre || newEnd > fecha) {
                showToast('Atenção: horário fora do funcionamento. O agendamento foi salvo mesmo assim.', 'warning');
            }
        }
    }

    if (id) {
        // Update
        const idx = data.appointments.findIndex(a => a.id === id);
        // check if changed to done and paid to automatically log financial income
        const prevAppt = data.appointments[idx];

        data.appointments[idx] = newAppt;
        showToast("Agendamento atualizado com sucesso!", "success");

        // Financial automatic trigger
        triggerFinancialLogging(prevAppt, newAppt, price);
    } else {
        // Create
        newAppt.id = 'appt-' + Date.now();
        data.appointments.push(newAppt);
        showToast("Horário agendado com sucesso!", "success");

        // Trigger finance if logged as completed directly
        triggerFinancialLogging(null, newAppt, price);
    }

    // Produto montado na conta mas pagamento deixado como pendente: avisa em
    // vez de descartar em silêncio. Quando virou pago, triggerFinancialLogging
    // já consumiu o carrinho e não sobra nada para avisar.
    if (typeof avisarProdutosNaoCobrados === 'function') avisarProdutosNaoCobrados();

    // Save
    saveData(STATE_KEYS.APPOINTMENTS, data.appointments);
    syncAppointmentMessages(newAppt);
    closeModal('modal-appointment');

    // Update CRM / Last Visit on client completion
    if (status === 'done') {
        const clientIdx = data.clients.findIndex(c => c.id === clientId);
        if (clientIdx !== -1) {
            data.clients[clientIdx].lastVisit = date;
            saveData(STATE_KEYS.CLIENTS, data.clients);
        }
    }

    // Re-render
    const activeMenuItem = document.querySelector('.menu-item.active');
    const target = activeMenuItem ? activeMenuItem.getAttribute('data-target') : 'agenda';
    renderPageData(target);
});

// Auto Financial Record Sync
function triggerFinancialLogging(prev, current, manualPrice) {
    // If paymentStatus changed to 'paid' or 'free' (or created as such), log as transaction
    const wasPaid = prev ? (prev.paymentStatus === 'paid' || prev.paymentStatus === 'free') : false;
    const isPaid = (current.paymentStatus === 'paid' || current.paymentStatus === 'free');

    if (!wasPaid && isPaid) {
        const service = data.services.find(s => s.id === current.serviceId);
        const client = data.clients.find(c => c.id === current.clientId);

        let price = manualPrice !== undefined ? manualPrice : (service ? service.price : 50);
        if (current.paymentStatus === 'free') price = 0;

        const isCortesia = current.paymentStatus === 'free';
        const desc = `${service ? service.name : 'Serviço'}${isCortesia ? ' (Cortesia)' : ''} - ${client ? client.name : 'Cliente'}`;

        const paymentMethod = isCortesia ? 'Cortesia' : (current.paymentMethod || 'pix');
        const activeRegister = window.getCurrentCashRegister ? window.getCurrentCashRegister() : null;
        let status = 'completed';
        if (!activeRegister && ehPagamentoEmDinheiro(paymentMethod)) {
            status = 'pending';
        }

        const newTrans = {
            id: 'tr-' + Date.now(),
            type: 'income',
            amount: price,
            // date = dia do atendimento (competência, usada no extrato do período).
            // registradoEm = instante em que o dinheiro entrou no caixa. São
            // datas diferentes quando se confirma hoje o pagamento de ontem, e
            // é por isso que as duas precisam existir.
            date: current.date,
            registradoEm: new Date().toISOString(),
            description: desc,
            category: 'Serviço',
            paymentMethod: paymentMethod,
            profId: current.profId || '',
            status: status
        };
        data.transactions.push(newTrans);
        saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
        if (isCortesia) {
            showToast(`Cortesia registrada nas finanças!`, 'info');
        } else {
            showToast(`Rendimento de ${formatCurrency(price)} registrado nas finanças!`, 'success');
        }

        // O que o cliente levou junto vira um lançamento à parte e baixa do
        // estoque. Fica aqui, e não no submit, porque a regra de "virou pago
        // agora" é esta — cobrar o produto de novo a cada salvamento seria o
        // erro fácil de cometer.
        //
        // São DOIS lançamentos de propósito: misturar serviço e produto num
        // valor só estragaria o faturamento por serviço, a comissão (que sai
        // só do 'Serviço' acima) e a análise de quem compra produto.
        if (typeof concluirVendaDoAtendimento === 'function') {
            concluirVendaDoAtendimento(current).catch(err =>
                console.error('Falha ao lançar os produtos do atendimento:', err));
        }
    }
}

// Appt Delete trigger
document.getElementById('btn-delete-appointment').addEventListener('click', () => {
    const id = document.getElementById('appt-id').value;
    if (id) {
        const idx = data.appointments.findIndex(a => a.id === id);
        if (idx !== -1) {
            data.appointments[idx].status = 'cancelled';
            saveData(STATE_KEYS.APPOINTMENTS, data.appointments);
            syncAppointmentMessages(data.appointments[idx]);
            showToast("Agendamento cancelado.", "warning");
        }
        closeModal('modal-appointment');

        // Re-render the active page to keep the UI in sync (especially if deleted from dashboard)
        const activeMenuItem = document.querySelector('.menu-item.active');
        const target = activeMenuItem ? activeMenuItem.getAttribute('data-target') : 'agenda';
        renderPageData(target);
    }
});

// Quick client creator inside Appointment Modal
document.getElementById('btn-quick-add-client-from-appt').addEventListener('click', () => {
    document.getElementById('client-modal-title').innerText = 'Adicionar Cliente Rápido';
    document.getElementById('client-id').value = '';
    // Hide standard close or override modal stacking
    openModal('modal-client');
});

// --- 3. CLIENTS COMPONENT ---
function renderClients() {
    const searchQuery = document.getElementById('input-search-clients').value.toLowerCase();
    const filterStatus = document.getElementById('select-filter-clients-status').value;
    const tbody = document.getElementById('tbody-clients');
    tbody.innerHTML = '';

    // Filtering clients
    let filteredClients = data.clients.map(cli => {
        const stats = calculateClientStats(cli.id);
        return { ...cli, stats: stats, calcFrequency: frequenciaDoCliente(cli, stats) };
    }).filter(cli => {
        const matchesSearch = cli.name.toLowerCase().includes(searchQuery) || cli.phone.includes(searchQuery);

        if (!matchesSearch) return false;

        const dias = diasDesdeAVisita(cli.lastVisit);
        const daysSinceLast = dias === null ? 999 : dias;
        const isSumido = daysSinceLast > cli.calcFrequency;

        if (filterStatus === 'sumido') return isSumido && cli.lastVisit;
        if (filterStatus === 'reco') return !isSumido && cli.lastVisit && daysSinceLast <= 60;
        if (filterStatus === 'novo') return !cli.lastVisit || daysSinceLast <= 7;

        return true;
    }).sort((a, b) => a.name.localeCompare(b.name));

    if (filteredClients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">
                    Nenhum cliente correspondente encontrado.
                </td>
            </tr>
        `;
        renderPaginacao('clients-pagination', 'clientes', 0);
        return;
    }

    renderPaginacao('clients-pagination', 'clientes', filteredClients.length);
    fatiaDaPagina('clientes', filteredClients).forEach(cli => {
        const daysSinceLast = diasDesdeAVisita(cli.lastVisit);
        // Comparação explícita com null: quem veio HOJE tem 0 dias, e `0 ?`
        // seria falso — o cliente cairia no ramo de "sem visita".
        const isSumido = daysSinceLast !== null && daysSinceLast > cli.calcFrequency;

        // Mesmo número da ficha do cliente: os dois saem de calculateClientStats.
        // O cálculo que existia aqui só somava AGENDAMENTOS pagos, pelo preço
        // atual do catálogo — a venda de balcão nunca entrava.
        const totalSpent = cli.stats.spent;

        // Status Retorno HTML
        let statusBadgeHTML = '';
        if (daysSinceLast === null) {
            statusBadgeHTML = `<span class="status-badge" style="background-color: var(--info-light); color: var(--info);">Novo</span>`;
        } else if (isSumido) {
            statusBadgeHTML = `<span class="status-badge" style="background-color: var(--danger-light); color: var(--danger);">Atrasado</span>`;
        } else {
            statusBadgeHTML = `<span class="status-badge" style="background-color: var(--success-light); color: var(--success);">Em Dia</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Nome">
                <strong>${escapeHTML(cli.name)}</strong>
                ${cli.instagram ? `<span style="font-size: 11px; color: var(--text-muted); display: block;">@${escapeHTML(cli.instagram)}</span>` : ''}
            </td>
            <td data-label="WhatsApp">${escapeHTML(cli.phone)}</td>
            <td data-label="Frequência">A cada ${cli.calcFrequency} dias</td>
            <td data-label="Último Corte">${cli.lastVisit ? formatDateStringToBR(cli.lastVisit) : 'Sem registros'}</td>
            <td data-label="Status Retorno">${statusBadgeHTML}</td>
            <td data-label="Total Gasto" style="font-weight: 700;">${formatCurrency(totalSpent)}</td>
            <td data-label="Ações" style="text-align: right;">
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    ${isSumido ? `
                        <button class="btn btn-secondary btn-sm" onclick="openWhatsAppCRMSimulator('${cli.id}')" title="Mensagem de Retorno">
                            <i class="fa-brands fa-whatsapp text-success"></i> Chamar
                        </button>
                    ` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="openClientDetail('${cli.id}')"><i class="fa-solid fa-eye"></i> Ver</button>
                    <button class="btn btn-icon btn-sm" onclick="openEditClient('${cli.id}')"><i class="fa-solid fa-pen"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function formatDateStringToBR(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// Search and filters client events
// Buscar ou filtrar recomeça da primeira página: a lista filtrada é outra, e
// a página 7 da anterior não quer dizer nada nela.
document.getElementById('input-search-clients').addEventListener('input', () => {
    voltarAPrimeiraPagina('clientes');
    renderClients();
});
document.getElementById('select-filter-clients-status').addEventListener('change', () => {
    voltarAPrimeiraPagina('clientes');
    renderClients();
});

document.getElementById('btn-add-client').addEventListener('click', () => {
    document.getElementById('client-modal-title').innerText = 'Cadastrar Cliente';
    document.getElementById('client-id').value = '';
    const btnDelete = document.getElementById('btn-delete-client');
    if (btnDelete) btnDelete.style.display = 'none';
    openModal('modal-client');
});

function openEditClient(id) {
    const cli = data.clients.find(c => c.id === id);
    if (!cli) return;

    document.getElementById('client-modal-title').innerText = 'Editar Cliente';
    document.getElementById('client-id').value = cli.id;
    document.getElementById('client-name').value = cli.name;
    document.getElementById('client-phone').value = cli.phone;
    document.getElementById('client-instagram').value = cli.instagram || '';
    document.getElementById('client-birth').value = cli.birth || '';
    document.getElementById('client-frequency').value = cli.frequency;
    document.getElementById('client-notes').value = cli.notes || '';

    const btnDelete = document.getElementById('btn-delete-client');
    if (btnDelete) btnDelete.style.display = 'block';

    openModal('modal-client');
}

// Client Delete trigger
document.getElementById('btn-delete-client')?.addEventListener('click', () => {
    const id = document.getElementById('client-id').value;
    if (id) {
        if (confirm('Tem certeza que deseja excluir este cliente? Essa ação não pode ser desfeita.')) {
            data.clients = data.clients.filter(c => c.id !== id);
            saveData(STATE_KEYS.CLIENTS, data.clients);
            if (typeof DataService !== 'undefined' && DataService.deleteItem) {
                DataService.deleteItem('clients', id).catch(console.error);
            }
            showToast("Cliente excluído com sucesso.", "warning");
            closeModal('modal-client');

            const activePage = document.querySelector('.menu-item.active').getAttribute('data-target');
            renderPageData(activePage);
        }
    }
});

// Client Form submit
document.getElementById('form-client').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('client-id').value;
    const name = document.getElementById('client-name').value;
    const phone = document.getElementById('client-phone').value;
    const instagram = document.getElementById('client-instagram').value;
    const birth = document.getElementById('client-birth').value;
    const frequency = parseInt(document.getElementById('client-frequency').value) || 30;
    const notes = document.getElementById('client-notes').value;

    if (/\d/.test(name) || name.trim().length < 2) {
        alert('Por favor, informe o nome do cliente sem números.');
        return;
    }

    if (birth) {
        const birthYear = parseInt(birth.split('-')[0], 10);
        const currentYear = new Date().getFullYear();
        if (isNaN(birthYear) || birthYear < 1920 || birthYear > currentYear) {
            alert('Por favor, informe uma data de nascimento válida (entre 1920 e o ano atual).');
            return;
        }
    }

    if (id) {
        // edit
        const idx = data.clients.findIndex(c => c.id === id);
        data.clients[idx] = { ...data.clients[idx], name, phone, instagram, birth, frequency, notes };
        showToast("Cliente atualizado!", "success");
    } else {
        // create
        const existingPhone = data.clients.find(c => c.phone && c.phone === phone);
        if (existingPhone) {
            alert(`Já existe um cliente cadastrado com este WhatsApp: ${existingPhone.name}`);
            return;
        }

        // loyaltyEnrolled já aqui, e não só no api.js: a aba Fidelidade filtra
        // o clube por este campo (fidelidade.js), então sem ele o cliente
        // recém-cadastrado só apareceria no clube depois de recarregar a
        // página. Adesão automática é a regra — ver docs/25_fidelidade.sql.
        const newCli = {
            id: 'cli-' + Date.now(),
            name, phone, instagram, birth, frequency, notes,
            lastVisit: null,
            loyaltyEnrolled: true
        };
        data.clients.push(newCli);
        showToast("Cliente cadastrado com sucesso!", "success");
    }

    saveData(STATE_KEYS.CLIENTS, data.clients);
    closeModal('modal-client');

    // Reload active page data
    const activePage = document.querySelector('.menu-item.active').getAttribute('data-target');
    renderPageData(activePage);
});

// Substitui as tags das mensagens de WhatsApp.
//
// Uma função só para TODAS as mensagens (retorno, agendamento, aniversário,
// cobrança de parcela, aviso de fidelidade). Antes cada uma resolvia as suas
// tags: a de agendamento trocava {dia} e {link}, a de retorno só {nome}.
// Resultado — o cliente sumido recebia a mensagem com "{link}" escrito
// literalmente, sem link nenhum. Tag que funciona numa mensagem e não na outra
// é surpresa que chega ao cliente final.
//
// As tags de {nome}, {salao}, {dia} e {link} valem em qualquer mensagem. As
// específicas de uma delas ({parcela}, {valor}, {beneficio}...) chegam em
// `dados`: cada chave do objeto vira uma tag com o mesmo nome. Assim a
// mensagem de cobrança e a de fidelidade não precisam de uma função de
// substituição própria — que é exatamente como o bug acima nasceu.
function aplicarTagsWhatsApp(texto, dados) {
    const info = dados || {};
    const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
        'quinta-feira', 'sexta-feira', 'sábado'];

    const slug = (data.businessInfo && data.businessInfo.slug) || '';
    // Sem slug o link sairia como "https://dominio/", que não leva a lugar
    // nenhum. Melhor mandar a mensagem sem o link do que com um link quebrado.
    const link = slug ? getPublicBookingUrl(slug) : '';

    const salao = (data.businessInfo && data.businessInfo.name) || '';

    let saida = String(texto || '')
        .replace(/\{nome\}/gi, info.nome || '')
        .replace(/\{salao\}/gi, salao)
        .replace(/\{sal[ãa]o\}/gi, salao)   // aceita com e sem til: quem digita à mão usa os dois
        .replace(/\{dia\}/gi, diasSemana[new Date().getDay()])
        .replace(/\{link\}/gi, link);

    // Tags extras da mensagem que está sendo montada. Só nomes simples entram,
    // para uma chave inesperada nunca virar pedaço de expressão regular.
    Object.keys(info).forEach(chave => {
        if (chave === 'nome' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(chave)) return;
        saida = saida.replace(new RegExp('\\{' + chave + '\\}', 'gi'), String(info[chave] ?? ''));
    });

    return saida
        .replace(/[ \t]+\n/g, '\n')   // sobra de espaço quando uma tag some
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

/* ==========================================================================
   BASE DE CÁLCULO DA DISPONIBILIDADE

   Duas regras decidem se um horário pode ser oferecido:

     1. o salão está aberto naquele dia e naquela faixa  -> funcionamentoDoDia
     2. o profissional não bloqueou aquele horário       -> profissionalBloqueado

   Ambas ficam aqui, e não dentro da tela, porque valem em TRÊS lugares: a
   grade do link público, o lançamento manual de agendamento e o simulador das
   Configurações. Quando essa conta estava espalhada, as telas divergiam.

   ⚠️ Isto é o que a tela mostra. Quem GARANTE a regra é o servidor, em
   create_public_booking (docs/add_disponibilidade.sql): a grade roda no
   navegador do cliente e o endpoint público aceita qualquer requisição.
   ========================================================================== */

// Usado quando o salão ainda não configurou nada. Mantém o comportamento
// antigo (9h às 19h) para não fechar a agenda de quem já estava usando.
const FUNCIONAMENTO_PADRAO = { aberto: true, abre: '09:00', fecha: '19:00' };

function minutosDoHorario(hhmm) {
    const partes = String(hhmm || '').split(':');
    const h = parseInt(partes[0], 10);
    const m = parseInt(partes[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

// dateStr no formato YYYY-MM-DD. Constrói a data com os componentes separados:
// new Date('2026-08-09') seria lida como UTC e, no fuso do Brasil, cairia no
// dia anterior — o sábado viraria sexta.
function diaDaSemanaDaData(dateStr) {
    const p = String(dateStr || '').split('-');
    if (p.length !== 3) return new Date().getDay();
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay();
}

function funcionamentoDoDia(dateStr) {
    const hours = (data.businessInfo && data.businessInfo.hours) || null;
    const dia = hours ? hours[String(diaDaSemanaDaData(dateStr))] : null;
    if (!dia) return { ...FUNCIONAMENTO_PADRAO };
    return {
        aberto: dia.aberto !== false,
        abre: dia.abre || FUNCIONAMENTO_PADRAO.abre,
        fecha: dia.fecha || FUNCIONAMENTO_PADRAO.fecha
    };
}

// Sobreposição de faixas: (inícioA < fimB) E (fimA > inícioB).
// Bloqueio sem horário de início vale para o dia inteiro.
function profissionalBloqueado(profId, dateStr, inicioMin, fimMin) {
    return (data.professionalBlocks || []).some(b => {
        if (b.profId !== profId || b.date !== dateStr) return false;
        if (!b.startTime) return true;
        const bIni = minutosDoHorario(b.startTime);
        const bFim = minutosDoHorario(b.endTime) ?? (24 * 60 - 1);
        if (bIni === null) return true;
        return inicioMin < bFim && fimMin > bIni;
    });
}

/* --- Grade de horários de um profissional num dia --------------------------
   Estava dentro da renderização do link público, na closure checkSlotsForDate.
   Saiu para cá quando o encaixe do balcão passou a fazer a mesma pergunta —
   "que horário está livre?" — e duas telas com a mesma pergunta não podem ter
   duas respostas.

   `antecedenciaMin` é o que separa os dois usos: o link público exige 2h de
   folga (o cliente ainda vai se deslocar), o encaixe usa 0 porque a pessoa já
   está na loja. */
function gradeDoProfissional(profId, dateStr, duracaoMin, opcoes) {
    const cfg = opcoes || {};
    const antecedencia = cfg.antecedenciaMin === undefined ? 120 : cfg.antecedenciaMin;
    const slots = [];
    let temVaga = false;

    // Dia fechado: devolve a grade vazia. Quem chama já sabe procurar o
    // próximo dia com vaga.
    const expediente = funcionamentoDoDia(dateStr);
    if (!expediente.aberto) return { slots, temVaga, fechado: true };

    const abre = minutosDoHorario(expediente.abre) ?? 9 * 60;
    const fecha = minutosDoHorario(expediente.fecha) ?? 19 * 60;
    const duracao = parseInt(duracaoMin, 10) || 30;

    const agora = new Date();
    const hojeStr = getLocalDateString(agora);
    const minutoMinimo = agora.getHours() * 60 + agora.getMinutes() + antecedencia;

    const ocupados = (data.appointments || []).filter(a =>
        a.profId === profId && a.date === dateStr && a.status !== 'cancelled'
    ).map(a => {
        const srv = (data.services || []).find(s => s.id === a.serviceId) || { duration: 30 };
        const ini = minutosDoHorario(a.time) || 0;
        return { ini, fim: ini + (parseInt(srv.duration, 10) || 30) };
    });

    // De 30 em 30 minutos, dentro do expediente do dia. O passo é fixo; o que
    // varia é o começo e o fim.
    for (let ini = abre; ini < fecha; ini += 30) {
        const fim = ini + duracao;
        const hhmm = `${String(Math.floor(ini / 60)).padStart(2, '0')}:${String(ini % 60).padStart(2, '0')}`;

        // O atendimento inteiro precisa caber antes de fechar — não basta
        // começar antes. Um corte de 40min às 18:30 terminaria 19:10, com a
        // barbearia já fechada.
        let livre = fim <= fecha;

        // sobreposição de horários: (inicioA < fimB) E (fimA > inicioB)
        if (livre && ocupados.some(o => ini < o.fim && fim > o.ini)) livre = false;

        // folga, médico, viagem: marcado pelo próprio profissional
        if (livre && profissionalBloqueado(profId, dateStr, ini, fim)) livre = false;

        if (livre && dateStr === hojeStr && ini < minutoMinimo) livre = false;

        slots.push({ time: hhmm, available: livre });
        if (livre) temVaga = true;
    }
    return { slots, temVaga, fechado: false };
}

/* --- Primeiro horário livre do dia -----------------------------------------
   Varre os profissionais ativos e devolve o mais cedo entre todos. É o que faz
   o encaixe ser um toque só: quem está no balcão não decide nada, com o
   cliente esperando em pé.

   Passe `profId` em `opcoes` para restringir a um profissional. */
function primeiroHorarioLivre(dateStr, duracaoMin, opcoes) {
    const cfg = opcoes || {};
    const candidatos = (data.professionals || [])
        .filter(p => p.active && (!cfg.profId || p.id === cfg.profId));

    let melhor = null;
    for (const prof of candidatos) {
        const grade = gradeDoProfissional(prof.id, dateStr, duracaoMin, cfg);
        const vaga = grade.slots.find(s => s.available);
        if (!vaga) continue;
        // "HH:MM" com zero à esquerda compara certo como texto.
        if (!melhor || vaga.time < melhor.time) {
            melhor = { time: vaga.time, profId: prof.id, profNome: prof.name };
        }
    }
    return melhor;
}

const NOMES_DOS_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Desenha a grade de funcionamento nas Configurações a partir do que está
// salvo. Sem nada salvo, propõe o padrão da barbearia: fechada no domingo,
// 9h-19h de segunda a sexta e 9h-15h no sábado.
function renderHorarioFuncionamento() {
    const grid = document.getElementById('biz-hours-grid');
    if (!grid) return;

    const salvos = (data.businessInfo && data.businessInfo.hours) || {};
    grid.innerHTML = NOMES_DOS_DIAS.map((nome, i) => {
        const padrao = i === 0 ? { aberto: false, abre: '09:00', fecha: '19:00' }
            : i === 6 ? { aberto: true, abre: '09:00', fecha: '15:00' }
                : { aberto: true, abre: '09:00', fecha: '19:00' };
        const dia = salvos[String(i)] || padrao;
        const aberto = dia.aberto !== false;
        // checkbox-container/checkmark é o padrão do app — o input nativo
        // aparece com o azul do navegador e destoa do resto da interface.
        return `
            <div class="hour-day-row" data-dia="${i}">
                <label class="checkbox-container hour-day-toggle">
                    <input type="checkbox" class="hour-open" ${aberto ? 'checked' : ''} onchange="alternarDiaDeFuncionamento(${i})">
                    <span class="checkmark"></span>
                    ${nome}
                </label>
                <div class="hour-times" ${aberto ? '' : 'hidden'}>
                    <input type="time" class="form-control inline-time hour-from" value="${escapeHTML(dia.abre || '09:00')}">
                    <span class="hour-sep">até</span>
                    <input type="time" class="form-control inline-time hour-to" value="${escapeHTML(dia.fecha || '19:00')}">
                </div>
                <span class="hour-fechado" ${aberto ? 'hidden' : ''}>Fechado</span>
            </div>`;
    }).join('');
}

// Desmarcar o dia esconde os horários e mostra "Fechado". Deixar os campos à
// vista num dia fechado passa a impressão de que aquele valor vale para
// alguma coisa. Os valores continuam no DOM, então remarcar o dia devolve o
// que estava lá — ninguém precisa redigitar por engano.
window.alternarDiaDeFuncionamento = function (i) {
    const linha = document.querySelector(`#biz-hours-grid .hour-day-row[data-dia="${i}"]`);
    if (!linha) return;
    const aberto = linha.querySelector('.hour-open').checked;
    linha.querySelector('.hour-times').hidden = !aberto;
    linha.querySelector('.hour-fechado').hidden = aberto;
};

// Lê a grade da tela. Devolve null se a grade não estiver montada, para o
// salvamento não zerar o horário de quem nunca abriu essa aba.
function lerHorarioFuncionamento() {
    const linhas = document.querySelectorAll('#biz-hours-grid .hour-day-row');
    if (!linhas.length) return null;
    const hours = {};
    linhas.forEach(linha => {
        const i = linha.dataset.dia;
        hours[i] = {
            aberto: linha.querySelector('.hour-open').checked,
            abre: linha.querySelector('.hour-from').value || '09:00',
            fecha: linha.querySelector('.hour-to').value || '19:00'
        };
    });
    return hours;
}

function bloqueiosDoProfissional(profId) {
    return (data.professionalBlocks || [])
        .filter(b => b.profId === profId)
        .sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
}

function descricaoDoBloqueio(b) {
    if (!b.startTime) return 'Dia inteiro';
    return `${b.startTime} às ${b.endTime || '23:59'}`;
}

// Só de hoje em diante: bloqueio vencido não interessa mais a ninguém e a
// lista viraria um histórico interminável.
function bloqueiosFuturos(profId) {
    const hoje = getLocalDateString(new Date());
    return bloqueiosDoProfissional(profId).filter(b => b.date >= hoje);
}

// O cliente digita o próprio nome no agendamento e costuma mandar tudo em
// maiúsculas ("MARIA DA SILVA"). Guardamos como foi digitado, mas em mensagem
// e em tela usamos só o primeiro nome, com a caixa arrumada.
function primeiroNomeApresentavel(nomeCompleto) {
    const primeiro = String(nomeCompleto || '').trim().split(/\s+/)[0] || '';
    if (!primeiro) return '';
    return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

// Modelo da mensagem de aniversário. Fica numa função só para que a tela de
// Configurações e o botão "Parabéns" do painel nunca mostrem textos diferentes
// — foi o que já aconteceu com a mensagem de retorno.
const MSG_ANIVERSARIO_PADRAO =
    'Olá {nome}! A equipe do {salao} quer te desejar um Feliz Aniversário! 🎉 Que seu dia seja muito especial.';

function mensagemDeAniversario() {
    return (data.businessInfo && data.businessInfo.whatsappBirthdayMessage) || MSG_ANIVERSARIO_PADRAO;
}

// --- WhatsApp CRM Simulator Modal ---
function openWhatsAppCRMSimulator(clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return;

    const modelo = data.businessInfo.whatsappRecallMessage ||
        "Olá {nome}! Tudo bem? Vimos que faz um tempinho que você não nos visita... {link}";
    // Primeiro nome, e não o nome completo: "Olá Maria!" soa como conversa,
    // "Olá MARIA DA SILVA!" soa como cobrança.
    const draftText = aplicarTagsWhatsApp(modelo, { nome: primeiroNomeApresentavel(client.name) });

    if (/\{link\}/i.test(modelo) && !(data.businessInfo && data.businessInfo.slug)) {
        showToast('A mensagem usa {link}, mas o link de agendamento ainda não foi configurado em Configurações.', 'warning');
    }

    // Set link for WhatsApp Web/App
    const whatsappPhone = client.phone.replace(/\D/g, ''); // leave only numbers
    const encodedMsg = encodeURIComponent(draftText);

    // Open directly in a new tab
    window.open(`https://wa.me/55${whatsappPhone}?text=${encodedMsg}`, '_blank');
}

// --- 4. KANBAN LEADS BOARD ---
function renderLeadsKanban() {
    const searchQuery = document.getElementById('input-search-leads').value.toLowerCase();
    const stages = ['new', 'talking', 'link_sent', 'scheduled', 'follow_up', 'lost'];

    // Track active mobile stage tab
    if (!window.mobileSelectedLeadStage) {
        window.mobileSelectedLeadStage = 'new';
    }

    // Populate mobile leads tabs header
    const mobileLeadsTabs = document.getElementById('mobile-leads-tabs');
    if (mobileLeadsTabs) {
        mobileLeadsTabs.innerHTML = '';
        const stageNames = {
            new: 'Novos',
            talking: 'Conversa',
            link_sent: 'Enviados',
            scheduled: 'Agendados',
            follow_up: 'Retorno',
            lost: 'Perdidos'
        };
        stages.forEach(stage => {
            const count = data.leads.filter(l => l.stage === stage &&
                (l.name.toLowerCase().includes(searchQuery) || l.phone.includes(searchQuery))
            ).length;

            const btn = document.createElement('button');
            btn.className = `kanban-tab-btn ${window.mobileSelectedLeadStage === stage ? 'active' : ''}`;
            btn.innerHTML = `${stageNames[stage]} <span class="tab-badge">${count}</span>`;
            btn.addEventListener('click', () => {
                window.mobileSelectedLeadStage = stage;
                renderLeadsKanban();
            });
            mobileLeadsTabs.appendChild(btn);
        });
    }

    // Reset columns HTML and counters
    stages.forEach(stage => {
        const container = document.getElementById(`container-stage-${stage}`);
        container.innerHTML = '';
        document.getElementById(`badge-stage-${stage.replace(/_/g, '-')}`).innerText = '0';
    });

    let counts = { new: 0, talking: 0, link_sent: 0, scheduled: 0, follow_up: 0, lost: 0 };

    // Filter and distribute leads
    const filteredLeads = data.leads.filter(l => l.name.toLowerCase().includes(searchQuery) || l.phone.includes(searchQuery));

    filteredLeads.forEach(lead => {
        const container = document.getElementById(`container-stage-${lead.stage}`);
        if (!container) return;

        counts[lead.stage]++;
        document.getElementById(`badge-stage-${lead.stage.replace(/_/g, '-')}`).innerText = counts[lead.stage];

        const card = document.createElement('div');
        card.className = 'kanban-card';
        card.draggable = true;
        card.setAttribute('data-lead-id', lead.id);

        card.innerHTML = `
            <div class="lead-card-header">
                <span class="lead-card-title">${escapeHTML(lead.name)}</span>
                <i class="fa-brands fa-${escapeHTML(lead.source)} lead-source-icon ${escapeHTML(lead.source)}" title="Origem: ${escapeHTML(lead.source)}"></i>
            </div>
            <div class="lead-card-body">${escapeHTML(lead.notes || 'Sem observações.')}</div>
            <div class="lead-card-footer">
                <span class="lead-card-date">${formatDateStringToBR(lead.date)}</span>
                <div class="lead-card-actions">
                    <button class="btn-card-action" onclick="openEditLead('${lead.id}')" title="Editar Lead"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-card-action" onclick="moveLeadRight('${lead.id}')" title="Avançar coluna"><i class="fa-solid fa-arrow-right"></i></button>
                </div>
            </div>
        `;

        // HTML5 Drag and Drop events
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', lead.id);
            card.style.opacity = '0.5';
        });

        card.addEventListener('dragend', () => {
            card.style.opacity = '1';
        });

        container.appendChild(card);
    });

    // Add dragover and drop events to columns, and apply mobile visibility toggles
    const columns = document.querySelectorAll('.kanban-column');
    columns.forEach(col => {
        const colStage = col.getAttribute('data-stage');

        // Mobile layout visibility
        if (window.mobileSelectedLeadStage === colStage) {
            col.classList.add('active-mobile-col');
        } else {
            col.classList.remove('active-mobile-col');
        }

        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            col.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
        });

        col.addEventListener('dragleave', () => {
            col.style.backgroundColor = '';
        });

        col.addEventListener('drop', (e) => {
            e.preventDefault();
            col.style.backgroundColor = '';
            const leadId = e.dataTransfer.getData('text/plain');
            const targetStage = col.getAttribute('data-stage');
            if (leadId && targetStage) {
                changeLeadStage(leadId, targetStage);
            }
        });
    });
}

// Search leads event
document.getElementById('input-search-leads').addEventListener('input', renderLeadsKanban);

function changeLeadStage(leadId, targetStage) {
    const idx = data.leads.findIndex(l => l.id === leadId);
    if (idx !== -1) {
        const oldStage = data.leads[idx].stage;
        data.leads[idx].stage = targetStage;
        saveData(STATE_KEYS.LEADS, data.leads);

        // Show success alert
        showToast(`Lead "${data.leads[idx].name}" movido para ${translateLeadStage(targetStage)}!`, 'info');

        // Render
        renderLeadsKanban();
    }
}

// Easy move button helper
function moveLeadRight(id) {
    const lead = data.leads.find(l => l.id === id);
    if (!lead) return;

    const stages = ['new', 'talking', 'link_sent', 'scheduled', 'follow_up', 'lost'];
    const currentIdx = stages.indexOf(lead.stage);

    if (currentIdx !== -1 && currentIdx < stages.length - 1) {
        changeLeadStage(id, stages[currentIdx + 1]);
    }
}

document.getElementById('btn-add-lead').addEventListener('click', () => {
    document.getElementById('lead-modal-title').innerText = 'Novo Lead';
    document.getElementById('lead-id').value = '';
    document.getElementById('btn-delete-lead').style.display = 'none';
    openModal('modal-lead');
});

function openEditLead(id) {
    const lead = data.leads.find(l => l.id === id);
    if (!lead) return;

    document.getElementById('lead-modal-title').innerText = 'Editar Lead';
    document.getElementById('lead-id').value = lead.id;
    document.getElementById('lead-name').value = lead.name;
    document.getElementById('lead-phone').value = lead.phone;
    document.getElementById('lead-source').value = lead.source;
    document.getElementById('lead-stage').value = lead.stage;
    document.getElementById('lead-notes').value = lead.notes || '';

    document.getElementById('btn-delete-lead').style.display = 'block';
    openModal('modal-lead');
}

// Lead form submit
document.getElementById('form-lead').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('lead-id').value;
    const name = document.getElementById('lead-name').value;
    const phone = document.getElementById('lead-phone').value;
    const source = document.getElementById('lead-source').value;
    const stage = document.getElementById('lead-stage').value;
    const notes = document.getElementById('lead-notes').value;

    if (id) {
        // edit
        const idx = data.leads.findIndex(l => l.id === id);
        data.leads[idx] = { ...data.leads[idx], name, phone, source, stage, notes };
        showToast("Lead atualizado!", "success");
    } else {
        // create
        const newLead = {
            id: 'lead-' + Date.now(),
            name, phone, source, stage, notes,
            date: getLocalDateString(currentSelectedDate)
        };
        data.leads.push(newLead);
        showToast("Novo lead adicionado!", "success");
    }

    saveData(STATE_KEYS.LEADS, data.leads);
    closeModal('modal-lead');
    renderLeadsKanban();
});

// Delete lead
document.getElementById('btn-delete-lead').addEventListener('click', () => {
    const id = document.getElementById('lead-id').value;
    if (id) {
        data.leads = data.leads.filter(l => l.id !== id);
        saveData(STATE_KEYS.LEADS, data.leads);
        if (typeof DataService !== 'undefined' && DataService.deleteItem) {
            DataService.deleteItem('leads', id).catch(console.error);
        }
        showToast("Lead excluído.", "warning");
        closeModal('modal-lead');
        renderLeadsKanban();
    }
});

// --- 5. FINANCE COMPONENT ---
let currentFinanceProfId = 'all';
let currentFinancePeriod = 'monthly'; // 'daily', 'weekly', 'monthly'

window.setFinancePeriodFilter = function (period) {
    currentFinancePeriod = period;
    voltarAPrimeiraPagina('financeiro');
    renderFinance();
}

function setFinanceProfFilter(profId) {
    currentFinanceProfId = profId;
    voltarAPrimeiraPagina('financeiro');
    renderFinance();
}

// --- BASE DE CÁLCULO DO FINANCEIRO ------------------------------------------
// Estas funções existem para que tela, extrato do dia e extrato do período
// respondam exatamente a mesma coisa. Cada regra duplicada aqui vira um número
// diferente em algum lugar, e o cliente não tem como saber qual está certo.

// Quando o lançamento ENTROU no caixa — que não é a mesma coisa que a data do
// atendimento. Confirmar hoje o pagamento de um corte de ontem põe dinheiro na
// gaveta hoje, e é hoje que ele precisa aparecer.
// Lançamentos antigos não têm o carimbo: caem no meio-dia da data de
// competência, que é o palpite menos pior.
function momentoDoLancamento(t) {
    if (t.registradoEm) return t.registradoEm;
    return (t.date || '') + 'T12:00:00.000Z';
}

// Um atendimento entra em comissão e ticket médio quando o pagamento foi
// confirmado. Antes exigia também status "Concluído", e isso zerava tudo: quem
// confirma o pagamento pelo painel não volta na agenda para marcar o
// atendimento como concluído, então a comissão nunca aparecia.
function atendimentoRealizado(a) {
    if (a.paymentStatus !== 'paid') return false;
    return a.status !== 'cancelled' && a.status !== 'no_show';
}

// Comissão de um atendimento, pelo percentual do profissional.
function comissaoDoAtendimento(a) {
    const srv = data.services.find(function (s) { return s.id === a.serviceId; });
    const prof = data.professionals.find(function (p) { return p.id === a.profId; });
    if (!srv || !prof || !prof.commission) return 0;
    return (Number(srv.price) || 0) * (Number(prof.commission) / 100);
}

// Saldo em gaveta de um caixa. Conta o dinheiro pelo momento em que foi
// lançado, não pela data do atendimento — senão o pagamento de ontem
// confirmado hoje some da gaveta de hoje.
function pertenceAoCaixa(t, caixa) {
    const abertura = caixa.dateOpened;
    const fechamento = caixa.dateClosed || null;

    if (t.registradoEm) {
        if (t.registradoEm < abertura) return false;
        if (fechamento && t.registradoEm > fechamento) return false;
        return true;
    }

    // Lançamento antigo, anterior ao carimbo de horário: mantém a regra por
    // data que já valia, para não mudar saldo de caixa que o dono já conferiu.
    const diaAbertura = abertura.substring(0, 10);
    if ((t.date || '') < diaAbertura) return false;
    if (fechamento && (t.date || '') > fechamento.substring(0, 10)) return false;
    return true;
}

/* O sistema tem DOIS códigos para a mesma coisa. As telas antigas (agendamento,
   Financeiro, o modal de movimento do Estoque) gravam `dinheiro`; o checkout
   novo da aba Vendas (Evolução de Vendas, script 15) grava `cash` — é o
   valor que a RPC finalizar_venda espera e devolve em `transactions.paymentMethod`
   sem tradução nenhuma. Comparar só com `dinheiro` deixa todo recebimento em
   espécie do checkout novo fora da gaveta: o dono confere o caixa e sobra
   dinheiro que o sistema não explica. */
function ehPagamentoEmDinheiro(metodo) {
    return metodo === 'cash' || metodo === 'dinheiro';
}

function resumoDaGaveta(caixa) {
    const inicial = caixa ? (parseFloat(caixa.initialCash) || 0) : 0;
    if (!caixa || !caixa.dateOpened) {
        return { inicial: inicial, entradas: 0, saidas: 0, saldo: inicial };
    }

    let entradas = 0;
    let saidas = 0;
    data.transactions.forEach(function (t) {
        if (!ehPagamentoEmDinheiro(t.paymentMethod)) return;
        if (!pertenceAoCaixa(t, caixa)) return;
        if (t.type === 'income') entradas += t.amount;
        else saidas += t.amount;
    });

    return { inicial: inicial, entradas: entradas, saidas: saidas, saldo: inicial + entradas - saidas };
}

function renderFinance() {
    const profFiltersContainer = document.getElementById('finance-prof-filters');
    if (profFiltersContainer) {
        profFiltersContainer.innerHTML = '';
        const btnGeral = document.createElement('button');
        btnGeral.className = `btn ${currentFinanceProfId === 'all' ? 'btn-primary' : 'btn-secondary'}`;
        btnGeral.innerText = 'Geral (Todos)';
        btnGeral.onclick = () => setFinanceProfFilter('all');
        profFiltersContainer.appendChild(btnGeral);

        data.professionals.forEach(p => {
            const btn = document.createElement('button');
            btn.className = `btn ${currentFinanceProfId === p.id ? 'btn-primary' : 'btn-secondary'}`;
            btn.innerText = p.name;
            btn.onclick = () => setFinanceProfFilter(p.id);
            profFiltersContainer.appendChild(btn);
        });
    }

    // Update Period buttons CSS
    ['daily', 'weekly', 'monthly'].forEach(p => {
        const btn = document.getElementById('btn-period-' + p);
        if (btn) btn.className = `btn ${currentFinancePeriod === p ? 'btn-primary' : 'btn-secondary'}`;
    });

    const now = new Date();
    let startDate = new Date(now);
    if (currentFinancePeriod === 'daily') {
        startDate.setHours(0, 0, 0, 0);
    } else if (currentFinancePeriod === 'weekly') {
        startDate.setDate(now.getDate() - 7);
    } else if (currentFinancePeriod === 'monthly') {
        startDate.setDate(now.getDate() - 30);
    }
    const startDateStr = getLocalDateString(startDate);

    const filteredTransactions = data.transactions.filter(t => {
        const passProf = currentFinanceProfId === 'all' || t.profId === currentFinanceProfId;
        const passDate = t.date >= startDateStr;
        return passProf && passDate;
    });

    // 1. Calculate values
    let totalIn = 0;
    let totalOut = 0;

    filteredTransactions.forEach(t => {
        if (t.status !== 'pending') {
            if (t.type === 'income') totalIn += t.amount;
            else totalOut += t.amount;
        }
    });

    const netProfit = totalIn - totalOut;

    // Calculate ticket medio (done appts total spent / done appts count)
    const paidAppts = data.appointments.filter(a => {
        const passStatus = atendimentoRealizado(a);
        const passProf = currentFinanceProfId === 'all' || a.profId === currentFinanceProfId;
        const passDate = a.date >= startDateStr;
        return passStatus && passProf && passDate;
    });

    let ticketSum = 0;
    let totalCommission = 0;

    paidAppts.forEach(a => {
        const srv = data.services.find(s => s.id === a.serviceId);
        if (srv) {
            ticketSum += srv.price;
            const prof = data.professionals.find(p => p.id === a.profId);
            if (prof && prof.commission) {
                totalCommission += (srv.price * (prof.commission / 100));
            }
        }
    });
    const ticketMedio = paidAppts.length > 0 ? (ticketSum / paidAppts.length) : 0;

    // Calculate forecasted commission for unpaid appts in the future
    let forecastedCommission = 0;
    data.appointments.filter(a => a.paymentStatus !== 'paid' && a.status !== 'cancelled' && a.status !== 'no_show').forEach(a => {
        const passProf = currentFinanceProfId === 'all' || a.profId === currentFinanceProfId;
        const passDate = a.date >= startDateStr;
        if (passProf && passDate) {
            const srv = data.services.find(s => s.id === a.serviceId);
            const prof = data.professionals.find(p => p.id === a.profId);
            if (srv && prof && prof.commission) {
                forecastedCommission += (srv.price * (prof.commission / 100));
            }
        }
    });

    // Update displays
    document.getElementById('fin-total-income').innerText = formatCurrency(totalIn);
    document.getElementById('fin-total-expenses').innerText = formatCurrency(totalOut);

    const profitEl = document.getElementById('fin-net-profit');
    profitEl.innerText = formatCurrency(netProfit);
    if (netProfit >= 0) {
        profitEl.className = 'metric-value text-green';
    } else {
        profitEl.className = 'metric-value text-danger';
    }

    if (document.getElementById('fin-ticket-medio')) {
        document.getElementById('fin-ticket-medio').innerText = formatCurrency(ticketMedio);
    }

    // === Resumo do Dia: projeção (agenda) x gastos, ou comissão do profissional ===
    // Fica no Financeiro, não em Vendas: é uma ESTIMATIVA pela agenda, de
    // propósito diferente do "Total vendido hoje" (o que já foi realmente
    // vendido). Misturar os dois painéis é o que confunde o dono.
    const todayStr = getLocalDateString(new Date());
    const infoGeral = document.getElementById('cash-info-geral');
    const infoProf = document.getElementById('cash-info-prof');
    if (infoGeral && infoProf) {
        if (currentFinanceProfId === 'all') {
            infoGeral.style.display = 'flex';
            infoProf.style.display = 'none';

            // Daily revenue projection: sum of all services for today's appointments (not cancelled/no_show)
            let projRevenue = 0;
            data.appointments.filter(a => a.date === todayStr && a.status !== 'cancelled' && a.status !== 'no_show').forEach(a => {
                const srv = data.services.find(s => s.id === a.serviceId);
                if (srv) projRevenue += srv.price;
            });
            document.getElementById('cash-proj-revenue').innerText = formatCurrency(projRevenue);

            // Daily expenses: sum of today's expense transactions
            let dayExpenses = 0;
            data.transactions.filter(t => t.type === 'expense' && t.date === todayStr).forEach(t => {
                dayExpenses += t.amount;
            });
            document.getElementById('cash-day-expenses').innerText = formatCurrency(dayExpenses);

        } else {
            infoGeral.style.display = 'none';
            infoProf.style.display = 'flex';

            const prof = data.professionals.find(p => p.id === currentFinanceProfId);
            const commissionRate = prof && prof.commission ? prof.commission / 100 : 0;

            let profDayCommission = 0;
            const profTodayAppts = data.appointments.filter(a =>
                a.date === todayStr &&
                a.profId === currentFinanceProfId &&
                a.status !== 'cancelled' &&
                a.status !== 'no_show'
            );
            profTodayAppts.forEach(a => {
                const srv = data.services.find(s => s.id === a.serviceId);
                if (srv) profDayCommission += srv.price * commissionRate;
            });
            document.getElementById('cash-prof-commission-day').innerText = formatCurrency(profDayCommission);
            document.getElementById('cash-prof-appts-day').innerText = profTodayAppts.length;

            const monthStart = todayStr.substring(0, 7);
            let profMonthCommission = 0;
            data.appointments.filter(a =>
                a.date.startsWith(monthStart) &&
                a.profId === currentFinanceProfId &&
                a.status !== 'cancelled' &&
                a.status !== 'no_show'
            ).forEach(a => {
                const srv = data.services.find(s => s.id === a.serviceId);
                if (srv) profMonthCommission += srv.price * commissionRate;
            });
            document.getElementById('cash-prof-commission-month').innerText = formatCurrency(profMonthCommission);
        }
    }

    renderCaixaOperacional();

    // 2. Render Transaction List
    const tbody = document.getElementById('tbody-transactions');
    tbody.innerHTML = '';

    // Sort transactions by date descending
    const sortedTrans = [...filteredTransactions].sort((a, b) => b.date.localeCompare(a.date));

    renderPaginacao('transactions-pagination', 'financeiro', sortedTrans.length);
    fatiaDaPagina('financeiro', sortedTrans).forEach(t => {
        const tr = document.createElement('tr');
        const sign = t.type === 'income' ? '+' : '-';
        const cssClass = t.type === 'income' ? 'text-success' : 'text-danger';

        const profName = t.profId ? (data.professionals.find(p => p.id === t.profId)?.name || 'Desconhecido') : 'Barbearia (Geral)';
        const pendingBadge = t.status === 'pending' ? ' <span class="status-badge pending" style="background-color: var(--warning-light); color: var(--warning); padding: 2px 6px; font-size: 0.7rem; margin-left: 5px;">Pendente</span>' : '';
        tr.innerHTML = `
            <td data-label="Data">${formatDateStringToBR(t.date)}</td>
            <td data-label="Tipo"><span class="status-badge ${t.type === 'income' ? 'done' : 'no_show'}">${t.type === 'income' ? 'Entrada' : 'Saída'}</span>${pendingBadge}</td>
            <td data-label="Descrição">${escapeHTML(t.description)}</td>
            <td data-label="Profissional">${escapeHTML(profName)}</td>
            <td data-label="Forma de Pagto">${t.paymentMethod.toUpperCase()}</td>
            <td data-label="Valor" class="${cssClass}" style="font-weight: 700;">${sign} ${formatCurrency(t.amount)}</td>
            <td data-label="Ação" style="text-align: right;">
                <button class="btn-card-action" onclick="deleteTransaction('${t.id}')" title="Excluir Transação">
                    <i class="fa-solid fa-trash-can text-danger"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 3. Render HTML Custom Graphs (No canvas library needed, raw CSS layouts)
    renderServiceRevenueChart();
    renderPaymentMethodsChart();
    renderPendingPayments();
}

// Painel "Caixa do Dia": badge, saldo e os botões de abrir/fechar. Mora na
// aba Vendas desde a Fase C (é lá que a gaveta abre e fecha) — a leitura
// (projeção, gastos, comissão) ficou no Financeiro, em renderFinance().
//
// Esta função roda toda vez que qualquer uma das duas telas renderiza —
// renderFinance() chama para o badge não ficar desatualizado por lá também, e
// renderSales() chama para o painel não ficar preso no HTML estático
// ("Fechado", R$ 0,00) até algum evento avulso disparar renderFinance() por
// acaso.
function renderCaixaOperacional() {
    // Cash Register display logic
    const activeRegister = window.getCurrentCashRegister ? window.getCurrentCashRegister() : null;
    const badge = document.getElementById('cash-register-status-badge');
    const btnOpen = document.getElementById('btn-open-register');
    const btnClose = document.getElementById('btn-close-register');
    const balanceEl = document.getElementById('cash-register-balance');

    if (activeRegister) {
        badge.className = 'status-badge success';
        badge.innerText = 'Aberto';
        btnOpen.style.display = 'none';
        btnClose.style.display = 'inline-flex';

        balanceEl.innerText = formatCurrency(resumoDaGaveta(activeRegister).saldo);
    } else {
        badge.className = 'status-badge inactive';
        badge.innerText = 'Fechado';
        btnOpen.style.display = 'inline-flex';
        btnClose.style.display = 'none';
        balanceEl.innerText = '---';
    }

    if (typeof renderPendentesAntigos === 'function') renderPendentesAntigos();
}

// Atendimentos que já aconteceram e continuam sem pagamento confirmado.
//
// É a MESMA lista usada em dois lugares: o painel "Confirmar Pagamentos" e o
// bloqueio do fechamento de caixa. Elas precisam contar exatamente o mesmo,
// senão o painel diz "3 pendentes" e o caixa trava por um número diferente.
// Cortesia, cancelado e falta não contam — são as saídas para destravar um
// atendimento que nunca vai ser pago.
function pagamentosPendentesAte(momento) {
    const dataLimite = getLocalDateString(momento);
    const horaLimite = String(momento.getHours()).padStart(2, '0') + ':' + String(momento.getMinutes()).padStart(2, '0');

    return data.appointments.filter(appt => {
        if (appt.paymentStatus === 'paid' || appt.paymentStatus === 'free') return false;
        if (appt.status === 'cancelled' || appt.status === 'no_show') return false;

        // Concluído é sinal mais forte que o relógio: o atendimento já
        // acabou, então cobra agora — não importa se o horário marcado na
        // agenda ainda não tinha chegado (encaixe/"Chegou agora" concluído
        // antes do horário nominal, por exemplo).
        if (appt.status === 'done') return true;

        // O horário já passou?
        if (appt.date < dataLimite) return true;
        if (appt.date === dataLimite && appt.time < horaLimite) return true;
        return false;
    }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function renderPendingPayments() {
    const pendingList = document.getElementById('dash-pending-payments-list');
    if (pendingList) {
        pendingList.innerHTML = '';

        const now = new Date();
        const currentStr = getLocalDateString(now);

        const pendingAppts = pagamentosPendentesAte(now);

        if (pendingAppts.length === 0) {
            pendingList.innerHTML = `
                <div style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 15px;">
                    <i class="fa-solid fa-check text-success" style="margin-bottom: 8px; font-size: 20px; display: block;"></i>
                    Nenhum pagamento pendente!
                </div>
            `;
        } else {
            pendingAppts.slice(0, 5).forEach(appt => {
                const client = data.clients.find(c => c.id === appt.clientId) || { name: 'Cliente' };
                const service = data.services.find(s => s.id === appt.serviceId) || { price: 0 };

                const card = document.createElement('div');
                card.className = 'crm-alert-card';
                card.style.borderLeftColor = 'var(--warning)';
                card.innerHTML = `
                    <div class="crm-alert-text">
                        <strong>${escapeHTML(client.name)}</strong>
                        <span class="crm-alert-subtext">${appt.date === currentStr ? 'Hoje' : appt.date.split('-').reverse().join('/')} às ${appt.time} - Falta lançar ${formatCurrency(service.price)}</span>
                    </div>
                    <button class="btn btn-warning btn-sm" onclick="window.abrirCheckoutDoAtendimento('${appt.id}')">
                        Confirmar
                    </button>
                `;
                pendingList.appendChild(card);
            });
        }
    }
}

function renderServiceRevenueChart() {
    const chartBox = document.getElementById('chart-service-revenue');
    chartBox.innerHTML = '';

    // Calculate revenue per service
    let serviceRevenue = {};
    let totalServiceRevenue = 0;
    data.services.forEach(s => {
        serviceRevenue[s.name] = 0;
    });

    data.appointments.filter(a => a.paymentStatus === 'paid').forEach(a => {
        const srv = data.services.find(s => s.id === a.serviceId);
        if (srv) {
            serviceRevenue[srv.name] += srv.price;
            totalServiceRevenue += srv.price;
        }
    });

    // Find max value to calibrate bar widths
    const maxVal = Math.max(...Object.values(serviceRevenue), 1);

    // Sort services by revenue
    const sortedServices = Object.entries(serviceRevenue).sort((a, b) => b[1] - a[1]);

    sortedServices.forEach(([name, val], index) => {
        const widthPct = Math.round((val / maxVal) * 100);
        const pct = totalServiceRevenue > 0 ? Math.round((val / totalServiceRevenue) * 100) : 0;
        // Colors gradient index-based
        const colors = ['var(--primary)', 'var(--info)', '#6366f1', 'var(--warning)', 'var(--success)'];
        const barColor = colors[index % colors.length];

        const row = document.createElement('div');
        row.className = 'chart-bar-row';
        row.innerHTML = `
            <div class="chart-bar-labels">
                <span>${name} (${pct}%)</span>
                <strong>${formatCurrency(val)}</strong>
            </div>
            <div class="chart-bar-bg">
                <div class="chart-bar-fill" style="width: ${widthPct}%; background-color: ${barColor};"></div>
            </div>
        `;
        chartBox.appendChild(row);
    });
}

function renderPaymentMethodsChart() {
    const container = document.getElementById('chart-payment-methods');
    container.innerHTML = '';

    let payments = { pix: 0, cash: 0, credit_card: 0, debit_card: 0 };
    let totalPayments = 0;

    data.transactions.filter(t => t.type === 'income').forEach(t => {
        if (payments[t.paymentMethod] !== undefined) {
            payments[t.paymentMethod] += t.amount;
            totalPayments += t.amount;
        }
    });

    const labels = {
        pix: 'Pix',
        cash: 'Dinheiro',
        credit_card: 'Cartão de Crédito',
        debit_card: 'Cartão de Débito'
    };

    const colors = {
        pix: 'var(--success)',
        cash: 'var(--warning)',
        credit_card: 'var(--primary)',
        debit_card: 'var(--info)'
    };

    Object.entries(payments).forEach(([method, val]) => {
        const pct = totalPayments > 0 ? Math.round((val / totalPayments) * 100) : 0;

        const row = document.createElement('div');
        row.className = 'payment-method-row';
        row.innerHTML = `
            <span class="payment-method-label">
                <span class="payment-method-indicator" style="background-color: ${colors[method]};"></span>
                ${labels[method]} (${pct}%)
            </span>
            <strong>${formatCurrency(val)}</strong>
        `;
        container.appendChild(row);
    });
}

// Financial Add manual entries trigger
document.getElementById('btn-add-income').addEventListener('click', () => {
    openTransactionModal('income');
});

document.getElementById('btn-add-expense').addEventListener('click', () => {
    openTransactionModal('expense');
});

function openTransactionModal(type) {
    document.getElementById('trans-type').value = type;
    document.getElementById('transaction-modal-title').innerText = type === 'income' ? 'Registrar Entrada' : 'Registrar Saída';

    // Category select options depending on type
    const categorySelect = document.getElementById('trans-category');
    categorySelect.innerHTML = '';

    if (type === 'income') {
        categorySelect.innerHTML = `
            <option value="Serviço">Serviço</option>
            <option value="Produto">Venda de Produto</option>
            <option value="Outro">Outro</option>
        `;
    } else {
        categorySelect.innerHTML = `
            <option value="Aluguel">Aluguel</option>
            <option value="Estoque">Estoque / Suprimentos</option>
            <option value="Contas">Contas de Consumo</option>
            <option value="Comissão">Comissão de Parcerias</option>
            <option value="Marketing">Marketing / Tráfego</option>
            <option value="Outro">Outro</option>
        `;
    }

    // O bloco de produto acompanha a categoria escolhida.
    if (typeof atualizarBlocoDeProduto === 'function') atualizarBlocoDeProduto();

    document.getElementById('trans-date').value = getLocalDateString(currentSelectedDate);

    const profSelect = document.getElementById('trans-profId');
    if (profSelect) {
        profSelect.innerHTML = '<option value="">Barbearia (Geral)</option>';
        data.professionals.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = p.name;
            profSelect.appendChild(opt);
        });
    }

    openModal('modal-transaction');
}

document.getElementById('form-transaction').addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('trans-type').value;
    const amount = parseFloat(document.getElementById('trans-amount').value);
    const date = document.getElementById('trans-date').value;
    const description = document.getElementById('trans-description').value;
    const category = document.getElementById('trans-category').value;
    const paymentMethod = document.getElementById('trans-method').value;
    const profId = document.getElementById('trans-profId') ? document.getElementById('trans-profId').value : '';

    const activeRegister = window.getCurrentCashRegister ? window.getCurrentCashRegister() : null;
    let status = 'completed';
    if (!activeRegister && ehPagamentoEmDinheiro(paymentMethod)) {
        status = 'pending';
        showToast("Caixa fechado! Lançamento pendente.", "warning");
    } else {
        showToast("Transação registrada!", "success");
    }

    const newTrans = {
        id: 'tr-' + Date.now(),
        type, amount, date, description, category, paymentMethod, profId, status,
        // Instante do lançamento — o usuário pode datar a transação para outro
        // dia, mas na gaveta o dinheiro mexe agora.
        registradoEm: new Date().toISOString()
    };

    // Baixa no estoque, na mesma acao que registra o dinheiro.
    //
    // Quem mexe no estoque e registrarMovimento() (estoque.js), como em todas
    // as outras telas: e la que mora a regra de nao deixar negativo e o UPDATE
    // relativo que sobrevive a duas vendas ao mesmo tempo. Escrever
    // `prod.stock` aqui de novo criaria a segunda verdade.
    if (type === 'income' && category === 'Produto' && typeof registrarMovimento === 'function') {
        const prodId = document.getElementById('trans-produto').value;
        const qtd = parseInt(document.getElementById('trans-produto-qtd').value, 10) || 1;
        const clienteId = document.getElementById('trans-produto-cliente')?.value || '';
        const prod = (data.products || []).find(x => x.id === prodId);
        if (prod) {
            newTrans.productId = prod.id;
            newTrans.productQty = qtd;
            if (clienteId) newTrans.clientId = clienteId;

            registrarMovimento({
                productId: prod.id,
                type: 'out',
                qty: qtd,
                reason: 'venda',
                unitPrice: Number(prod.price) || 0,
                clientId: clienteId,
                profId: profId,
                transactionId: newTrans.id,
                date: date
            }).then(() => {
                if (typeof renderProdutos === 'function') renderProdutos();
                if (typeof renderDashboard === 'function') renderDashboard();
            }).catch(err => console.error('Falha ao baixar o estoque:', err));
        }
    }

    data.transactions.push(newTrans);
    saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
    closeModal('modal-transaction');
    renderFinance();
});

async function deleteTransaction(id) {
    if (!confirm("Deseja realmente excluir esta transação?")) return;

    const backup = [...data.transactions];
    data.transactions = data.transactions.filter(t => t.id !== id);
    saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
    renderFinance();

    try {
        if (typeof DataService !== 'undefined' && DataService.deleteItem) {
            await DataService.deleteItem('transactions', id);
        }
        showToast("Transação excluída.", "warning");
    } catch (err) {
        console.error("Erro ao excluir transação no servidor:", err);
        data.transactions = backup;
        saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
        renderFinance();
        showToast("Erro ao excluir transação na nuvem: " + (err.message || err), "danger");
    }
}
window.deleteTransaction = deleteTransaction;

// --- 6. CONFIGURATIONS COMPONENT ---
function renderConfig() {
    // 1. Services Tab
    const servicesGrid = document.getElementById('services-config-grid');
    servicesGrid.innerHTML = '';

    data.services.forEach(srv => {
        const card = document.createElement('div');
        card.className = 'item-config-card';
        card.innerHTML = `
            <div class="item-config-header">
                <div>
                    <span class="item-config-title">${escapeHTML(srv.name)}</span>
                    <span class="item-config-subtitle"><i class="fa-regular fa-clock"></i> Duração: ${srv.duration} min</span>
                </div>
                <button class="btn btn-icon btn-sm" onclick="openEditService('${srv.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="item-config-meta">
                <span class="item-price-tag">${formatCurrency(srv.price)}</span>
                <span class="item-status-tag ${srv.active ? 'active' : 'inactive'}">${srv.active ? 'Ativo' : 'Inativo'}</span>
            </div>
        `;
        servicesGrid.appendChild(card);
    });

    // 2. Professionals Tab
    renderProfissionaisGrid();
    // Sai pela rede: os cartões já foram desenhados sem o selo e ganham o selo
    // quando a resposta chega. Esperar aqui deixaria a aba em branco enquanto
    // a função responde.
    if (typeof carregarQuadroDeAcesso === 'function') carregarQuadroDeAcesso();

    // 3. Establishments Tab load fields
    document.getElementById('biz-name').value = data.businessInfo.name;
    document.getElementById('biz-slug').value = data.businessInfo.slug;
    document.getElementById('biz-phone').value = data.businessInfo.phone;
    document.getElementById('biz-instagram').value = data.businessInfo.instagram || '';
    document.getElementById('biz-address').value = data.businessInfo.address || '';
    if (document.getElementById('biz-type')) {
        document.getElementById('biz-type').value = data.businessInfo.business_type || data.businessInfo.businessType || 'barbearia';
    }
    if (document.getElementById('biz-primary-color')) {
        document.getElementById('biz-primary-color').value = data.businessInfo.primary_color || data.businessInfo.primaryColor || '#d4af37';
    }
    renderSeletorDeTema();
    const whatsappMsgElem = document.getElementById('biz-whatsapp-msg');
    if (whatsappMsgElem) {
        whatsappMsgElem.value = data.businessInfo.whatsappRecallMessage || 'Olá {nome}! Tudo bem? Vimos que faz um tempinho que você não nos visita...';
    }
    const birthdayMsgElem = document.getElementById('biz-whatsapp-birthday-msg');
    if (birthdayMsgElem) {
        birthdayMsgElem.value = mensagemDeAniversario();
    }
    renderHorarioFuncionamento();

    // Sub-aba "Link de Agendamento". Era uma aba própria do menu, com um
    // mockup de celular ao lado; sobrou o que o dono usa de verdade — o
    // endereço e a mensagem que acompanha o link, agora editável aqui mesmo.
    updatePublicUrlLabels(data.businessInfo.slug);
    const bookingMsgElem = document.getElementById('biz-whatsapp-booking-msg');
    if (bookingMsgElem) {
        bookingMsgElem.value = data.businessInfo.whatsappBookingMessage || 'Bom dia, agende seu horário para hoje {dia}, não deixe pra última hora 💈 {link}';
    }
    if (typeof populateBookingDraft === 'function') populateBookingDraft();

    // Sub-aba "Cobrança" (migration 26). Mesmo critério do aviso de
    // fidelidade: campo vazio no banco significa "nunca editado", e a tela
    // mostra o modelo de fábrica em vez de um textarea em branco.
    const chargeMsgElem = document.getElementById('biz-whatsapp-charge-msg');
    if (chargeMsgElem && document.activeElement !== chargeMsgElem) {
        chargeMsgElem.value = typeof modeloDeCobranca === 'function' ? modeloDeCobranca() : '';
    }
    if (typeof atualizarPreviaDaCobranca === 'function') atualizarPreviaDaCobranca();

    // Sub-aba "Fidelidade" (Fase F) — definida em fidelidade.js, carregado
    // depois deste arquivo, mas só é chamada aqui em tempo de execução.
    if (typeof renderConfigDaFidelidade === 'function') renderConfigDaFidelidade();
}

// Escolha do tema (claro ou escuro). Aplica no clique e só grava quando o
// formulário do estabelecimento é salvo — quem experimentar e desistir sai da
// tela sem ter mudado nada para a equipe.
function renderSeletorDeTema() {
    const caixa = document.getElementById('tema-opcoes');
    if (!caixa || !window.ThemeManager) return;

    const atual = window.ThemeManager.getMode();

    caixa.innerHTML = Object.values(window.ThemeManager.MODES).map(modo => `
        <button type="button" class="tema-opcao ${modo.id === atual ? 'tema-opcao-ativa' : ''}"
                data-tema="${escapeHTML(modo.id)}">
            <span class="tema-amostra" aria-hidden="true">
                ${modo.swatch.map(cor => `<span style="background:${escapeHTML(cor)};"></span>`).join('')}
            </span>
            <span class="tema-opcao-texto">
                <span class="tema-opcao-nome">
                    ${escapeHTML(modo.name)}
                    ${modo.id === atual ? '<i class="fa-solid fa-circle-check"></i>' : ''}
                </span>
                <span class="tema-opcao-desc">${escapeHTML(modo.description)}</span>
            </span>
        </button>
    `).join('');

    caixa.querySelectorAll('.tema-opcao').forEach(botao => {
        botao.addEventListener('click', () => {
            window.ThemeManager.applyMode(botao.getAttribute('data-tema'));

            // A cor da marca precisa ser recalculada junto: no tema claro ela é
            // escurecida para continuar legível sobre o bege, e voltar ao
            // escuro tem de devolver o tom original.
            const corEscolhida = document.getElementById('biz-primary-color')?.value
                || data.businessInfo.primary_color
                || data.businessInfo.primaryColor;
            if (corEscolhida) window.ThemeManager.applyColors(corEscolhida);

            renderSeletorDeTema();
            showToast('Tema aplicado. Salve os dados do estabelecimento para valer para a equipe.', 'info');
        });
    });
}

// Extraída de renderConfig() para poder ser chamada sozinha por
// carregarQuadroDeAcesso() — sem isso, cada resposta da Edge Function
// chamaria renderConfig() inteiro, que chamaria carregarQuadroDeAcesso() de
// novo, numa cadeia que nunca para.
function renderProfissionaisGrid() {
    const profsGrid = document.getElementById('professionals-config-grid');
    if (!profsGrid) return;
    profsGrid.innerHTML = '';

    data.professionals.forEach(prof => {
        const card = document.createElement('div');
        card.className = 'item-config-card';
        const profAvatar = prof.photoUrl
            ? `<img src="${escapeHTML(prof.photoUrl)}" alt="${escapeHTML(prof.name)}" style="width:44px; height:44px; border-radius:50%; object-fit:cover; border:2px solid var(--primary); flex-shrink:0;">`
            : `<div style="width:44px; height:44px; border-radius:50%; background:#64748b; color:#fff; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;"><i class="fa-solid fa-user"></i></div>`;
        card.innerHTML = `
            <div class="item-config-header">
                <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                    ${profAvatar}
                    <div style="min-width:0;">
                        <span class="item-config-title">${escapeHTML(prof.name)}</span>
                        ${prof.phone ? `<span class="item-config-subtitle"><i class="fa-solid fa-phone"></i> ${escapeHTML(prof.phone)}</span>` : ''}
                    </div>
                </div>
                <button class="btn btn-icon btn-sm" onclick="openEditProfessional('${prof.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="item-config-meta">
                <span class="item-price-tag">${prof.commission || 0}<i class="fa-solid fa-percent" style="margin-left: 2px;"></i> Comissão</span>
                <span class="item-status-tag ${prof.active ? 'active' : 'inactive'}">${prof.active ? 'Ativo' : 'Inativo'}</span>
            </div>
            ${typeof seloDeAcesso === 'function' ? seloDeAcesso(prof) : ''}
            <button class="btn btn-secondary btn-sm btn-full" style="margin-top:10px;" onclick="abrirIndisponibilidade('${prof.id}')">
                <i class="fa-regular fa-calendar-xmark"></i> Indisponibilidade${bloqueiosFuturos(prof.id).length ? ` (${bloqueiosFuturos(prof.id).length})` : ''}
            </button>
        `;
        profsGrid.appendChild(card);
    });
}

/* ----------------------------------------------------------------
   INDISPONIBILIDADE DO PROFISSIONAL
   ---------------------------------------------------------------- */
window.abrirIndisponibilidade = function (profId) {
    const prof = data.professionals.find(p => p.id === profId);
    if (!prof) return;

    document.getElementById('indisp-prof-id').value = profId;
    document.getElementById('indisp-prof-nome').innerText = prof.name;

    // Data já preenchida com hoje, e sem permitir passado: bloquear um dia que
    // já passou não muda nada na agenda.
    const hoje = getLocalDateString(new Date());
    const campoData = document.getElementById('indisp-data');
    campoData.value = hoje;
    campoData.min = hoje;

    document.getElementById('indisp-dia-inteiro').checked = true;
    document.getElementById('indisp-faixa').style.display = 'none';
    document.getElementById('indisp-motivo').value = '';

    renderListaDeIndisponibilidade(profId);
    openModal('modal-indisponibilidade');
};

function renderListaDeIndisponibilidade(profId) {
    const lista = document.getElementById('indisp-lista');
    if (!lista) return;

    const bloqueios = bloqueiosFuturos(profId);
    if (!bloqueios.length) {
        lista.innerHTML = '<p style="color:var(--text-muted); font-size:12px;">Nenhuma indisponibilidade marcada.</p>';
        return;
    }

    lista.innerHTML = bloqueios.map(b => `
        <div class="indisp-item">
            <div>
                <strong>${formatDateStringToBR(b.date)}</strong>
                <span class="indisp-faixa-texto">${escapeHTML(descricaoDoBloqueio(b))}</span>
                ${b.reason ? `<span class="indisp-motivo">${escapeHTML(b.reason)}</span>` : ''}
            </div>
            <button type="button" class="btn btn-icon btn-sm" title="Remover" onclick="removerIndisponibilidade('${b.id}')">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

document.getElementById('indisp-dia-inteiro')?.addEventListener('change', (e) => {
    document.getElementById('indisp-faixa').style.display = e.target.checked ? 'none' : 'flex';
});

document.getElementById('form-indisponibilidade')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const profId = document.getElementById('indisp-prof-id').value;
    const date = document.getElementById('indisp-data').value;
    const diaInteiro = document.getElementById('indisp-dia-inteiro').checked;
    const startTime = diaInteiro ? null : document.getElementById('indisp-inicio').value;
    const endTime = diaInteiro ? null : document.getElementById('indisp-fim').value;
    const reason = sanitizePlainText(document.getElementById('indisp-motivo').value);

    if (!date) return showToast('Escolha a data.', 'warning');
    if (!diaInteiro) {
        if (!startTime || !endTime) return showToast('Preencha os dois horários.', 'warning');
        if (minutosDoHorario(endTime) <= minutosDoHorario(startTime)) {
            return showToast('O horário final precisa ser maior que o inicial.', 'warning');
        }
    }

    // Avisa sobre agendamento já marcado dentro da faixa, mas não impede: quem
    // decide se remarca ou cancela é a barbearia, não o sistema.
    const ini = diaInteiro ? 0 : minutosDoHorario(startTime);
    const fim = diaInteiro ? 24 * 60 : minutosDoHorario(endTime);
    const conflitos = data.appointments.filter(a => {
        if (a.profId !== profId || a.date !== date || a.status === 'cancelled') return false;
        const srv = data.services.find(s => s.id === a.serviceId) || { duration: 30 };
        const aIni = minutosDoHorario(a.time);
        return aIni < fim && (aIni + (parseInt(srv.duration, 10) || 30)) > ini;
    });

    data.professionalBlocks.push({
        id: `blk-${Date.now()}`,
        profId, date, startTime, endTime,
        reason: reason || null
    });
    saveData(STATE_KEYS.PROFESSIONAL_BLOCKS, data.professionalBlocks);

    renderListaDeIndisponibilidade(profId);
    renderConfig();

    if (conflitos.length) {
        showToast(`Marcado. Atenção: já existe ${conflitos.length} agendamento nesse período — remarque com o cliente.`, 'warning');
    } else {
        showToast('Indisponibilidade marcada.', 'success');
    }
});

window.removerIndisponibilidade = function (id) {
    const alvo = data.professionalBlocks.find(b => b.id === id);
    if (!alvo) return;

    data.professionalBlocks = data.professionalBlocks.filter(b => b.id !== id);
    // A gravação normal é upsert do array inteiro, que NÃO apaga linha removida.
    // Por isso a exclusão vai direto na tabela.
    DataService.deleteItem('professional_blocks', id).catch(console.error);
    saveData(STATE_KEYS.PROFESSIONAL_BLOCKS, data.professionalBlocks);

    renderListaDeIndisponibilidade(alvo.profId);
    renderConfig();
    showToast('Indisponibilidade removida.', 'success');
};

// Subnavigation within config tabs
const configTabButtons = document.querySelectorAll('.config-subnav button');
configTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        configTabButtons.forEach(b => b.classList.remove('btn-active'));
        btn.classList.add('btn-active');

        const targetTab = btn.getAttribute('data-config-tab');
        const contents = document.querySelectorAll('.config-tab-content');

        contents.forEach(content => {
            content.style.display = 'none';
            content.classList.remove('active');
        });

        const activeContent = document.getElementById(`config-tab-${targetTab}`);
        if (activeContent) {
            activeContent.style.display = 'block';
            activeContent.classList.add('active');
        }
    });
});

// Config Form Submissions
// Biz Info (dados do estabelecimento + nome/foto do perfil na sidebar)
document.getElementById('form-business-info').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sanitizePlainText(document.getElementById('biz-name').value);
    const slug = sanitizeSlug(document.getElementById('biz-slug').value) || 'salao';
    const phone = sanitizePlainText(document.getElementById('biz-phone').value);
    const instagram = sanitizePlainText(document.getElementById('biz-instagram').value.replace(/^@/, ''));
    const address = sanitizePlainText(document.getElementById('biz-address').value);

    const whatsappMsgElem = document.getElementById('biz-whatsapp-msg');
    const whatsappRecallMessage = whatsappMsgElem ? whatsappMsgElem.value : '';

    const birthdayMsgElem = document.getElementById('biz-whatsapp-birthday-msg');
    const whatsappBirthdayMessage = birthdayMsgElem ? birthdayMsgElem.value : '';

    const businessType = document.getElementById('biz-type')?.value || 'barbearia';
    const primaryColor = document.getElementById('biz-primary-color')?.value || '#d4af37';
    // O tema já está aplicado na tela desde o clique; aqui ele entra no que
    // será gravado, para valer nos outros aparelhos e para a equipe.
    const theme = (window.ThemeManager && window.ThemeManager.getMode()) || 'escuro';

    data.businessInfo = {
        ...data.businessInfo,
        name, slug, phone, instagram, address,
        whatsappRecallMessage, whatsappBirthdayMessage,
        business_type: businessType,
        primary_color: primaryColor,
        theme: theme
    };

    if (window.ThemeManager) {
        window.ThemeManager.applyTheme(data.businessInfo);
    }

    // null = a grade não estava montada. Preservar o que já estava salvo é o
    // certo aqui: sobrescrever com {} fecharia a agenda da barbearia inteira.
    const hours = lerHorarioFuncionamento();
    if (hours) data.businessInfo.hours = hours;

    // Atualiza o endereço mostrado na sub-aba "Link de Agendamento"
    updatePublicUrlLabels(slug);

    // Nome e foto exibidos na sidebar
    if (name) {
        localStorage.setItem('lexion_biz_name', name);
    }
    const bizAvatarFile = document.getElementById('biz-avatar')?.files[0];
    if (bizAvatarFile) {
        // Pelo mesmo redimensionador das fotos de profissional. Antes daqui a
        // imagem ia para o banco no tamanho original, e essa é a coluna mais
        // pesada do sistema: ela viaja inteira para CADA cliente que abre o
        // link de agendamento (get_public_salon devolve o avatarUrl).
        resizeImageToDataURL(bizAvatarFile, 256, function (dataUrl) {
            data.businessInfo.avatarUrl = dataUrl;
            saveData(STATE_KEYS.BUSINESS_INFO, data.businessInfo);
            localStorage.setItem('lexion_biz_avatar', dataUrl);
            updateUserProfileUI();
            showToast("Dados do estabelecimento atualizados com foto!", "success");
        });
    } else {
        saveData(STATE_KEYS.BUSINESS_INFO, data.businessInfo);
        updateUserProfileUI();
        showToast("Dados do estabelecimento atualizados!", "success");
    }
});

// Mensagem de agendamento (sub-aba "Link de Agendamento"). Editada onde é
// usada — ficava em "Dados do Estabelecimento", o que obrigava a ir e voltar
// entre duas sub-abas para ver o efeito do que se acabou de escrever.
document.getElementById('form-booking-msg')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const campo = document.getElementById('biz-whatsapp-booking-msg');
    const texto = (campo.value || '').trim();

    // Vazio volta ao modelo de fábrica: uma mensagem em branco mandaria o
    // cliente um WhatsApp sem o link nenhum.
    const padrao = 'Bom dia, agende seu horário para hoje {dia}, não deixe pra última hora 💈 {link}';
    data.businessInfo = { ...data.businessInfo, whatsappBookingMessage: texto || null };
    saveData(STATE_KEYS.BUSINESS_INFO, data.businessInfo);

    campo.value = data.businessInfo.whatsappBookingMessage || padrao;
    if (typeof populateBookingDraft === 'function') populateBookingDraft();
    showToast(texto ? 'Mensagem de agendamento salva.' : 'Mensagem restaurada para o texto padrão.', 'success');
});

/* --- Mensagem de cobrança (sub-aba "Cobrança") ------------------------------
   A prévia usa uma parcela de exemplo em vez de uma parcela real do crediário:
   a aba precisa funcionar igual num salão que nunca vendeu fiado, e mostrar
   "{valor}" cru para quem ainda não tem dívida nenhuma esconderia justamente o
   que a pessoa está tentando conferir. */
const PARCELA_DE_EXEMPLO = { number: 2, open_amount: 120, due_date: null };

function atualizarPreviaDaCobranca() {
    const alvo = document.getElementById('cobranca-msg-preview');
    if (!alvo || typeof aplicarTagsWhatsApp !== 'function') return;

    const modelo = document.getElementById('biz-whatsapp-charge-msg')?.value || '';
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 5);

    const texto = aplicarTagsWhatsApp(modelo, {
        nome: 'Maria',
        parcela: PARCELA_DE_EXEMPLO.number,
        valor: formatCurrency(PARCELA_DE_EXEMPLO.open_amount),
        vencimento: formatDateStringToBR(getLocalDateString(vencimento))
    });

    alvo.innerText = texto || 'Escreva a mensagem acima para ver como ela fica.';
}

document.getElementById('biz-whatsapp-charge-msg')?.addEventListener('input', atualizarPreviaDaCobranca);

document.getElementById('form-cobranca-msg')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = (document.getElementById('biz-whatsapp-charge-msg').value || '').trim();

    // Vazio volta para o modelo de fábrica em vez de gravar string vazia: o
    // botão de cobrança sem texto nenhum abriria o WhatsApp em branco.
    data.businessInfo = { ...data.businessInfo, whatsappChargeMessage: texto || null };
    saveData(STATE_KEYS.BUSINESS_INFO, data.businessInfo);

    document.getElementById('biz-whatsapp-charge-msg').value = typeof modeloDeCobranca === 'function' ? modeloDeCobranca() : texto;
    atualizarPreviaDaCobranca();
    showToast(texto ? 'Mensagem de cobrança salva.' : 'Mensagem restaurada para o texto padrão.', 'success');
});

// Cloud Migration
document.getElementById('btn-migrate-supabase')?.addEventListener('click', async () => {
    const url = document.getElementById('supabase-url').value;
    const key = document.getElementById('supabase-anon-key').value;

    if (!url || !key) {
        showToast("Preencha a URL e a Anon Key do Supabase.", "warning");
        return;
    }

    // Solicitar email e senha do admin para a migração inicial
    const email = prompt("E-mail do Administrador (Supabase Auth):");
    const password = prompt("Senha do Administrador:");
    if (!email || !password) {
        showToast("É necessário e-mail e senha para autenticar a migração.", "warning");
        return;
    }

    try {
        const btn = document.getElementById('btn-migrate-supabase');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Conectando...';

        // Conecta e Loga no Supabase
        await DataService.connectAndLogin(url, key, email, password);

        // Se logou, iniciar a migração
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Migrando Dados...';
        await DataService.migrateToCloud(data);

        showToast("Migração concluída com sucesso! Sistema agora está na Nuvem.", "success");
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Migrado para a Nuvem';

    } catch (err) {
        console.error("Erro na migração:", err);
        showToast("Erro na migração: " + err.message, "danger");
        document.getElementById('btn-migrate-supabase').disabled = false;
        document.getElementById('btn-migrate-supabase').innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Iniciar Migração para a Nuvem';
    }
});
// Services CRUD
document.getElementById('btn-add-service').addEventListener('click', () => {
    document.getElementById('service-id').value = '';
    document.getElementById('form-service').reset();
    document.getElementById('btn-delete-service').style.display = 'none';
    openModal('modal-service');
});

function openEditService(id) {
    const srv = data.services.find(s => s.id === id);
    if (!srv) return;

    document.getElementById('service-id').value = srv.id;
    document.getElementById('service-name').value = srv.name;
    document.getElementById('service-price').value = srv.price;
    document.getElementById('service-duration').value = srv.duration;
    document.getElementById('service-active').checked = srv.active;

    document.getElementById('btn-delete-service').style.display = 'block';
    openModal('modal-service');
}

document.getElementById('form-service').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('service-id').value;
    const name = document.getElementById('service-name').value;
    const price = parseFloat(document.getElementById('service-price').value);
    const duration = parseInt(document.getElementById('service-duration').value);
    const active = document.getElementById('service-active').checked;

    if (id) {
        const idx = data.services.findIndex(s => s.id === id);
        // Espalha o serviço que já está em memória em vez de montar um objeto
        // novo: o cadastro na nuvem pode ter colunas que esta tela não edita, e
        // reconstruir do zero as apagaria do payload que sobe no upsert.
        data.services[idx] = { ...data.services[idx], id, name, price, duration, active };
        showToast("Serviço atualizado!", "success");
    } else {
        const newSrv = { id: 'srv-' + Date.now(), name, price, duration, active, packageCredits: 0 };
        data.services.push(newSrv);
        showToast("Serviço cadastrado com sucesso!", "success");
    }

    saveData(STATE_KEYS.SERVICES, data.services);
    closeModal('modal-service');
    renderConfig();
});

document.getElementById('btn-delete-service').addEventListener('click', () => {
    const id = document.getElementById('service-id').value;
    if (id) {
        data.services = data.services.filter(s => s.id !== id);
        saveData(STATE_KEYS.SERVICES, data.services);
        if (typeof DataService !== 'undefined' && DataService.deleteItem) {
            DataService.deleteItem('services', id).catch(console.error);
        }
        showToast("Serviço excluído.", "warning");
        closeModal('modal-service');
        renderConfig();
    }
});

// Professionals CRUD
document.getElementById('btn-add-professional').addEventListener('click', () => {
    document.getElementById('prof-id').value = '';
    document.getElementById('form-professional').reset();
    const photoPreview = document.getElementById('prof-photo-preview');
    if (photoPreview) {
        photoPreview.src = '';
        photoPreview.style.display = 'none';
    }
    document.getElementById('btn-delete-professional').style.display = 'none';
    if (typeof renderAcessoDoProfissional === 'function') renderAcessoDoProfissional('');
    openModal('modal-professional');
});

// Redimensiona uma imagem local para no máx. `maxSize`px e devolve como
// Data URL (base64) JPEG. Mantém o banco/link público leves. Em qualquer
// falha, cai de volta para o arquivo original sem quebrar o salvamento.
function resizeImageToDataURL(file, maxSize, callback) {
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            try {
                let width = img.width;
                let height = img.height;
                if (width > height && width > maxSize) {
                    height = Math.round(height * maxSize / width);
                    width = maxSize;
                } else if (height >= width && height > maxSize) {
                    width = Math.round(width * maxSize / height);
                    height = maxSize;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                callback(canvas.toDataURL('image/jpeg', 0.85));
            } catch (err) {
                console.warn('Falha ao redimensionar imagem, usando original.', err);
                callback(event.target.result);
            }
        };
        img.onerror = function () { callback(event.target.result); };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function openEditProfessional(id) {
    const prof = data.professionals.find(p => p.id === id);
    if (!prof) return;

    document.getElementById('prof-id').value = prof.id;
    document.getElementById('prof-name').value = prof.name;
    document.getElementById('prof-phone').value = prof.phone;
    document.getElementById('prof-commission').value = prof.commission || '';
    document.getElementById('prof-active').checked = prof.active;

    // O e-mail do login é a fonte mais confiável (vem de `auth.users`); o do
    // cadastro é a cópia. Divergem se a conta for trocada por fora do sistema.
    const acesso = typeof acessoDoProfissional === 'function' ? acessoDoProfissional(prof.id) : null;
    const campoEmail = document.getElementById('prof-email');
    if (campoEmail) campoEmail.value = (acesso && acesso.email) || prof.email || '';
    if (typeof renderAcessoDoProfissional === 'function') renderAcessoDoProfissional(prof.id);

    // Limpa o input de arquivo e exibe a prévia da foto atual (se houver)
    const photoInput = document.getElementById('prof-photo');
    if (photoInput) photoInput.value = '';
    const photoPreview = document.getElementById('prof-photo-preview');
    if (photoPreview) {
        if (prof.photoUrl) {
            photoPreview.src = prof.photoUrl;
            photoPreview.style.display = 'block';
        } else {
            photoPreview.src = '';
            photoPreview.style.display = 'none';
        }
    }

    document.getElementById('btn-delete-professional').style.display = 'block';
    openModal('modal-professional');
}

document.getElementById('form-professional').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('prof-id').value;
    const name = document.getElementById('prof-name').value;
    const phone = document.getElementById('prof-phone').value;
    const commission = parseFloat(document.getElementById('prof-commission').value) || 0;
    const active = document.getElementById('prof-active').checked;
    const photoFile = document.getElementById('prof-photo')?.files[0];

    // Preserva a foto atual se nenhum arquivo novo for anexado
    const existing = id ? data.professionals.find(p => p.id === id) : null;
    let photoUrl = existing ? (existing.photoUrl || '') : '';

    const email = (document.getElementById('prof-email')?.value || '').trim().toLowerCase();

    // Verificação de limite de profissionais do plano SaaS (para novos cadastros)
    if (!id && window.SaaSPlanManager) {
        const activeCount = (data.professionals || []).filter(p => p.active !== false).length;
        if (!window.SaaSPlanManager.checkCanAddProfessional(activeCount)) {
            return;
        }
    }

    const persistProfessional = () => {
        // `email` só entra no objeto quando a coluna existe. Sem a migration 28
        // ela não existe, e o Supabase recusa o upsert INTEIRO por causa de uma
        // coluna desconhecida — o dono perderia o cadastro ao salvar.
        const registro = { id, name, phone, photoUrl, commission, active };
        if (data.accessSchemaReady !== false) registro.email = email || null;

        if (id) {
            const idx = data.professionals.findIndex(p => p.id === id);
            data.professionals[idx] = registro;
            showToast("Profissional atualizado!", "success");
        } else {
            registro.id = 'prof-' + Date.now();
            data.professionals.push(registro);
            showToast("Profissional cadastrado!", "success");
        }

        saveData(STATE_KEYS.PROFESSIONALS, data.professionals);

        /* Ativo/Inativo comanda o login junto.

           Inativar o profissional tem que tirar o acesso dele. Suspender e não
           apagar, porque afastamento quase sempre é temporário — férias,
           licença, um acerto de contas — e o caminho de volta precisa ser um
           clique, sem recadastro e sem senha nova. Apagar de vez continua
           existindo, no botão Excluir. */
        const acesso = id && typeof acessoDoProfissional === 'function' ? acessoDoProfissional(id) : null;
        if (acesso && existing && existing.active !== active && typeof DataService !== 'undefined') {
            DataService.gerenciarAcessoDoProfissional(active ? 'reativar' : 'suspender', id)
                .then(() => {
                    showToast(active ? 'Acesso ao sistema reativado.' : 'Acesso ao sistema suspenso.', 'warning');
                    if (typeof carregarQuadroDeAcesso === 'function') carregarQuadroDeAcesso();
                })
                .catch(err => showToast('Cadastro salvo, mas o acesso não mudou: ' + err.message, 'error'));
        }

        closeModal('modal-professional');
        renderConfig();
    };

    if (photoFile) {
        // Redimensiona e converte o arquivo local em base64 (Data URL), gravando
        // direto no banco — mesmo mecanismo da foto da barbearia, sem link externo.
        resizeImageToDataURL(photoFile, 256, (dataUrl) => {
            photoUrl = dataUrl;
            persistProfessional();
        });
    } else {
        persistProfessional();
    }
});

document.getElementById('btn-delete-professional').addEventListener('click', async () => {
    const id = document.getElementById('prof-id').value;
    if (!id) return;

    /* Excluir o profissional apaga o login junto, e isso é definitivo.

       A ordem importa: o login PRIMEIRO. Se o cadastro sumisse antes e a
       exclusão da conta falhasse, sobraria alguém capaz de entrar no sistema
       amarrado a um profissional que não existe mais — ele veria telas vazias
       e continuaria dentro do salão. Por isso, falhou o login, aborta tudo.

       As VENDAS dele ficam: `sales.sold_by` é ON DELETE SET NULL (script 27).
       O histórico do dinheiro não vai embora junto com a pessoa. */
    const acesso = typeof acessoDoProfissional === 'function' ? acessoDoProfissional(id) : null;
    if (acesso) {
        const nome = data.professionals.find(p => p.id === id)?.name || 'este profissional';
        const confirmado = confirm(
            `Excluir ${nome} também APAGA o login ${acesso.email}, e não dá para desfazer.\n\n` +
            `Se for afastamento temporário, cancele e desmarque "Ativo" — isso suspende o acesso e devolve depois.\n\n` +
            `Excluir mesmo assim?`
        );
        if (!confirmado) return;

        try {
            await DataService.gerenciarAcessoDoProfissional('excluir', id);
        } catch (err) {
            showToast('Não foi possível apagar o login: ' + err.message + ' O profissional NÃO foi excluído.', 'error');
            return;
        }
    }

    data.professionals = data.professionals.filter(p => p.id !== id);
    saveData(STATE_KEYS.PROFESSIONALS, data.professionals);
    if (typeof DataService !== 'undefined' && DataService.deleteItem) {
        DataService.deleteItem('professionals', id).catch(console.error);
    }
    showToast("Profissional excluído.", "warning");
    closeModal('modal-professional');
    if (typeof carregarQuadroDeAcesso === 'function') carregarQuadroDeAcesso();
    renderConfig();
});

/* ==========================================================================
   ACESSO DOS PROFISSIONAIS AO SISTEMA

   Dois níveis, e só dois: ADMIN (o dono) e USUARIO (o profissional). Quem
   separa os DADOS é a RLS; o que se decide aqui é apenas quem ganha um login.

   O quadro (quem tem conta, com qual e-mail, se está suspensa) NÃO vem do
   banco comum: e-mail e estado da conta moram em `auth.users`, fora do alcance
   de qualquer política de RLS. Quem lê é a Edge Function `acesso-profissional`,
   com a chave de serviço, e só para quem for dono do salão.
   ========================================================================== */
let quadroDeAcesso = [];
let quadroDeAcessoCarregado = false;

function acessoDoProfissional(id) {
    return quadroDeAcesso.find(item => item.professionalId === id) || null;
}

/* Busca o quadro e redesenha os cartões. Falha em silêncio de propósito: uma
   instalação sem a Edge Function publicada continua cadastrando profissional
   normalmente — só não mostra o selo de acesso. Barrar o cadastro por causa
   disso seria trocar um recurso novo por uma tela quebrada. */
async function carregarQuadroDeAcesso() {
    // O quadro é do salão de QUEM ESTÁ LOGADO. Trocar de conta na mesma aba não
    // recarrega a página, então ele é zerado antes de qualquer coisa: um quadro
    // do login anterior sobrevivendo aqui mostraria o acesso errado no cartão.
    quadroDeAcesso = [];
    quadroDeAcessoCarregado = false;

    if (typeof DataService === 'undefined' || !DataService.isAuthenticated()) return;
    if (DataService.ehBarbeiro()) return;   // staff nem abre Configurações
    try {
        const resposta = await DataService.gerenciarAcessoDoProfissional('listar');
        quadroDeAcesso = resposta.quadro || [];
        quadroDeAcessoCarregado = true;
        renderProfissionaisGrid();
    } catch (e) {
        console.warn('Quadro de acesso indisponível:', e.message);
    }
}

/* Linha própria, fora do `.item-config-meta`: com o texto de "Ativo" e o
   preço, "Acessa o sistema" não cabia numa pílula e quebrava em duas linhas,
   virando um bloco verde inchado. Sem fundo sólido — só ícone e texto
   coloridos — para não competir visualmente com o selo de Ativo/Inativo. */
function seloDeAcesso(prof) {
    if (!quadroDeAcessoCarregado) return '';
    const acesso = acessoDoProfissional(prof.id);
    if (!acesso) return '';
    return acesso.suspenso
        ? '<div class="selo-acesso suspenso"><i class="fa-solid fa-key"></i> Acesso suspenso</div>'
        : '<div class="selo-acesso liberado"><i class="fa-solid fa-key"></i> Acessa o sistema</div>';
}

/* Desenha o bloco "Acesso ao sistema" dentro do cadastro do profissional.

   Três estados, e o primeiro é o que evita a pergunta mais comum: um
   profissional que ainda não foi salvo não tem id, e sem id não há a quem
   amarrar um login. Em vez de deixar o botão ali para falhar, ele explica. */
function renderAcessoDoProfissional(profId) {
    const estado = document.getElementById('prof-acesso-estado');
    const btnCriar = document.getElementById('btn-prof-criar-acesso');
    const btnRemover = document.getElementById('btn-prof-remover-acesso');
    const campoEmail = document.getElementById('prof-email');
    if (!estado || !btnCriar || !btnRemover) return;

    estado.className = 'prof-acesso-estado';
    btnCriar.style.display = '';
    btnRemover.style.display = 'none';
    btnCriar.disabled = false;

    // Sem a migration 28 não existe a coluna do e-mail: gravar o cadastro com
    // ela derrubaria o upsert inteiro (ver `data.accessSchemaReady`).
    if (data.accessSchemaReady === false) {
        estado.className = 'prof-acesso-estado visivel sem';
        estado.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Execute docs/28_acesso_do_profissional.sql no Supabase para liberar acessos.';
        btnCriar.disabled = true;
        if (campoEmail) campoEmail.disabled = true;
        return;
    }
    if (campoEmail) campoEmail.disabled = false;

    if (!profId) {
        estado.className = 'prof-acesso-estado visivel sem';
        estado.innerHTML = '<i class="fa-solid fa-circle-info"></i> Salve o profissional primeiro para liberar o acesso.';
        btnCriar.disabled = true;
        return;
    }

    const acesso = acessoDoProfissional(profId);
    if (!acesso) {
        estado.className = 'prof-acesso-estado visivel sem';
        estado.innerHTML = '<i class="fa-solid fa-lock"></i> Ainda não acessa o sistema.';
        return;
    }

    btnCriar.style.display = 'none';
    btnRemover.style.display = '';
    if (acesso.suspenso) {
        estado.className = 'prof-acesso-estado visivel suspenso';
        estado.innerHTML = `<i class="fa-solid fa-pause"></i> Acesso suspenso (profissional inativo) — ${escapeHTML(acesso.email)}`;
    } else {
        estado.className = 'prof-acesso-estado visivel tem';
        estado.innerHTML = `<i class="fa-solid fa-circle-check"></i> Acessa o sistema como ${escapeHTML(acesso.email)}`;
    }
}

// --- Botões do bloco de acesso ---------------------------------------------

document.getElementById('btn-prof-criar-acesso')?.addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    const id = document.getElementById('prof-id').value;
    const email = (document.getElementById('prof-email')?.value || '').trim().toLowerCase();
    if (!id) return showToast('Salve o profissional primeiro.', 'warning');
    if (!email) return showToast('Informe o e-mail que ele vai usar para entrar.', 'warning');

    const original = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Liberando...';
    try {
        const resposta = await DataService.gerenciarAcessoDoProfissional('criar', id, email);

        // O cadastro guarda a cópia do e-mail para a tela não depender da rede
        // só para dizer com qual endereço aquele profissional entra.
        const prof = data.professionals.find(p => p.id === id);
        if (prof && data.accessSchemaReady !== false) {
            prof.email = resposta.email || email;
            saveData(STATE_KEYS.PROFESSIONALS, data.professionals);
        }

        document.getElementById('acesso-criado-nome').textContent = prof ? prof.name : 'o profissional';
        document.getElementById('acesso-criado-email').textContent = resposta.email || email;
        document.getElementById('acesso-criado-senha').textContent = resposta.senha || '—';
        closeModal('modal-professional');
        openModal('modal-acesso-criado');
        await carregarQuadroDeAcesso();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        botao.disabled = false;
        botao.innerHTML = original;
    }
});

document.getElementById('btn-prof-remover-acesso')?.addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    const id = document.getElementById('prof-id').value;
    const acesso = acessoDoProfissional(id);
    if (!acesso) return;

    // Remover o acesso apaga a conta, mas mantém o profissional no cadastro:
    // ele continua na agenda e nas comissões, só não entra mais no sistema.
    if (!confirm(`Remover o acesso apaga o login ${acesso.email}. O profissional continua cadastrado e na agenda.\n\nRemover?`)) return;

    const original = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Removendo...';
    try {
        await DataService.gerenciarAcessoDoProfissional('excluir', id);
        const prof = data.professionals.find(p => p.id === id);
        if (prof && data.accessSchemaReady !== false) {
            prof.email = null;
            saveData(STATE_KEYS.PROFESSIONALS, data.professionals);
        }
        const campoEmail = document.getElementById('prof-email');
        if (campoEmail) campoEmail.value = '';
        showToast('Acesso removido.', 'warning');
        await carregarQuadroDeAcesso();
        renderAcessoDoProfissional(id);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        botao.disabled = false;
        botao.innerHTML = original;
    }
});

document.getElementById('btn-copiar-acesso')?.addEventListener('click', () => {
    const email = document.getElementById('acesso-criado-email').textContent;
    const senha = document.getElementById('acesso-criado-senha').textContent;
    const texto = `Acesso ao sistema\nE-mail: ${email}\nSenha: ${senha}`;
    // `clipboard` falha em página sem HTTPS e quando a aba perde o foco. O
    // fallback antigo cobre esses casos sem depender de permissão nenhuma.
    const copiado = () => showToast('Copiado. Cole na conversa com o profissional.', 'success');
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(texto).then(copiado).catch(() => copiarPeloCampoOculto(texto, copiado));
    } else {
        copiarPeloCampoOculto(texto, copiado);
    }
});

function copiarPeloCampoOculto(texto, aoCopiar) {
    const campo = document.createElement('textarea');
    campo.value = texto;
    campo.style.position = 'fixed';
    campo.style.opacity = '0';
    document.body.appendChild(campo);
    campo.select();
    try {
        document.execCommand('copy');
        aoCopiar();
    } catch (e) {
        showToast('Não foi possível copiar. Anote os dados da tela.', 'warning');
    }
    document.body.removeChild(campo);
}


// --- 7. PUBLIC BOOKING LINK SIMULATOR ---
// URL real da página pública de agendamento (funciona onde o site estiver hospedado)
function getPublicBookingUrl(slug) {
    return `${location.origin}/${slug}`;
}

// Sincroniza todos os lugares que exibem o link público com o domínio real
// onde o site está hospedado. Nada de domínio fixo no HTML: se um domínio
// próprio for apontado para o site depois, os rótulos acompanham sozinhos.
function updatePublicUrlLabels(slug) {
    const currentSlug = slug || (data.businessInfo && data.businessInfo.slug) || '';
    const prefix = `${location.host}/`;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    setText('biz-slug-prefix', prefix);
    setText('biz-link-url', getPublicBookingUrl(currentSlug));
    setText('wa-link-placeholder', prefix + currentSlug);
}

// Quando acessado por /<slug>, o container full-screen substitui o mockup do iPhone
let publicBookingContainer = null;
let publicSalonMode = false; // true = dados reais do Supabase (link público de verdade)
let publicSlug = null;

// Rotas internas do painel. O servidor entrega o index.html para qualquer
// endereço sem extensão, então sem esta lista o /app seria lido como slug de
// salão e o cliente veria "Link de agendamento não encontrado" no lugar do login.
const ROTAS_INTERNAS = new Set([
    'index.html',
    'app',
    'painel',
    'login',
    'admin',
    'dashboard',
    'home',
    'landing',
    'checkout',
    'api'
]);

function getPublicSlugFromUrl() {
    const path = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, '');
    if (!path) return null;
    // Compara só o primeiro trecho: /app/qualquer-coisa também é rota interna.
    if (ROTAS_INTERNAS.has(path.split('/')[0].toLowerCase())) return null;
    return path;
}

async function initPublicBookingPage() {
    document.body.classList.add('public-booking-mode');
    document.querySelector('.app-container').style.display = 'none';

    const page = document.createElement('div');
    page.id = 'public-booking-page';
    const content = document.createElement('div');
    content.className = 'phone-content';
    page.appendChild(content);
    document.body.appendChild(page);
    publicBookingContainer = content;

    publicSlug = getPublicSlugFromUrl();
    simulationStep = 1;
    simSelection = { serviceId: '', profId: '', date: '', time: '', clientName: '', clientPhone: '' };

    content.innerHTML = `
        <div class="pub-loading">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <p>Carregando agenda...</p>
        </div>`;

    // Busca os dados reais do salão pelo slug no Supabase
    let salon = null;
    if (DataService.isSupabaseConfigured()) {
        try {
            salon = await DataService.getPublicSalon(publicSlug);
        } catch (err) {
            console.error("Erro ao buscar dados públicos do salão:", err);
        }
    }

    if (salon) {
        publicSalonMode = true;
        data.businessInfo = sanitizeForStorage(salon.businessInfo || {});
        data.services = sanitizeForStorage(salon.services || []);
        data.professionals = sanitizeForStorage(salon.professionals || []);
        // bookedSlots tem só { profId, date, time, status } — o suficiente
        // para a grade de horários livres marcar os ocupados
        data.appointments = sanitizeForStorage(salon.bookedSlots || []);
        // Sem isto a grade pública ignoraria as folgas: profissionalBloqueado()
        // lê daqui. Vem vazio em instância sem docs/add_disponibilidade.sql.
        data.professionalBlocks = sanitizeForStorage(salon.blocks || []);
        currentSelectedDate = new Date(); // agenda real começa hoje
        document.title = `${escapeHTML(data.businessInfo.name)} - Agendamento Online`;
        renderPhoneScreen();
    } else if (DataService.isSupabaseConfigured()) {
        // Supabase ativo, mas nenhum salão tem esse slug
        renderPublicNotFound();
    }
}

function renderPublicNotFound() {
    publicBookingContainer.innerHTML = `
        <div class="pub-loading">
            <i class="fa-solid fa-link-slash" style="color: #64748b;"></i>
            <p><strong>Link de agendamento não encontrado.</strong></p>
            <p style="color:#94a3b8;">Confira se o endereço está correto ou peça um novo link ao estabelecimento.</p>
        </div>` + rodapeLexion();
}

let simulationStep = 1;
let simSelection = {
    serviceId: '',
    profId: '',
    date: '',
    time: '',
    clientName: '',
    clientPhone: ''
};

// Copy link action helper
document.getElementById('btn-copy-link').addEventListener('click', () => {
    const url = document.getElementById('biz-link-url').innerText;
    navigator.clipboard.writeText(url).then(() => {
        showToast("Link copiado para a área de transferência!", "success");
    });
});

// Helper: monta a mensagem de agendamento com tags dinâmicas (a partir do template salvo)
function getBookingWhatsAppMessage() {
    const defaultMsg = 'Bom dia, agende seu horário para hoje {dia}, não deixe pra última hora 💈 {link}';
    // As tags saem de aplicarTagsWhatsApp, a mesma usada na mensagem de
    // retorno. Antes o link vinha do texto do elemento #biz-link-url, o que
    // exigia a tela de Configurações já renderizada para funcionar.
    return aplicarTagsWhatsApp(data.businessInfo.whatsappBookingMessage || defaultMsg);
}

// Popula o textarea de composição com a mensagem já montada
function populateBookingDraft() {
    const draft = document.getElementById('booking-msg-draft');
    if (draft) {
        draft.value = getBookingWhatsAppMessage();
    }
}

// Enviar via WhatsApp — o texto vem do textarea, que é somente leitura e
// espelha o modelo salvo nas Configurações.
document.getElementById('btn-share-whatsapp-link').addEventListener('click', () => {
    const draft = document.getElementById('booking-msg-draft');
    const msg = draft ? draft.value : getBookingWhatsAppMessage();
    const encodedMsg = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encodedMsg}`, '_blank');
});

// Copiar mensagem do textarea para a área de transferência
document.getElementById('btn-copy-booking-msg').addEventListener('click', () => {
    const draft = document.getElementById('booking-msg-draft');
    const msg = draft ? draft.value : getBookingWhatsAppMessage();
    navigator.clipboard.writeText(msg).then(() => {
        showToast("Mensagem copiada!", "success");
    });
});

// O mockup de celular que simulava a experiência do cliente foi removido
// junto com a aba "Link de Agendamento" do menu — a página pública de
// verdade é a única simulação fiel, e ela está a um clique de distância no
// próprio link. O que sobrou da tela (endereço, mensagem, botões) é
// preenchido por renderConfig(), na sub-aba de Configurações onde ela mora.

// Crédito da Lexion no pé da página de agendamento. Fica numa função só porque
// a tela pública é remontada a cada passo — repetir o HTML em cada branch de
// renderPhoneScreen deixaria cinco cópias para manter em sincronia.
function rodapeLexion() {
    return `
        <footer class="pub-footer">
            <span>Desenvolvido por Lexion Consultoria · 2026</span>
            <a href="https://lexionconsultoria.com.br" target="_blank" rel="noopener noreferrer">lexionconsultoria.com.br</a>
        </footer>
    `;
}

function renderPhoneScreen() {
    const phoneScreen = publicBookingContainer || document.getElementById('phone-booking-content');
    phoneScreen.innerHTML = '';
    const businessName = escapeHTML(data.businessInfo.name || 'Agendamento Online');
    const businessAddress = escapeHTML(data.businessInfo.address || '');

    const firstLetter = businessName.charAt(0).toUpperCase();
    const avatarUrl = data.businessInfo.avatarUrl || '';
    const logoHtml = avatarUrl
        ? `<img src="${escapeHTML(avatarUrl)}" class="pub-logo" style="width:80px; height:80px; border-radius:50%; object-fit:cover; border:2px solid var(--primary); margin-bottom:12px; display:inline-block;">`
        : `<div class="pub-logo">${firstLetter}</div>`;

    // Passo 0: acompanhar a fila (só no link público de verdade)
    if (simulationStep === 0) {
        phoneScreen.innerHTML = `
            <div class="pub-header">
                ${logoHtml}
                <h4 class="pub-title">${businessName}</h4>
                <p class="pub-subtitle">Acompanhe a sua vez</p>
            </div>
            <div class="pub-section" id="pub-fila-conteudo">
                <form class="pub-form" onsubmit="consultarFila(event)">
                    <div class="form-group" style="margin-bottom:18px;">
                        <label style="color:#94a3b8; font-size:12px; font-weight:500; margin-bottom:6px; display:block;">SEU WHATSAPP:</label>
                        <input type="text" class="pub-input" style="font-size:16px; padding:14px; height:auto;" id="pub-fila-phone" placeholder="Ex: (11) 98888-7777" maxlength="15" required value="${escapeHTML(simSelection.clientPhone || '')}">
                    </div>
                    <button type="submit" class="pub-btn-submit btn-full" id="pub-btn-fila">
                        <i class="fa-solid fa-magnifying-glass"></i> Ver minha vez
                    </button>
                </form>
                <button class="btn btn-secondary btn-sm btn-full" onclick="changeSimStep(1)" style="margin-top:10px;">
                    <i class="fa-solid fa-chevron-left"></i> Quero agendar
                </button>
            </div>
        `;
        // A máscara do telefone já é aplicada pelo listener global de `input`
        // em qualquer campo cujo id contenha "phone" — nada a fazer aqui.
    }

    // Step 1: Client contact details
    else if (simulationStep === 1) {
        phoneScreen.innerHTML = `
            <div class="pub-header">
                ${logoHtml}
                <h4 class="pub-title">${businessName}</h4>
                <p class="pub-subtitle"><i class="fa-solid fa-location-dot"></i> ${businessAddress}</p>
            </div>
            ${publicSalonMode ? `
            <div class="pub-section" style="padding-bottom:0;">
                <button class="pub-fila-atalho" onclick="changeSimStep(0)">
                    <i class="fa-regular fa-clock"></i> Já tenho horário hoje — acompanhar minha vez
                </button>
            </div>` : ''}
            <div class="pub-section">
                <h5 class="pub-section-title">Passo 1: Seus dados</h5>
                <form class="pub-form" onsubmit="submitSimNamePhone(event)">
                    <div class="form-group">
                        <label style="color:#94a3b8; font-size:12px; font-weight: 500; margin-bottom: 6px; display: block;">SEU NOME COMPLETO:</label>
                        <input type="text" class="pub-input" style="font-size: 16px; padding: 14px; height: auto;" id="pub-sim-name" placeholder="Nome" required value="${escapeHTML(simSelection.clientName)}" oninput="this.value = this.value.replace(/[0-9]/g, '')">
                    </div>
                    <div class="form-group" style="margin-bottom:18px;">
                        <label style="color:#94a3b8; font-size:12px; font-weight: 500; margin-bottom: 6px; display: block;">SEU WHATSAPP:</label>
                        <input type="text" class="pub-input" style="font-size: 16px; padding: 14px; height: auto;" id="pub-sim-phone" placeholder="Ex: (11) 98888-7777" maxlength="15" required value="${escapeHTML(simSelection.clientPhone)}" ${simSelection.needsBirth ? 'readonly' : ''}>
                    </div>
                    ${simSelection.needsBirth ? `
                    <div class="form-group" style="margin-bottom:18px;">
                        <label style="color:#94a3b8; font-size:12px; font-weight: 500; margin-bottom: 6px; display: block;">SUA DATA DE NASCIMENTO:</label>
                        <input type="date" class="pub-input" style="font-size: 16px; padding: 14px; height: auto;" id="pub-sim-birth" min="1920-01-01" max="${new Date().toISOString().split('T')[0]}" required value="${escapeHTML(simSelection.birth)}">
                        <small style="color:var(--text-muted); font-size:11px; display:block; margin-top:6px;">Para enviarmos mimos no seu aniversário! 🎁</small>
                    </div>
                    ` : ''}
                    <button type="submit" class="pub-btn-submit btn-full" id="pub-btn-submit-step1">Avançar <i class="fa-solid fa-chevron-right"></i></button>
                </form>
            </div>
        `;
    }

    // Step 2: Select Professional
    else if (simulationStep === 2) {
        phoneScreen.innerHTML = `
            <div class="pub-header">
                ${logoHtml}
                <h4 class="pub-title">${businessName}</h4>
                <p class="pub-subtitle">Passo 2: Escolha o Profissional</p>
            </div>
            <div class="pub-section">
                <div class="pub-select-grid">
                    <!-- Option 1: Qualquer um (auto assign to first free) -->
                    <div class="pub-select-card ${simSelection.profId === 'any' ? 'selected' : ''}" onclick="selectSimProf('any')">
                        <div class="pub-logo" style="width:36px; height:36px; font-size:14px; margin-bottom:6px;"><i class="fa-solid fa-users"></i></div>
                        <span class="pub-select-name">Qualquer Um</span>
                    </div>
                    ${data.professionals.filter(p => p.active).map(prof => {
            const avatar = prof.photoUrl
                ? `<img src="${escapeHTML(prof.photoUrl)}" alt="${escapeHTML(prof.name)}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; margin-bottom:6px; border:2px solid var(--primary);">`
                : `<div class="pub-logo" style="width:48px; height:48px; font-size:16px; margin-bottom:6px; background: #64748b;"><i class="fa-solid fa-user"></i></div>`;
            return `
                        <div class="pub-select-card ${simSelection.profId === prof.id ? 'selected' : ''}" onclick="selectSimProf('${prof.id}')">
                            ${avatar}
                            <span class="pub-select-name">${escapeHTML(prof.name.split(' ')[0])}</span>
                        </div>
                    `;
        }).join('')}
                </div>
                <button class="btn btn-secondary btn-sm btn-full" onclick="changeSimStep(1)" style="margin-top: 15px;"><i class="fa-solid fa-chevron-left"></i> Voltar</button>
            </div>
        `;
    }

    // Step 3: Date & Time selection
    else if (simulationStep === 3) {
        // compute availability grid
        // default working hours are 9:00 to 19:00, 30 min increments.
        // filter out slots where professional has existing booking
        const activeProfs = data.professionals.filter(p => p.active);
        const assignedProf = simSelection.profId === 'any' ? activeProfs[0] : activeProfs.find(p => p.id === simSelection.profId);

        let availableSlots = [];
        let testDate = simSelection.date || getLocalDateString(currentSelectedDate);

        if (assignedProf) {
            const selectedService = data.services.find(s => s.id === simSelection.serviceId) || { duration: 30 };
            const proposedDuration = parseInt(selectedService.duration, 10) || 30;

            // A conta de "que horário está livre" mora em gradeDoProfissional
            // (BASE DE CÁLCULO DA DISPONIBILIDADE, mais acima). Era uma closure
            // aqui dentro até o encaixe do balcão passar a fazer a mesma
            // pergunta — duas cópias da regra viram duas respostas no dia em
            // que alguém corrigir só uma.
            //
            // A antecedência é o único parâmetro que muda entre os dois usos:
            // 120 minutos aqui, porque o cliente do link ainda vai se
            // deslocar; 0 no encaixe, porque a pessoa já está no balcão.
            const gradePublica = (dateStr) =>
                gradeDoProfissional(assignedProf.id, dateStr, proposedDuration, { antecedenciaMin: 120 });

            let result = gradePublica(testDate);

            // Avança até o próximo dia disponível (limite de 30 dias para evitar loop)
            let daysChecked = 0;
            while (!result.temVaga && daysChecked < 30) {
                const dateObj = new Date(testDate + 'T12:00:00');
                dateObj.setDate(dateObj.getDate() + 1);
                testDate = getLocalDateString(dateObj);
                result = gradePublica(testDate);
                daysChecked++;
            }

            availableSlots = result.slots;
            simSelection.date = testDate; // Atualiza a data se tiver pulado algum dia
        }

        phoneScreen.innerHTML = `
            <div class="pub-header">
                ${logoHtml}
                <h4 class="pub-title">${businessName}</h4>
                <p class="pub-subtitle">Passo 3: Data e Horário</p>
            </div>
            <div class="pub-section">
                <div class="form-group" style="margin-bottom:12px;">
                    <label style="color:#94a3b8; font-size:10px;">SELECIONE A DATA:</label>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" onclick="changeSimDateOffset(-1)" style="padding: 0 12px;" ${publicSalonMode && testDate <= getLocalDateString(new Date()) ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                        <input type="date" id="pub-sim-date" class="pub-input" style="flex:1; margin:0;" value="${testDate}" ${publicSalonMode ? `min="${getLocalDateString(new Date())}"` : ''} onchange="changeSimDate(this.value)">
                        <button class="btn btn-secondary btn-sm" onclick="changeSimDateOffset(1)" style="padding: 0 12px;"><i class="fa-solid fa-chevron-right"></i></button>
                    </div>
                </div>
                <h5 class="pub-section-title" style="margin-bottom:8px;">Horários Disponíveis:</h5>
                ${availableSlots.length === 0 ? `
                <p class="pub-sem-horario">
                    <i class="fa-regular fa-calendar-xmark"></i>
                    Não há horário livre nos próximos dias. Chame a barbearia no WhatsApp para verificar.
                </p>` : `
                <div class="pub-slots-grid">
                    ${availableSlots.map(slot => `
                        <button class="pub-slot-btn ${simSelection.time === slot.time ? 'selected' : ''} ${!slot.available ? 'disabled' : ''}"
                                ${!slot.available ? 'disabled' : ''}
                                onclick="selectSimTime('${slot.time}')">
                            ${slot.time}
                        </button>
                    `).join('')}
                </div>`}
                <div style="display:flex; gap:8px; margin-top: 15px;">
                    <button class="btn btn-secondary btn-sm flex-1" onclick="changeSimStep(2)"><i class="fa-solid fa-chevron-left"></i> Voltar</button>
                    <button class="btn btn-primary btn-sm flex-1" onclick="submitSimDateTimeStep()" ${!simSelection.time ? 'disabled' : ''}>Avançar <i class="fa-solid fa-chevron-right"></i></button>
                </div>
            </div>
        `;
    }

    // Step 4: Select Service & Confirm
    else if (simulationStep === 4) {
        phoneScreen.innerHTML = `
            <div class="pub-header">
                ${logoHtml}
                <h4 class="pub-title">${businessName}</h4>
                <p class="pub-subtitle">Passo 4: Selecione o Serviço</p>
            </div>
            <div class="pub-section">
                <div class="pub-services-list">
                    ${data.services.filter(s => s.active).map(srv => `
                        <div class="pub-service-card ${simSelection.serviceId === srv.id ? 'selected' : ''}" onclick="selectSimService('${srv.id}')">
                            <div>
                                <span class="pub-service-name">${escapeHTML(srv.name)}</span>
                                <span class="pub-service-dur"><i class="fa-regular fa-clock"></i> ${srv.duration} min</span>
                            </div>
                            <span class="pub-service-price">${formatCurrency(srv.price)}</span>
                        </div>
                    `).join('')}
                </div>
                <button class="pub-btn-submit btn-full" onclick="submitSimBooking(event)" ${!simSelection.serviceId ? 'disabled' : ''} style="margin-top: 15px;">Confirmar Agendamento <i class="fa-solid fa-check"></i></button>
                <button class="btn btn-secondary btn-sm btn-full" onclick="changeSimStep(3)" style="margin-top: 8px;"><i class="fa-solid fa-chevron-left"></i> Voltar</button>
            </div>
        `;
    }

    // Step 5: Success screen
    else if (simulationStep === 5) {
        const srv = data.services.find(s => s.id === simSelection.serviceId) || { name: 'Serviço' };
        const activeProfs = data.professionals.filter(p => p.active);
        const assignedProf = simSelection.profId === 'any' ? activeProfs[0] : activeProfs.find(p => p.id === simSelection.profId);

        const nomeExibido = primeiroNomeApresentavel(simSelection.clientName);

        phoneScreen.innerHTML = `
            <div class="pub-success-screen">
                <div class="success-icon-wrapper">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <h4 class="success-title">Agendado com Sucesso!</h4>
                <p class="success-desc">${nomeExibido ? escapeHTML(nomeExibido) + ', seu' : 'Seu'} horário já está reservado. Chegue uns minutinhos antes.</p>

                <div class="pub-summary-box">
                    <div class="pub-summary-row">
                        <span class="pub-summary-label">Serviço:</span>
                        <span class="pub-summary-val">${escapeHTML(srv.name)}</span>
                    </div>
                    <div class="pub-summary-row">
                        <span class="pub-summary-label">Profissional:</span>
                        <span class="pub-summary-val">${assignedProf ? escapeHTML(assignedProf.name) : 'Qualquer Um'}</span>
                    </div>
                    <div class="pub-summary-row">
                        <span class="pub-summary-label">Data:</span>
                        <span class="pub-summary-val">${formatDateStringToBR(simSelection.date)}</span>
                    </div>
                    <div class="pub-summary-row">
                        <span class="pub-summary-label">Horário:</span>
                        <span class="pub-summary-val">${simSelection.time}h</span>
                    </div>
                    <div class="pub-summary-row" style="border-top:1px dashed rgba(255,255,255,0.08); padding-top:8px; margin-top:8px;">
                        <span class="pub-summary-label">Valor:</span>
                        <span class="pub-summary-val" style="color:var(--success);">${formatCurrency(srv.price)}</span>
                    </div>
                </div>
                <div id="pub-sucesso-vitrine"></div>
            </div>
        `;
        // Sem botão "Novo Agendamento": a tela de sucesso é o fim do caminho do
        // cliente. Um botão ali convidava a agendar de novo por engano, e cada
        // toque a mais vira um horário fantasma na agenda da barbearia.

        // Lembrete, não vitrine principal: aqui o cliente já resolveu o que
        // veio fazer e está indo embora.
        if (typeof anexarVitrine === 'function') anexarVitrine('pub-sucesso-vitrine', 'A barbearia também vende');
    }

    // Depois do innerHTML de cada passo, senão a atribuição apagaria o rodapé.
    phoneScreen.insertAdjacentHTML('beforeend', rodapeLexion());
}

// Phone interaction routing functions (must be global to match string HTML events)
window.submitSimNamePhone = async function (event) {
    event.preventDefault();
    const btn = document.getElementById('pub-btn-submit-step1');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aguarde...';
    }

    const name = sanitizePlainText(document.getElementById('pub-sim-name').value);
    const phone = sanitizePlainText(document.getElementById('pub-sim-phone').value);

    // Validação de Nome (não aceita números ou nome muito curto)
    if (/\d/.test(name) || name.trim().length < 2) {
        alert('Por favor, informe um nome completo válido (sem números).');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Avançar <i class="fa-solid fa-chevron-right"></i>';
        }
        return;
    }

    simSelection.clientName = name;
    simSelection.clientPhone = phone;

    if (simSelection.needsBirth) {
        const birthInput = document.getElementById('pub-sim-birth');
        if (birthInput && birthInput.value) {
            const birthVal = birthInput.value;
            const birthYear = parseInt(birthVal.split('-')[0], 10);
            const currentYear = new Date().getFullYear();

            if (isNaN(birthYear) || birthYear < 1920 || birthYear > currentYear) {
                alert('Por favor, selecione uma data de nascimento válida (entre 1920 e o ano atual).');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = 'Avançar <i class="fa-solid fa-chevron-right"></i>';
                }
                return;
            }

            simSelection.birth = birthVal;
            simulationStep = 2;
            renderPhoneScreen();
            return;
        }
    }

    // Check if client exists
    let clientExists = false;
    if (publicSalonMode) {
        clientExists = await DataService.checkPublicClientExists(publicSlug, phone);
    } else {
        clientExists = data.clients.some(c => c.phone === phone);
    }

    if (!clientExists) {
        simSelection.needsBirth = true;
        renderPhoneScreen();
    } else {
        simulationStep = 2;
        renderPhoneScreen();
    }
};

window.selectSimService = function (id) {
    simSelection.serviceId = id;
    renderPhoneScreen();
};

window.selectSimProf = function (id) {
    simSelection.profId = id;
    simulationStep = 3;
    renderPhoneScreen();
};

/* ----------------------------------------------------------------
   FILA: o cliente acompanha a própria vez
   ---------------------------------------------------------------- */
let filaTimer = null;
let filaTelefone = '';

window.consultarFila = async function (event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('pub-btn-fila');
    // O campo some assim que o resultado é desenhado no lugar do formulário.
    // Cair no último número consultado deixa a função servir tanto para a
    // consulta inicial quanto para uma reconsulta.
    const campo = document.getElementById('pub-fila-phone');
    const phone = sanitizePlainText(campo ? campo.value : filaTelefone);
    if (!phone) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando...';
    }

    filaTelefone = phone;
    const resultado = await DataService.getPublicQueue(publicSlug, phone);
    renderFila(resultado);

    // Só religa a atualização automática quando há o que acompanhar. Ficar
    // consultando de minuto em minuto para quem não tem horário hoje é
    // bateria e dados do cliente à toa.
    pararAtualizacaoDaFila();
    if (resultado && resultado.encontrado) {
        filaTimer = setInterval(atualizarFilaEmSilencio, 30000);
    }
};

function pararAtualizacaoDaFila() {
    if (filaTimer) { clearInterval(filaTimer); filaTimer = null; }
}

// Atualiza sem piscar a tela: se a consulta falhar (rede do cliente oscilando),
// mantém o que já está exibido em vez de trocar por uma mensagem de erro.
async function atualizarFilaEmSilencio() {
    if (simulationStep !== 0 || !filaTelefone) return pararAtualizacaoDaFila();
    const resultado = await DataService.getPublicQueue(publicSlug, filaTelefone);
    if (resultado) renderFila(resultado);
}

function renderFila(resultado) {
    const alvo = document.getElementById('pub-fila-conteudo');
    if (!alvo) return;

    if (!resultado || !resultado.encontrado) {
        alvo.innerHTML = `
            <p class="pub-sem-horario">
                <i class="fa-regular fa-calendar-xmark"></i>
                Não encontramos um horário para hoje neste WhatsApp. Confira o número ou fale com a barbearia.
            </p>
            <button class="btn btn-secondary btn-sm btn-full" onclick="changeSimStep(0)" style="margin-top:12px;">Tentar de novo</button>
            <button class="pub-btn-submit btn-full" onclick="changeSimStep(1)" style="margin-top:8px;">Agendar um horário</button>`;
        return;
    }

    const emAtendimento = resultado.meuStatus === 'in_progress';
    const naFrente = resultado.pessoasNaFrente;

    // A chamada principal muda conforme a situação: é a única linha que o
    // cliente lê de fato quando abre o celular na fila.
    let destaque, cor;
    if (emAtendimento) {
        destaque = 'É a sua vez!';
        cor = 'var(--success)';
    } else if (naFrente === 0) {
        destaque = 'Você é o próximo';
        cor = 'var(--success)';
    } else if (naFrente === 1) {
        destaque = 'Falta 1 pessoa';
        cor = 'var(--primary)';
    } else {
        destaque = `Faltam ${naFrente} pessoas`;
        cor = 'var(--primary)';
    }

    const linhas = (resultado.fila || []).map(item => {
        const rotulo = item.status === 'in_progress' ? 'Em atendimento' : 'Aguardando';
        return `
            <div class="fila-linha ${item.sou_eu ? 'fila-eu' : ''} ${item.status === 'in_progress' ? 'fila-agora' : ''}">
                <span class="fila-hora">${escapeHTML(item.time)}</span>
                <span class="fila-status">${item.sou_eu ? 'VOCÊ' : rotulo}</span>
            </div>`;
    }).join('');

    alvo.innerHTML = `
        <div class="fila-destaque" style="color:${cor};">${escapeHTML(destaque)}</div>
        <p class="fila-resumo">
            Seu horário: <strong>${escapeHTML(resultado.meuHorario)}</strong>
            ${resultado.profissional ? ` · com ${escapeHTML(resultado.profissional)}` : ''}
        </p>
        <div class="fila-lista">${linhas}</div>
        <p class="fila-aviso">Esta tela se atualiza sozinha. O horário é uma previsão e pode variar conforme os atendimentos.</p>
        <button class="btn btn-secondary btn-sm btn-full" onclick="changeSimStep(0)" style="margin-top:12px;">Consultar outro número</button>
    `;

    // A vitrine entra DEPOIS da fila: o cliente está sentado esperando, com o
    // celular na mão, e é o melhor momento para ele ver o que a barbearia
    // vende. Buscar o catálogo antes de mostrar a vez dele deixaria a tela em
    // branco por causa de uma informação que não é a que ele veio ver.
    if (typeof anexarVitrine === 'function') anexarVitrine('pub-fila-conteudo', 'Enquanto espera');
}

window.changeSimStep = function (step) {
    // Sair da fila desliga a atualização automática — senão ela continua
    // consultando o servidor com o cliente já em outra tela.
    if (step !== 0) pararAtualizacaoDaFila();
    simulationStep = step;
    renderPhoneScreen();
};

window.changeSimDate = function (val) {
    simSelection.date = val;
    simSelection.time = ''; // Reset selected slot
    renderPhoneScreen();
};

window.changeSimDateOffset = function (offset) {
    const testDate = simSelection.date || getLocalDateString(new Date());
    const dateObj = new Date(testDate + 'T12:00:00');
    dateObj.setDate(dateObj.getDate() + offset);

    const newDateStr = getLocalDateString(dateObj);
    const todayStr = getLocalDateString(new Date());

    // Prevent navigating to the past in public booking mode
    if (publicSalonMode && newDateStr < todayStr) return;

    simSelection.date = newDateStr;
    simSelection.time = '';
    renderPhoneScreen();
};

window.selectSimTime = function (timeStr) {
    simSelection.time = timeStr;
    renderPhoneScreen();
};

window.submitSimDateTimeStep = function () {
    if (!simSelection.date) {
        simSelection.date = getLocalDateString(currentSelectedDate);
    }
    simulationStep = 4;
    renderPhoneScreen();
};

// Mostra a falha do agendamento dentro da própria página pública, logo acima
// do botão. Erros técnicos do Supabase (ex: RPC ausente no cache de schema)
// não dizem nada ao cliente final, então viram um texto legível — o detalhe
// completo continua no console para o suporte.
function showPublicBookingError(err) {
    const bruto = (err && err.message) || '';
    const instalacaoIncompleta = /schema cache|Could not find the function|PGRST202/i.test(bruto);
    const texto = instalacaoIncompleta
        ? 'O agendamento online está temporariamente indisponível. Por favor, chame a barbearia no WhatsApp.'
        : (bruto || 'Não foi possível concluir o agendamento. Tente novamente.');

    const botao = document.querySelector('.pub-btn-submit');
    if (!botao) {
        showToast(texto, 'danger');
        return;
    }

    let caixa = document.getElementById('pub-booking-error');
    if (!caixa) {
        caixa = document.createElement('div');
        caixa.id = 'pub-booking-error';
        caixa.className = 'pub-booking-error';
        botao.parentNode.insertBefore(caixa, botao);
    }
    caixa.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span></span>`;
    caixa.querySelector('span').textContent = texto;
    caixa.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

window.submitSimBooking = async function (event) {
    if (event && event.preventDefault) event.preventDefault();
    const erroAnterior = document.getElementById('pub-booking-error');
    if (erroAnterior) erroAnterior.remove();

    const name = simSelection.clientName;
    const phone = simSelection.clientPhone;

    const btn = event.target.closest('.pub-btn-submit') || document.querySelector('.pub-btn-submit');
    const originalBtn = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirmando...';
    }

    // Checa se o cliente já tem agendamento na mesma semana (aviso, não bloqueio)
    if (!simSelection._weekWarningDismissed) {
        try {
            let existingAppts = [];

            if (publicSalonMode) {
                const weekCheck = await DataService.checkWeekAppointments(publicSlug, phone, simSelection.date);
                if (weekCheck && weekCheck.hasAppointments) {
                    existingAppts = weekCheck.appointments || [];
                }
            } else {
                // MODO LOCAL/DEMO: Check locally
                const client = data.clients.find(c => c.phone === phone);
                if (client) {
                    const selectedDateObj = new Date(simSelection.date + 'T12:00:00');
                    const dayOfWeek = selectedDateObj.getDay(); // 0=Sun
                    const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;
                    const weekStart = new Date(selectedDateObj);
                    weekStart.setDate(selectedDateObj.getDate() - (isoDay - 1));
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekStart.getDate() + 6);
                    const weekStartStr = getLocalDateString(weekStart);
                    const weekEndStr = getLocalDateString(weekEnd);

                    existingAppts = data.appointments.filter(a =>
                        a.clientId === client.id &&
                        a.status !== 'cancelled' &&
                        a.status !== 'no_show' &&
                        a.date >= weekStartStr &&
                        a.date <= weekEndStr
                    );
                }
            }

            if (existingAppts.length > 0) {
                const apptListHtml = existingAppts.map(a => {
                    const srv = data.services.find(s => s.id === a.serviceId);
                    return `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                        <span>${formatDateStringToBR(a.date)}</span>
                        <span>${a.time}h</span>
                        <span style="color:var(--primary);">${srv ? escapeHTML(srv.name) : 'Serviço'}</span>
                    </div>`;
                }).join('');

                // Show warning popup
                const overlay = document.createElement('div');
                overlay.id = 'pub-week-warning-overlay';
                overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';
                overlay.innerHTML = `
                    <div style="background:var(--bg-secondary, #1e293b); border-radius:16px; padding:24px; max-width:380px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.5); border:1px solid rgba(201,162,75,0.3);">
                        <div style="text-align:center; margin-bottom:16px;">
                            <i class="fa-solid fa-calendar-check" style="font-size:36px; color:var(--warning, #f59e0b);"></i>
                        </div>
                        <h4 style="color:white; text-align:center; font-size:16px; margin-bottom:8px;">Você já tem agendamento nesta semana!</h4>
                        <p style="color:#94a3b8; text-align:center; font-size:13px; margin-bottom:16px;">
                            Identificamos que você já possui ${existingAppts.length === 1 ? 'um horário reservado' : existingAppts.length + ' horários reservados'} nesta mesma semana:
                        </p>
                        <div style="background:rgba(0,0,0,0.2); border-radius:10px; padding:10px 14px; margin-bottom:18px; font-size:13px; color:#cbd5e1;">
                            ${apptListHtml}
                        </div>
                        <p style="color:#94a3b8; text-align:center; font-size:12px; margin-bottom:18px;">
                            Deseja continuar mesmo assim?
                        </p>
                        <div style="display:flex; gap:10px;">
                            <button id="pub-week-warn-back" style="flex:1; padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:#94a3b8; font-weight:600; cursor:pointer; font-size:14px;">Voltar</button>
                            <button id="pub-week-warn-continue" style="flex:1; padding:12px; border-radius:10px; border:none; background:linear-gradient(135deg, var(--primary, #C9A24B), var(--primary-dark, #8F6F2E)); color:white; font-weight:600; cursor:pointer; font-size:14px;">Sim, Agendar</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);

                document.getElementById('pub-week-warn-back').addEventListener('click', () => {
                    overlay.remove();
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = originalBtn;
                    }
                });
                document.getElementById('pub-week-warn-continue').addEventListener('click', () => {
                    overlay.remove();
                    simSelection._weekWarningDismissed = true;
                    submitSimBooking(event);
                });
                return;
            }
        } catch (e) {
            console.warn("Falha ao checar semana duplicada:", e);
        }
    }
    // Limpa flag para próximos agendamentos
    simSelection._weekWarningDismissed = false;

    // MODO PÚBLICO REAL: grava direto no Supabase do salão (via RPC)
    if (publicSalonMode) {

        try {
            const result = await DataService.createPublicBooking(publicSlug, {
                name: name,
                phone: phone,
                serviceId: simSelection.serviceId,
                profId: simSelection.profId,
                date: simSelection.date,
                time: simSelection.time,
                birth: simSelection.birth
            });
            if (!result || result.ok !== true) {
                throw new Error((result && result.error) || 'Não foi possível concluir o agendamento.');
            }
            // Marca o horário como ocupado e mostra o profissional realmente atribuído
            data.appointments.push({ profId: result.profId, date: simSelection.date, time: simSelection.time, status: 'scheduled' });
            if (simSelection.profId === 'any') simSelection.profId = result.profId;
            simulationStep = 5;
            renderPhoneScreen();
        } catch (err) {
            console.error("Erro no agendamento público:", err);
            // O toast fica no canto da tela e passa despercebido no celular:
            // na página pública a falha precisa aparecer junto do botão.
            showPublicBookingError(err);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalBtn;
            }
        }
        return;
    }

    // MODO LOCAL/DEMO: salva no navegador
    // 1. Check or Create Client in DB
    let client = data.clients.find(c => c.phone === phone);
    if (!client) {
        client = {
            id: 'cli-' + Date.now(),
            name: name,
            phone: phone,
            instagram: '',
            birth: simSelection.birth || '',
            frequency: 30,
            lastVisit: simSelection.date,
            notes: 'Cliente cadastrado automaticamente pelo link público.',
            loyaltyEnrolled: true
        };
        data.clients.push(client);
        saveData(STATE_KEYS.CLIENTS, data.clients);
    }

    // 2. Assign professional if 'any' selected
    const activeProfs = data.professionals.filter(p => p.active);
    const profId = simSelection.profId === 'any' ? activeProfs[0].id : simSelection.profId;

    // 3. Create Appointment
    const newAppt = {
        id: 'appt-' + Date.now(),
        clientId: client.id,
        serviceId: simSelection.serviceId,
        profId: profId,
        date: simSelection.date,
        time: simSelection.time,
        status: 'scheduled',
        paymentStatus: 'pending',
        notes: 'Agendado pelo link público do cliente.'
    };

    data.appointments.push(newAppt);
    saveData(STATE_KEYS.APPOINTMENTS, data.appointments);

    // 4. Create Lead conversion in Kanban
    const newLead = {
        id: 'lead-' + Date.now(),
        name: name,
        phone: phone,
        source: 'website',
        stage: 'scheduled',
        notes: `Agendou corte automático para dia ${formatDateStringToBR(simSelection.date)} às ${simSelection.time}h.`,
        date: getLocalDateString(new Date())
    };
    data.leads.push(newLead);
    saveData(STATE_KEYS.LEADS, data.leads);

    // 5. Advance simulator screen to success
    simulationStep = 5;
    renderPhoneScreen();

    // 6. Alert admin with Toast
    showToast(`Novo agendamento recebido pelo link! (${name})`, 'success');
};

window.resetSimToStep1 = function () {
    initPhoneSimulator();
};

// --- MOBILE-FIRST AGENDA, CLIENT 360 & AUTOMATION DEMO ---
function dateFromLocalString(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function addDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
}

function renderAlternateCalendar(view) {
    const altView = document.getElementById('calendar-alternate-view');
    const title = document.getElementById('agenda-current-date-title');
    altView.style.display = 'block';
    if (view === 'week') {
        const monday = new Date(currentSelectedDate);
        const weekday = monday.getDay() || 7;
        monday.setDate(monday.getDate() - weekday + 1);
        title.innerText = `${monday.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} — ${addDays(monday, 6).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
        altView.innerHTML = `<div class="week-view">${Array.from({ length: 7 }, (_, index) => {
            const day = addDays(monday, index);
            const dateKey = getLocalDateString(day);
            const appointments = data.appointments.filter(a => a.date === dateKey && a.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time));
            return `<button class="week-day-card ${dateKey === getLocalDateString(new Date()) ? 'is-today' : ''}" onclick="openCalendarDay('${dateKey}')">
                <span>${day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
                <strong>${day.getDate()}</strong>
                <small>${appointments.length} horário${appointments.length === 1 ? '' : 's'}</small>
                <div class="week-appointments">${appointments.slice(0, 3).map(a => {
                const client = data.clients.find(c => c.id === a.clientId);
                return `<span class="mini-appt ${a.status}">${a.time} · ${client?.name.split(' ')[0] || 'Cliente'}</span>`;
            }).join('') || '<em>Livre</em>'}</div>
            </button>`;
        }).join('')}</div>`;
    } else {
        const year = currentSelectedDate.getFullYear();
        const month = currentSelectedDate.getMonth();
        const first = new Date(year, month, 1);
        const days = new Date(year, month + 1, 0).getDate();
        const leading = first.getDay();
        title.innerText = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        altView.innerHTML = `<div class="month-weekdays">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<span>${d}</span>`).join('')}</div>
            <div class="month-view">${'<span class="month-empty"></span>'.repeat(leading)}${Array.from({ length: days }, (_, index) => {
            const day = new Date(year, month, index + 1);
            const dateKey = getLocalDateString(day);
            const appointments = data.appointments.filter(a => a.date === dateKey && a.status !== 'cancelled');

            let apptsHTML = '';
            if (appointments.length > 0) {
                const profCounts = {};
                appointments.forEach(a => profCounts[a.profId] = (profCounts[a.profId] || 0) + 1);
                apptsHTML = Object.entries(profCounts).map(([pId, count]) => {
                    const profName = (data.professionals.find(p => p.id === pId)?.name || 'Prof').split(' ')[0];
                    return `<div style="font-size: 10px; color: var(--text-muted); text-align: left; margin-top: 2px;">${escapeHTML(profName)}: <strong>${count}</strong></div>`;
                }).join('');
            }

            const revenue = appointments.reduce((sum, a) => sum + (data.services.find(s => s.id === a.serviceId)?.price || 0), 0);

            return `<button class="month-day ${dateKey === getLocalDateString(new Date()) ? 'is-today' : ''}" onclick="openCalendarDay('${dateKey}')" style="display: flex; flex-direction: column; align-items: flex-start; padding: 8px;">
                    <div style="display: flex; justify-content: space-between; width: 100%;">
                        <strong>${index + 1}</strong>
                        ${appointments.length ? `<span style="font-size: 11px; background: rgba(142, 68, 173, 0.3); color: #cba4e3; padding: 2px 6px; border-radius: 10px; line-height: 1.2;">${appointments.length} cli.</span>` : ''}
                    </div>
                    <div style="flex: 1; margin-top: 4px; width: 100%;">
                        ${apptsHTML}
                    </div>
                    ${revenue ? `<small style="color: var(--success); font-weight: bold; margin-top: auto; align-self: flex-start;">${formatCurrency(revenue).replace(',00', '')}</small>` : ''}
                </button>`;
        }).join('')}</div>`;
    }
}

window.openCalendarDay = function (dateKey) {
    currentSelectedDate = dateFromLocalString(dateKey);
    currentAgendaView = 'day';
    document.querySelectorAll('.agenda-filters button').forEach(button => button.classList.toggle('btn-active', button.id === 'btn-agenda-view-day'));
    document.querySelector('.calendar-wrapper').style.display = 'flex';
    document.getElementById('calendar-alternate-view').style.display = 'none';
    renderAgenda();
};

function syncAppointmentMessages(appointment) {
    if (!appointment?.id) return;
    const relatedJobs = data.messageJobs.filter(job => job.appointmentId === appointment.id);
    if (appointment.status === 'cancelled' || appointment.status === 'done') {
        relatedJobs.filter(job => ['pending', 'sent'].includes(job.status)).forEach(job => job.status = 'cancelled');
        saveData(STATE_KEYS.MESSAGE_JOBS, data.messageJobs);
        return;
    }
    const start = dateFromLocalString(appointment.date);
    const [hours, minutes] = appointment.time.split(':').map(Number);
    start.setHours(hours, minutes, 0, 0);
    const scheduled = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const scheduledAt = `${getLocalDateString(scheduled)}T${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`;
    const pendingJob = relatedJobs.find(job => job.status === 'pending');
    if (pendingJob) {
        pendingJob.clientId = appointment.clientId;
        pendingJob.scheduledAt = scheduledAt;
        pendingJob.text = `Confirme seu horário em ${formatDateStringToBR(appointment.date)} às ${appointment.time}.`;
    } else if (!relatedJobs.some(job => ['delivered', 'replied'].includes(job.status))) {
        data.messageJobs.push({ id: `msg-${Date.now()}`, appointmentId: appointment.id, clientId: appointment.clientId, type: 'confirmation', scheduledAt, status: 'pending', text: `Confirme seu horário em ${formatDateStringToBR(appointment.date)} às ${appointment.time}.` });
    }
    saveData(STATE_KEYS.MESSAGE_JOBS, data.messageJobs);
}
function renderAppointmentStatusBadge(appt, serviceDuration) {
    if (appt.paymentStatus === 'paid') {
        return '<span class="comm-badge" style="background: rgba(46,204,113,0.2); color: #2ecc71;" title="Pago"><i class="fa-solid fa-sack-dollar"></i></span>';
    }

    const todayStr = getLocalDateString(new Date());
    if (appt.date < todayStr) {
        return '<span class="comm-badge" style="background: rgba(231,76,60,0.2); color: #e74c3c;" title="Pagamento Atrasado"><i class="fa-solid fa-triangle-exclamation"></i></span>';
    } else if (appt.date === todayStr) {
        const endMins = timeToMinutes(appt.time) + (serviceDuration || 30);
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        if (nowMins > endMins) {
            return '<span class="comm-badge" style="background: rgba(231,76,60,0.2); color: #e74c3c;" title="Pagamento Pendente"><i class="fa-solid fa-triangle-exclamation"></i></span>';
        }
    }
    return '<span class="comm-badge" style="background: rgba(241,196,15,0.2); color: #f1c40f;" title="Agendado"><i class="fa-solid fa-clock"></i></span>';
}

function renderAppointmentCommunicationBadge(appointmentId) {
    const job = data.messageJobs.find(item => item.appointmentId === appointmentId);
    if (!job) return '<span class="comm-badge neutral"><i class="fa-regular fa-bell"></i></span>';
    const states = {
        pending: ['pending', 'fa-clock'], delivered: ['delivered', 'fa-check-double'],
        replied: ['replied', 'fa-comment-check'], failed: ['failed', 'fa-triangle-exclamation'], sent: ['sent', 'fa-paper-plane']
    };
    const [css, icon] = states[job.status] || states.pending;
    return `<span class="comm-badge ${css}" title="${job.status}"><i class="fa-solid ${icon}"></i></span>`;
}

function renderAppointmentMessageTimeline(appointmentId) {
    const container = document.getElementById('appointment-message-timeline');
    if (!container) return;
    document.getElementById('btn-send-reminder-now').dataset.appointmentId = appointmentId;
    const jobs = data.messageJobs.filter(job => job.appointmentId === appointmentId);
    if (!appointmentId || !jobs.length) {
        container.className = 'message-timeline-empty';
        container.innerHTML = appointmentId ? 'Nenhum lembrete programado. Use “Enviar agora”.' : 'Salve o agendamento para programar os lembretes.';
        return;
    }
    container.className = 'message-timeline';
    container.innerHTML = jobs.map(job => `<div><i class="fa-solid ${job.status === 'failed' ? 'fa-circle-exclamation text-red' : 'fa-circle-check text-green'}"></i><span><strong>${translateMessageStatus(job.status)}</strong><small>${escapeHTML(job.text)}</small></span></div>`).join('');
}

function translateMessageStatus(status) {
    return ({ pending: 'Programada', sent: 'Enviada', delivered: 'Entregue', replied: 'Cliente respondeu', failed: 'Falha no envio', cancelled: 'Cancelada' })[status] || status;
}

let currentMessageFilter = 'all';
function renderMessages() {
    const jobs = data.messageJobs;
    const pending = jobs.filter(job => job.status === 'pending').length;
    const delivered = jobs.filter(job => ['delivered', 'replied'].includes(job.status)).length;
    const attention = jobs.filter(job => job.status === 'failed').length;
    document.getElementById('badge-messages').innerText = pending + attention;
    document.getElementById('message-kpis').innerHTML = `
        <div class="message-kpi glass-effect"><i class="fa-regular fa-clock text-amber"></i><span><strong>${pending}</strong><small>Pendentes</small></span></div>
        <div class="message-kpi glass-effect"><i class="fa-solid fa-check-double text-green"></i><span><strong>${delivered}</strong><small>Entregues</small></span></div>
        <div class="message-kpi glass-effect"><i class="fa-solid fa-triangle-exclamation text-red"></i><span><strong>${attention}</strong><small>Atenção</small></span></div>`;
    document.getElementById('automation-rule-list').innerHTML = data.automationRules.map(rule => `<label class="automation-rule"><span class="rule-icon"><i class="fa-solid ${rule.icon}"></i></span><span><strong>${escapeHTML(rule.name)}</strong><small>${escapeHTML(rule.description)}</small></span><input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="toggleAutomationRule('${rule.id}', this.checked)"><span class="switch-ui"></span></label>`).join('');
    const filtered = jobs.filter(job => currentMessageFilter === 'all' || (currentMessageFilter === 'attention' ? job.status === 'failed' : job.status === currentMessageFilter));
    document.getElementById('message-job-list').innerHTML = filtered.map(job => {
        const client = data.clients.find(c => c.id === job.clientId) || { name: 'Cliente', phone: '' };
        const appointment = data.appointments.find(a => a.id === job.appointmentId);
        return `<article class="message-job-card glass-effect status-${job.status}">
            <div class="message-job-main"><span class="client-avatar">${client.name.charAt(0)}</span><div><strong>${escapeHTML(client.name)}</strong><small>${appointment ? `${formatDateStringToBR(appointment.date)} · ${appointment.time}` : 'Mensagem avulsa'}</small></div><span class="message-status">${translateMessageStatus(job.status)}</span></div>
            <p>${escapeHTML(job.text)}</p>
            <div class="message-job-actions">${job.status === 'failed' ? `<button class="btn btn-secondary btn-sm" onclick="retryMessage('${job.id}')"><i class="fa-solid fa-rotate"></i> Tentar novamente</button>` : ''}<button class="btn btn-secondary btn-sm" onclick="openEditAppointment('${job.appointmentId}')"><i class="fa-regular fa-calendar"></i> Ver horário</button></div>
        </article>`;
    }).join('') || '<div class="empty-state glass-effect"><i class="fa-regular fa-message"></i><p>Nenhuma mensagem neste filtro.</p></div>';
}

window.toggleAutomationRule = function (id, enabled) {
    const rule = data.automationRules.find(item => item.id === id);
    if (rule) rule.enabled = enabled;
    saveData(STATE_KEYS.AUTOMATION_RULES, data.automationRules);
    showToast(enabled ? 'Automação ativada.' : 'Automação pausada.', 'success');
};

window.retryMessage = function (id) {
    const job = data.messageJobs.find(item => item.id === id);
    if (job) job.status = 'sent';
    saveData(STATE_KEYS.MESSAGE_JOBS, data.messageJobs);
    renderMessages();
    showToast('Mensagem reenviada.', 'success');
};

/* Tudo o que o sistema sabe sobre a relação com UM cliente: quanto gastou,
   quantas vezes veio, de quanto em quanto tempo volta e o histórico. É a fonte
   única da lista de Clientes, da ficha ("Ver"), do status Em dia/Atrasado e do
   CRM de retorno — antes a lista tinha um cálculo de gasto próprio, e os dois
   nem batiam entre si.

   A regra que importa: o DINHEIRO vem das vendas, não dos agendamentos. Até
   aqui só agendamentos contavam, e a venda de balcão (cliente entra, corta e
   paga sem ter marcado hora) não existia para esta função. */
function calculateClientStats(clientId) {
    const appointments = data.appointments.filter(a => a.clientId === clientId && a.status !== 'cancelled').sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
    const completed = appointments.filter(a => a.status === 'done' || a.paymentStatus === 'paid' || a.paymentStatus === 'free');

    const vendas = typeof vendasDoCliente === 'function' ? vendasDoCliente(clientId) : [];
    const validas = vendas.filter(v => v.valida);
    // Atendimento que já teve venda — inclusive cancelada — não é somado de
    // novo pelo caminho antigo: o dinheiro dele é o da venda.
    const atendimentosComVenda = new Set(vendas.map(v => v.appointmentId).filter(Boolean));

    // O valor COBRADO, com desconto e produto dentro — e não o preço do
    // catálogo, que muda com o tempo e não sabe do desconto dado no balcão.
    // Venda a prazo entra pelo total: o cliente consumiu, mesmo devendo.
    const gastoEmVendas = validas.reduce((soma, v) => soma + v.total, 0);

    // Antes do módulo de Vendas, o agendamento pago era o único registro do
    // dinheiro. Só o PAGO conta: concluído-mas-pendente não é gasto, e
    // cortesia (`free`) também não.
    const gastoAntigo = completed.reduce((sum, a) => {
        if (a.paymentStatus !== 'paid' || atendimentosComVenda.has(String(a.id))) return sum;
        const price = a.price !== undefined ? parseFloat(a.price) : (data.services.find(s => s.id === a.serviceId)?.price || 0);
        return sum + (Number(price) || 0);
    }, 0);
    const spent = Math.round((gastoEmVendas + gastoAntigo) * 100) / 100;

    // Visita é ir ao salão e ser atendido: agendamento concluído, ou venda de
    // balcão com serviço. Contada por DIA — corte e barba marcados separados
    // na mesma tarde são uma ida só, e um intervalo de zero dias puxaria a
    // frequência de retorno para baixo.
    const visitasDeBalcao = validas.filter(v => !v.appointmentId && v.temServico);
    const diasDeVisita = [...new Set([
        ...completed.map(a => a.date),
        ...visitasDeBalcao.map(v => v.dia)
    ].filter(Boolean))].sort((a, b) => b.localeCompare(a));

    const intervals = diasDeVisita.slice(0, -1).map((dia, index) => daysBetween(diasDeVisita[index + 1], dia));
    const averageFrequency = intervals.length ? Math.floor(intervals.reduce((sum, value) => sum + value, 0) / intervals.length) : null;

    // Um fio do tempo só: agendamentos e vendas de balcão, o mais recente
    // primeiro. A venda que veio de agendamento não aparece duas vezes — ela
    // já está representada pelo próprio agendamento.
    const horaDaVenda = (valor) => {
        const quando = new Date(valor);
        return Number.isNaN(quando.getTime()) ? ''
            : `${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')}`;
    };
    const historico = [
        ...appointments.map(a => ({ tipo: 'atendimento', dia: a.date, hora: a.time || '', registro: a })),
        ...vendas.filter(v => !v.appointmentId)
            .map(v => ({ tipo: 'balcao', dia: v.dia, hora: horaDaVenda(v.vendidaEm), registro: v }))
    ].sort((a, b) => `${b.dia}${b.hora}`.localeCompare(`${a.dia}${a.hora}`));

    return {
        appointments,
        completed,
        spent,
        averageFrequency,
        visitas: diasDeVisita.length,
        historico,
        noShows: appointments.filter(a => a.status === 'no_show').length
    };
}

window.openClientDetail = function (clientId) {
    const client = data.clients.find(c => c.id === clientId);
    if (!client) return;
    const stats = calculateClientStats(clientId);
    // Pela mesma regra da lista: com a frequência em modo manual, a ficha não
    // pode dizer um número e a coluna "Frequência" outro.
    const retorno = frequenciaDoCliente(client, stats);
    document.getElementById('client-detail-title').innerText = client.name;
    document.getElementById('btn-client-detail-appointment').dataset.clientId = clientId;
    document.getElementById('client-detail-content').innerHTML = `
        <div class="client-hero"><span class="client-avatar large">${client.name.charAt(0)}</span><div><strong>${escapeHTML(client.phone)}</strong><small>${client.instagram ? '@' + client.instagram : 'Sem Instagram'} · retorno em ${retorno} ${retorno === 1 ? 'dia' : 'dias'}</small></div><button class="btn btn-success btn-sm" onclick="openWhatsAppCRMSimulator('${client.id}')"><i class="fa-brands fa-whatsapp"></i> Chamar</button></div>
        <div class="client-stat-grid"><div><strong>${stats.visitas}</strong><small>Visitas</small></div><div><strong>${formatCurrency(stats.spent)}</strong><small>Total gasto</small></div><div><strong>${stats.noShows}</strong><small>Faltas</small></div></div>
        <div class="client-notes-card"><span class="eyebrow">Preferências e observações</span><p>${escapeHTML(client.notes || 'Nenhuma observação.')}</p></div>
        <div class="client-history"><div class="panel-header"><h4>Histórico</h4></div>${stats.historico.slice(0, 6).map(item => {
            if (item.tipo === 'balcao') {
                // Venda sem agendamento: o cliente entrou e foi atendido na hora.
                const venda = item.registro;
                const dot = venda.valida ? 'done' : 'cancelled';
                return `<div class="history-item"><span class="history-dot ${dot}"></span><div><strong>Venda #${escapeHTML(venda.numero)} · Balcão</strong><small>${formatDateStringToBR(item.dia)}${item.hora ? ' às ' + item.hora : ''} · ${formatCurrency(venda.total)}</small></div><span class="status-badge">${escapeHTML(typeof saleStatusLabel === 'function' ? saleStatusLabel(venda.status) : venda.status)}</span></div>`;
            }
            const a = item.registro;
            const service = data.services.find(s => s.id === a.serviceId);
            return `<div class="history-item"><span class="history-dot ${a.status}"></span><div><strong>${service?.name || 'Serviço'}</strong><small>${formatDateStringToBR(a.date)} às ${a.time}</small></div><span class="status-badge">${translateStatus(a.status)}</span></div>`;
        }).join('') || '<p class="text-muted">Sem atendimentos.</p>'}</div>`;
    openModal('modal-client-detail');
};

document.getElementById('message-filter')?.addEventListener('click', event => {
    const button = event.target.closest('[data-message-filter]');
    if (!button) return;
    currentMessageFilter = button.dataset.messageFilter;
    document.querySelectorAll('[data-message-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderMessages();
});

document.getElementById('btn-process-messages')?.addEventListener('click', () => {
    data.messageJobs.filter(job => job.status === 'pending').forEach(job => job.status = 'sent');
    saveData(STATE_KEYS.MESSAGE_JOBS, data.messageJobs);
    renderMessages();
    showToast('Fila processada. As mensagens foram simuladas.', 'success');
});

document.getElementById('btn-send-reminder-now')?.addEventListener('click', event => {
    const appointmentId = event.currentTarget.dataset.appointmentId;
    const appointment = data.appointments.find(a => a.id === appointmentId);
    if (!appointment) return showToast('Salve o agendamento primeiro.', 'warning');
    const now = new Date().toISOString();
    data.messageJobs.push({ id: `msg-${Date.now()}`, appointmentId, clientId: appointment.clientId, type: 'manual', scheduledAt: now, status: 'sent', text: `Lembrete manual do horário às ${appointment.time}.` });
    saveData(STATE_KEYS.MESSAGE_JOBS, data.messageJobs);
    renderAppointmentMessageTimeline(appointmentId);
    showToast('Lembrete enviado.', 'success');
});

document.getElementById('btn-client-detail-appointment')?.addEventListener('click', event => {
    const clientId = event.currentTarget.dataset.clientId;
    closeModal('modal-client-detail');
    openNewAppointmentModal();
    document.getElementById('appt-client-select').value = clientId;
});

// Topo da sidebar mostra o nome (e a logomarca) do salão configurado;
// o rodapé mantém o crédito fixo "Desenvolvido por Lexion Consultoria"
function updateUserProfileUI() {
    const salonNameEl = document.getElementById('sidebar-salon-name');
    const logoIconEl = document.getElementById('sidebar-logo-icon');

    const salonName = (data.businessInfo && data.businessInfo.name) || localStorage.getItem('lexion_biz_name') || '';
    const savedAvatar = (data.businessInfo && data.businessInfo.avatarUrl) || localStorage.getItem('lexion_biz_avatar') || '';

    if (salonNameEl) {
        if (salonName) {
            salonNameEl.innerText = salonName;
        } else {
            salonNameEl.innerHTML = 'Lexion<span class="logo-dot">.</span>';
        }
    }

    // logoIconEl é um <img>: a logomarca enviada nas Configurações substitui o
    // arquivo padrão da marca. Trocar o src, e não o innerHTML — <img> é vazio.
    if (logoIconEl) {
        logoIconEl.src = savedAvatar || LOGO_PADRAO;
        logoIconEl.alt = salonName || 'Lexion Salão & Barbearia';
    }
}

function updateDatabaseTabUI() {
    const statusDot = document.getElementById('db-status-dot');
    const statusText = document.getElementById('db-status-text');
    const loggedUser = document.getElementById('db-logged-user');
    const migrationAlert = document.getElementById('db-migration-alert');
    const btnMigrate = document.getElementById('btn-migrate-supabase-direct');
    const btnLogout = document.getElementById('btn-logout-sidebar');

    if (DataService.isSupabaseConfigured()) {
        if (DataService.isAuthenticated()) {
            if (statusDot) statusDot.style.backgroundColor = 'var(--success)';
            if (statusText) statusText.innerText = 'Status: Conectado ao Supabase (Nuvem)';
            if (loggedUser) loggedUser.innerText = DataService.getUserEmail() || 'Conectado';
            if (btnLogout) btnLogout.style.display = 'block';

            // Verifica se há dados locais no localStorage para migrar
            const hasLocalData = ['lexion_clients', 'lexion_appointments', 'lexion_services']
                .some(key => {
                    try {
                        const localData = JSON.parse(localStorage.getItem(key));
                        return Array.isArray(localData) && localData.length > 0;
                    } catch (e) { return false; }
                });

            if (hasLocalData) {
                if (migrationAlert) migrationAlert.style.display = 'flex';
                if (btnMigrate) btnMigrate.style.display = 'block';
            } else {
                if (migrationAlert) migrationAlert.style.display = 'none';
                if (btnMigrate) btnMigrate.style.display = 'none';
            }
        } else {
            if (statusDot) statusDot.style.backgroundColor = 'var(--warning)';
            if (statusText) statusText.innerText = 'Status: Não Autenticado';
            if (loggedUser) loggedUser.innerText = 'Nenhum';
            if (migrationAlert) migrationAlert.style.display = 'none';
            if (btnMigrate) btnMigrate.style.display = 'none';
            if (btnLogout) btnLogout.style.display = 'none';
        }
    }
}

/* Tira a tela de carregamento. Chamada de TODOS os fins de boot possíveis —
   painel montado, tela de login, link público — e também por um prazo de
   segurança: uma falha no meio do caminho não pode deixar o salão olhando para
   uma tela de espera que nunca sai. Chamar duas vezes não faz mal. */
function esconderCarregamentoInicial() {
    const tela = document.getElementById('boot-overlay');
    if (!tela || tela.classList.contains('saindo')) return;
    tela.classList.add('saindo');
    // Só depois da transição, para o fade acontecer de verdade.
    setTimeout(() => tela.remove(), 400);
}

// O prazo de segurança começa a contar já no carregamento do arquivo: se o
// boot travar numa chamada de rede, a tela sai mesmo assim e a pessoa vê o
// que houver (login, ou o painel com o cache local).
setTimeout(esconderCarregamentoInicial, 15000);

// --- INITIALIZER ON LOAD ---
window.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Inicializa Conexão Supabase (credenciais fixas no api.js)
        await DataService.init();
    } catch (erro) {
        console.error('Falha ao iniciar a conexão com a nuvem:', erro);
        esconderCarregamentoInicial();
        throw erro;
    }

    // Acesso via link público (ex: https://site.com/nome-do-salao) abre direto
    // o agendamento do cliente, sem passar pela tela de login
    if (getPublicSlugFromUrl()) {
        await initPublicBookingPage();
        esconderCarregamentoInicial();
        return;
    }

    // 2. Se o Supabase está configurado mas não logado, verifica se há credenciais de auto-login
    if (DataService.isSupabaseConfigured() && !DataService.isAuthenticated()) {
        try {
            const autoLogin = JSON.parse(localStorage.getItem('lexion_auto_login') || 'null');
            if (autoLogin && autoLogin.email && autoLogin.password) {
                localStorage.removeItem('lexion_auto_login');
                await DataService.login(autoLogin.email, autoLogin.password);
                if (typeof showToast === 'function') {
                    showToast(`Bem-vindo ao ${autoLogin.salonName || 'seu novo Salão'}! Período de 7 dias grátis ativo.`, 'success');
                }
            }
        } catch (autoErr) {
            console.warn('[Auto-Login] Falha ao efetuar login automático:', autoErr);
        }
    }

    // Se ainda não estiver logado, preenche o email se veio por URL
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get('email');
    if (emailParam && document.getElementById('auth-email')) {
        document.getElementById('auth-email').value = emailParam;
    }

    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');
    // Quem chega pelo link de "esqueci a senha" vem COM sessão válida. Sem esta
    // checagem antes da próxima, cairia direto no dashboard sem trocar a senha.
    if (DataService.estaEmRecuperacaoDeSenha()) {
        if (authOverlay) authOverlay.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        esconderCarregamentoInicial();
    } else if (DataService.isSupabaseConfigured() && !DataService.isAuthenticated()) {
        if (authOverlay) authOverlay.style.display = 'flex';
        if (appContainer) appContainer.style.display = 'none';
        esconderCarregamentoInicial();
    } else {
        if (authOverlay) authOverlay.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
    }

    updateUserProfileUI();
    updateDatabaseTabUI();

    seedDefaultAutomationRules();
    await loadData();

    // --- MIGRATION: Backfill profId in old transactions ---
    let transactionsMigrated = false;
    data.transactions.forEach(t => {
        if (!t.profId && t.type === 'income' && t.category === 'Serviço' && t.description) {
            // Attempt to find the matching appointment
            const matchingAppt = data.appointments.find(a => {
                if (a.date !== t.date) return false;
                const service = data.services.find(s => s.id === a.serviceId);
                const client = data.clients.find(c => c.id === a.clientId);
                if (service && client) {
                    const expectedDesc = `${service.name} - ${escapeHTML(client.name)}`;
                    // Allow slight mismatches or exact matches
                    return t.description === expectedDesc;
                }
                return false;
            });
            if (matchingAppt && matchingAppt.profId) {
                t.profId = matchingAppt.profId;
                transactionsMigrated = true;
            }
        }
    });
    if (transactionsMigrated) {
        saveData('transactions', data.transactions);
    }
    // --- END MIGRATION ---

    updateUserProfileUI(); // reflete o nome do salão vindo da nuvem
    initNavigation();
    initModals();
    // Depois do initNavigation: ele é quem monta os itens de menu que o
    // recorte esconde.
    aplicarNivelDeAcesso();

    // Set display header date
    document.getElementById('current-date-display').querySelector('span').innerText = formatDateDisplay(currentSelectedDate);

    // Set document initial render
    renderDashboard();
    renderMessages();

    // O painel está montado e com os números reais na tela: pode aparecer.
    esconderCarregamentoInicial();

    // Login Form Submit (dentro do DOMContentLoaded para garantir que o form exista)
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const btn = document.getElementById('btn-login-submit');
            const errBox = document.getElementById('auth-error');

            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Entrando...';
                errBox.style.display = 'none';

                await DataService.login(email, password);

                // Se sucesso
                document.getElementById('auth-overlay').style.display = 'none';
                document.getElementById('app-container').style.display = 'flex';
                updateUserProfileUI();
                updateDatabaseTabUI();

                // Recarregar dados da nuvem
                await loadData();
                updateUserProfileUI(); // nome do salão vindo da nuvem
                // O papel só é conhecido depois do login, então o recorte
                // precisa ser refeito aqui — no boot ainda não havia sessão.
                aplicarNivelDeAcesso();
                renderDashboard();
                renderMessages();

            } catch (err) {
                errBox.style.display = 'flex';
                errBox.querySelector('span').textContent = err.message || "Email ou senha incorretos.";
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Entrar no Sistema';
            }
        });
    }

    initRecuperacaoDeSenha();
});

// --- RECUPERAÇÃO DE SENHA ---------------------------------------------------
// A tela de login tem três painéis no mesmo lugar: entrar, pedir o link e
// definir a senha nova. Trocar de painel limpa os avisos, senão o erro do
// login continua na tela enquanto o usuário digita o e-mail de recuperação.

/* ==========================================================================
   NÍVEIS DE ACESSO NA TELA

   Recorta a interface para o barbeiro ('staff'): sem link público, sem caixa,
   sem Configurações do estabelecimento.

   ⚠️ ISTO NÃO É A PROTEÇÃO. Esconder botão não protege dado nenhum — o
   barbeiro tem o navegador dele e a mesma chave `anon` que vai para todo
   mundo. Quem separa os dados é a RLS, em docs/add_niveis_de_acesso.sql.
   O que se faz aqui é não mostrar o que não vai funcionar, para ele não
   esbarrar em telas vazias e achar que o sistema quebrou.
   ========================================================================== */

// Abas restritas que o barbeiro não acessa (apenas dono/administrador).
// O Financeiro é restrito ao dono. Comissões fica acessível na sua própria aba.
const ABAS_SO_DO_DONO = ['leads', 'configuracoes', 'financeiro'];

// O rótulo do grupo só faz sentido com algum item embaixo dele. Como as abas
// somem por caminhos independentes (perfil de barbeiro esconde por style,
// recurso pausado esconde por classe no CSS), a checagem lê o display já
// calculado em vez de tentar repetir cada uma dessas regras aqui.
function sincronizarGruposDoMenu() {
    document.querySelectorAll('.sidebar-menu .menu-group').forEach(grupo => {
        const temItemVisivel = [...grupo.querySelectorAll('.menu-item')]
            .some(item => getComputedStyle(item).display !== 'none');
        grupo.classList.toggle('menu-group-vazio', !temItemVisivel);
    });
}
window.sincronizarGruposDoMenu = sincronizarGruposDoMenu;

function aplicarNivelDeAcesso() {
    if (!DataService.isAuthenticated() || !DataService.ehBarbeiro()) {
        document.body.classList.remove('acesso-barbeiro');
        ABAS_SO_DO_DONO.forEach(alvo => {
            document.querySelectorAll(`.menu-item[data-target="${alvo}"], .tab-item[data-target="${alvo}"]`)
                .forEach(el => { el.style.display = ''; });
        });
        sincronizarGruposDoMenu();
        return;
    }

    document.body.classList.add('acesso-barbeiro');

    ABAS_SO_DO_DONO.forEach(alvo => {
        document.querySelectorAll(`.menu-item[data-target="${alvo}"], .tab-item[data-target="${alvo}"]`)
            .forEach(el => { el.style.display = 'none'; });
    });

    sincronizarGruposDoMenu();

    // Se o barbeiro estiver numa aba que sumiu (link antigo, F5), joga para a
    // agenda em vez de deixar a tela em branco.
    const ativa = document.querySelector('.page-section.active');
    if (ativa && ABAS_SO_DO_DONO.some(a => ativa.id === `page-${a}`)) {
        document.querySelector('.menu-item[data-target="agenda"]')?.click();
    }
}

// Filtra a lista para o que é do barbeiro. Espelha a RLS: com a migração
// rodada o banco já devolve só isto, mas a tela continua correta mesmo antes
// de ela ser aplicada — e o simulador local não tem RLS nenhuma.
function somenteMeus(lista, campo) {
    if (!DataService.ehBarbeiro()) return lista;
    const meu = DataService.getProfissionalDoLogin();
    if (!meu) return [];
    return (lista || []).filter(item => item[campo || 'profId'] === meu);
}

// Escrito por JS, e não fixo no HTML, para a versão viver num lugar só —
// senão o número do rodapé e o do código passam a divergir na primeira pressa.
(function exibirVersaoNoRodape() {
    const alvo = document.getElementById('auth-versao');
    if (alvo) alvo.innerText = `v${VERSAO_DO_SISTEMA}`;
})();

function mostrarPainelAuth(qual) {
    const paineis = {
        login: 'auth-panel-login',
        recuperar: 'auth-panel-recover',
        novaSenha: 'auth-panel-nova-senha'
    };
    Object.keys(paineis).forEach(function (nome) {
        const el = document.getElementById(paineis[nome]);
        if (el) el.style.display = (nome === qual) ? 'block' : 'none';
    });
    esconderAvisosAuth();
}

function esconderAvisosAuth() {
    ['auth-error', 'auth-sucesso'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function avisoAuth(id, texto) {
    esconderAvisosAuth();
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    el.querySelector('span').textContent = texto;
}

function initRecuperacaoDeSenha() {
    const btnEsqueci = document.getElementById('btn-esqueci-senha');
    const btnVoltar = document.getElementById('btn-voltar-login');
    const formRecuperar = document.getElementById('form-recover');
    const formNovaSenha = document.getElementById('form-nova-senha');

    if (btnEsqueci) {
        btnEsqueci.addEventListener('click', function () {
            // Aproveita o e-mail já digitado no login: quem esqueceu a senha
            // normalmente acertou o e-mail.
            const digitado = document.getElementById('auth-email').value;
            const campo = document.getElementById('auth-recover-email');
            if (campo && digitado) campo.value = digitado;
            mostrarPainelAuth('recuperar');
        });
    }

    if (btnVoltar) {
        btnVoltar.addEventListener('click', function () { mostrarPainelAuth('login'); });
    }

    if (formRecuperar) {
        formRecuperar.addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = document.getElementById('auth-recover-email').value.trim();
            const btn = document.getElementById('btn-recover-submit');
            const rotulo = btn.innerHTML;
            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';
                await DataService.enviarLinkDeRecuperacao(email);
            } catch (err) {
                // De propósito não diferencia "e-mail não cadastrado" de sucesso:
                // isso permitiria descobrir quais e-mails têm conta no sistema.
                console.error('Falha ao enviar o link de recuperação:', err);
            } finally {
                btn.disabled = false;
                btn.innerHTML = rotulo;
            }
            avisoAuth('auth-sucesso',
                'Se este e-mail estiver cadastrado, o link de recuperação chegará em instantes. Confira também a caixa de spam.');
        });
    }

    if (formNovaSenha) {
        formNovaSenha.addEventListener('submit', async function (e) {
            e.preventDefault();
            const senha = document.getElementById('auth-nova-senha').value;
            const confirma = document.getElementById('auth-nova-senha-confirma').value;
            const btn = document.getElementById('btn-nova-senha-submit');
            const rotulo = btn.innerHTML;

            if (senha !== confirma) {
                avisoAuth('auth-error', 'As duas senhas não são iguais.');
                return;
            }
            if (senha.length < 6) {
                avisoAuth('auth-error', 'A senha precisa ter pelo menos 6 caracteres.');
                return;
            }

            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
                await DataService.definirNovaSenha(senha);

                // Encerra a sessão do link e volta para o login: entrar com a
                // senha nova confirma na hora que ela funciona.
                await DataService.logout();
                mostrarPainelAuth('login');
                avisoAuth('auth-sucesso', 'Senha alterada! Entre com a nova senha.');
            } catch (err) {
                console.error('Falha ao definir a nova senha:', err);
                avisoAuth('auth-error',
                    'Não foi possível salvar a senha. O link pode ter expirado — peça um novo.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = rotulo;
            }
        });
    }

    // O evento de recuperação pode chegar depois do boot, quando o supabase-js
    // termina de ler o hash da URL.
    DataService.aoEntrarEmRecuperacaoDeSenha(abrirTelaDeNovaSenha);
}

function abrirTelaDeNovaSenha() {
    const overlay = document.getElementById('auth-overlay');
    const app = document.getElementById('app-container');
    if (overlay) overlay.style.display = 'flex';
    if (app) app.style.display = 'none';
    mostrarPainelAuth('novaSenha');
}



// Logout Button handler
document.getElementById('btn-logout-sidebar')?.addEventListener('click', async () => {
    // Texto para o dono da barbearia, não para quem programou: nada de "banco
    // de dados na nuvem" num aviso que ele lê todo dia ao fechar a loja.
    if (confirm("Deseja sair do sistema?")) {
        try {
            await DataService.logout();
            showToast("Você saiu do sistema.", "success");
            // Força o overlay de login voltar a aparecer
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) authOverlay.style.display = 'flex';
            const appContainer = document.getElementById('app-container');
            if (appContainer) appContainer.style.display = 'none';

            updateUserProfileUI();
            updateDatabaseTabUI();

            // Limpa o estado global e recarrega no modo local
            await loadData();
            updateUserProfileUI();
            renderDashboard();
            renderMessages();
        } catch (err) {
            // O detalhe técnico fica no console, para o suporte; na tela vai
            // só o que o dono da barbearia consegue fazer a respeito.
            console.error("Erro ao encerrar a sessão:", err);
            showToast("Não foi possível sair agora. Tente novamente.", "danger");
        }
    }
});

// Sincronizar dados locais direto para a nuvem
document.getElementById('btn-migrate-supabase-direct')?.addEventListener('click', async () => {
    if (confirm("Isso enviará os dados salvos localmente neste navegador para o seu banco na nuvem. Continuar?")) {
        const btn = document.getElementById('btn-migrate-supabase-direct');
        const originalText = btn.innerHTML;
        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...';

            // Carrega dados locais do localStorage (já que loadAll no modo autenticado traz da nuvem)
            const getLocal = (key) => JSON.parse(localStorage.getItem(key)) || [];
            const localData = {
                services: getLocal(STATE_KEYS.SERVICES),
                professionals: getLocal(STATE_KEYS.PROFESSIONALS),
                clients: getLocal(STATE_KEYS.CLIENTS),
                appointments: getLocal(STATE_KEYS.APPOINTMENTS),
                leads: getLocal(STATE_KEYS.LEADS),
                transactions: getLocal(STATE_KEYS.TRANSACTIONS),
                businessInfo: JSON.parse(localStorage.getItem(STATE_KEYS.BUSINESS_INFO)) || {}
            };

            await DataService.migrateToCloud(localData);

            // Limpa o localStorage local para não ficar mostrando o aviso de migração redundante
            ['lexion_clients', 'lexion_appointments', 'lexion_services', 'lexion_professionals', 'lexion_leads', 'lexion_transactions']
                .forEach(key => localStorage.removeItem(key));

            showToast("Sincronização dos dados locais concluída!", "success");
            updateDatabaseTabUI();

            // Recarrega tudo
            await loadData();
            renderDashboard();
            renderMessages();
        } catch (err) {
            showToast("Erro ao sincronizar: " + err.message, "danger");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
});

// --- PHONE NUMBER MASK ---
const phoneMask = (value) => {
    if (!value) return "";
    value = value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);
    value = value.replace(/^(\d{2})(\d)/g, '($1) $2');
    value = value.replace(/(\d)(\d{4})$/, '$1-$2');
    return value;
};

document.addEventListener('input', function (e) {
    if (e.target && e.target.tagName === 'INPUT' && (e.target.id.includes('phone') || e.target.id === 'client-phone' || e.target.id === 'lead-phone' || e.target.id === 'prof-phone' || e.target.id === 'biz-phone' || e.target.id === 'pub-sim-phone')) {
        let oldVal = e.target.value;
        let newVal = phoneMask(oldVal);
        if (oldVal !== newVal) {
            e.target.value = newVal;
        }
    }
});

// --- CASH REGISTER LOGIC ---
window.getCurrentCashRegister = function () {
    return data.cashRegisters.find(cr => cr.status === 'open');
};

document.getElementById('form-open-register').addEventListener('submit', (e) => {
    e.preventDefault();
    if (window.getCurrentCashRegister()) {
        showToast("O caixa já está aberto!", "error");
        return;
    }
    const initial = parseFloat(document.getElementById('register-initial-cash').value) || 0;

    const newReg = {
        id: 'cr-' + Date.now(),
        dateOpened: new Date().toISOString(),
        dateClosed: null,
        initialCash: initial,
        finalCash: 0,
        status: 'open',
        created_at: new Date().toISOString()
    };

    data.cashRegisters.push(newReg);
    saveData(STATE_KEYS.CASH_REGISTERS, data.cashRegisters);

    // Confirma sozinho SÓ o que é de hoje.
    //
    // Confirmar todo pendente em dinheiro, de qualquer data, puxaria um
    // recebimento de dias atrás pra gaveta de hoje sem ninguém pedir — o saldo
    // do dia nasceria com dinheiro que talvez já tenha sido gasto ou nunca
    // chegou. Pendente de hoje é outra história: é o recebimento que aconteceu
    // antes de alguém lembrar de abrir o caixa, e pertence a esta sessão mesmo.
    const hoje = getLocalDateString(new Date());
    let confirmados = 0;
    data.transactions.forEach(t => {
        if (t.status === 'pending' && ehPagamentoEmDinheiro(t.paymentMethod) && t.date === hoje) {
            t.status = 'completed';
            // O carimbo vai para a abertura, não para o instante em que o
            // recebimento foi lançado: sem isto o lançamento vira `completed`
            // e mesmo assim não aparece no saldo — pertenceAoCaixa() corta tudo
            // registrado antes de `dateOpened`, e um pendente é, por definição,
            // anterior à abertura.
            t.registradoEm = newReg.dateOpened;
            confirmados++;
        }
    });
    if (confirmados > 0) saveData(STATE_KEYS.TRANSACTIONS, data.transactions);

    const antigos = pendentesEmDinheiroAntigos().length;
    if (antigos > 0) {
        showToast(`Caixa aberto. ${antigos} pendência(s) de dias anteriores esperam sua decisão.`, "warning");
    } else if (confirmados > 0) {
        showToast(`Caixa aberto! ${confirmados} pendência(s) de hoje confirmadas.`, "success");
    } else {
        showToast("Caixa aberto com sucesso!", "success");
    }

    closeModal('modal-open-register');
    renderFinance();
});

/* --- PENDÊNCIAS EM DINHEIRO DE DIAS ANTERIORES ---------------------------
   Recebimento em espécie lançado com o caixa fechado fica `pending`: o dinheiro
   existe, mas não há sessão de caixa para responder por ele. Quando é do mesmo
   dia, abrir o caixa resolve (bloco acima). Quando é de ontem ou antes, ninguém
   consegue dizer sozinho se aquele dinheiro entrou na gaveta de hoje, se já foi
   gasto ou se nunca chegou — e é o dono quem sabe.

   Por isso eles ficam aqui, visíveis e parados, até alguém decidir. */
function pendentesEmDinheiroAntigos() {
    const hoje = getLocalDateString(new Date());
    return (data.transactions || [])
        .filter(t => t.status === 'pending' && ehPagamentoEmDinheiro(t.paymentMethod) && (t.date || '') < hoje)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function renderPendentesAntigos() {
    const alvo = document.getElementById('cash-pendentes-antigos');
    if (!alvo) return;

    const lista = pendentesEmDinheiroAntigos();
    if (!lista.length) {
        alvo.style.display = 'none';
        alvo.innerHTML = '';
        return;
    }

    const total = lista.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    alvo.style.display = 'block';
    alvo.innerHTML = `
        <div class="caixa-pendencias">
            <p class="caixa-pendencias-titulo">
                <i class="fa-solid fa-triangle-exclamation"></i>
                ${lista.length} recebimento(s) em dinheiro de dias anteriores — ${formatCurrency(total)}
            </p>
            <p class="caixa-pendencias-texto">
                Foram lançados com o caixa fechado. Confirme os que estão na gaveta;
                descarte os que não entraram.
            </p>
            <div class="caixa-pendencias-lista">
                ${lista.map(t => `
                    <div class="caixa-pendencia-linha">
                        <div class="caixa-pendencia-texto">
                            <strong>${escapeHTML(t.description || 'Lançamento')}</strong>
                            <small>${formatDateStringToBR(t.date)}</small>
                        </div>
                        <span class="caixa-pendencia-valor">${formatCurrency(t.amount)}</span>
                        <button type="button" class="btn btn-sm btn-primary"
                                onclick="confirmarPendenciaAntiga('${escapeHTML(t.id)}')">Confirmar</button>
                        <button type="button" class="btn-card-action" title="Descartar"
                                onclick="descartarPendenciaAntiga('${escapeHTML(t.id)}')">
                            <i class="fa-solid fa-trash-can text-danger"></i>
                        </button>
                    </div>`).join('')}
            </div>
        </div>`;
}

window.confirmarPendenciaAntiga = function (id) {
    const t = (data.transactions || []).find(x => x.id === id);
    if (!t) return;

    t.status = 'completed';
    // O dinheiro entra na gaveta AGORA, não na data do atendimento: é hoje que
    // ele está sendo contado. `date` continua sendo a competência, para o
    // extrato do período não mudar de lugar.
    t.registradoEm = new Date().toISOString();

    saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
    showToast(`${formatCurrency(t.amount)} confirmados na gaveta.`, 'success');
    renderCaixaOperacional();
    renderFinance();
};

window.descartarPendenciaAntiga = async function (id) {
    const t = (data.transactions || []).find(x => x.id === id);
    if (!t) return;
    if (!confirm(`Descartar ${formatCurrency(t.amount)} de "${t.description || 'lançamento'}"? O lançamento será excluído.`)) return;

    const backup = [...data.transactions];
    data.transactions = data.transactions.filter(x => x.id !== id);
    saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
    renderCaixaOperacional();
    renderFinance();

    try {
        if (typeof DataService !== 'undefined' && DataService.deleteItem) {
            await DataService.deleteItem('transactions', id);
        }
        showToast('Lançamento descartado.', 'warning');
    } catch (err) {
        console.error('Erro ao descartar transação no servidor:', err);
        data.transactions = backup;
        saveData(STATE_KEYS.TRANSACTIONS, data.transactions);
        renderCaixaOperacional();
        renderFinance();
        showToast('Erro ao descartar no servidor: ' + (err.message || err), 'danger');
    }
};

window.closeCashRegister = function () {
    const active = window.getCurrentCashRegister();
    if (!active) {
        showToast("Não há caixa aberto.", "error");
        return;
    }

    const agora = new Date();
    const todayStr = getLocalDateString(agora);
    const horaAgora = String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');

    // Só travam o fechamento os atendimentos que JÁ aconteceram até este
    // momento. Os que ainda vão acontecer hoje viram um aviso — cobrar antes
    // da hora não faz sentido.
    const travamFechamento = pagamentosPendentesAte(agora);
    const aindaVaoAcontecer = data.appointments.filter(a =>
        a.date === todayStr &&
        a.time >= horaAgora &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show' &&
        a.paymentStatus !== 'paid' &&
        a.paymentStatus !== 'free'
    );

    // Populate the pending list
    const pendingListEl = document.getElementById('close-register-pending-list');
    if (travamFechamento.length > 0) {
        const total = travamFechamento.reduce((soma, a) => {
            const s = data.services.find(x => x.id === a.serviceId);
            return soma + (s ? Number(s.price) || 0 : 0);
        }, 0);

        let listHTML = `
            <div style="background: rgba(231, 76, 60, 0.1); border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 10px; padding: 12px;">
                <p style="color: #e74c3c; font-weight: 700; margin-bottom: 6px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    ${travamFechamento.length} pagamento(s) pendente(s) até agora (${horaAgora})
                </p>
                <p style="color: var(--text-muted); font-size: 12px; margin: 0 0 10px 0;">
                    O caixa só pode ser fechado depois que todos forem confirmados.
                    Se algum não vai ser pago, marque o atendimento como
                    <strong>Cortesia</strong>, <strong>Faltou</strong> ou <strong>Cancelado</strong>.
                </p>
                <div style="max-height: 180px; overflow-y: auto;">`;
        travamFechamento.forEach(a => {
            const client = data.clients.find(c => c.id === a.clientId);
            const service = data.services.find(s => s.id === a.serviceId);
            const prof = data.professionals.find(p => p.id === a.profId);
            const quando = a.date === todayStr
                ? a.time
                : `${formatDateStringToBR(a.date)} ${a.time}`;
            listHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="min-width: 0;">
                        <strong style="color: var(--text-primary);">${escapeHTML(client ? client.name : 'Cliente')}</strong>
                        <br><small style="color: var(--text-muted);">${escapeHTML(quando)} - ${escapeHTML(service ? service.name : 'Serviço')}${prof ? ' (' + escapeHTML(prof.name.split(' ')[0]) + ')' : ''}</small>
                    </div>
                    <span style="color: var(--warning); font-weight: 600; white-space: nowrap;">${formatCurrency(service ? service.price : 0)}</span>
                </div>`;
        });
        listHTML += `
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 8px 0;">
                    <span style="color: var(--text-muted); font-size: 12px;">Total a confirmar</span>
                    <strong style="color: var(--warning);">${formatCurrency(total)}</strong>
                </div>
                <button type="button" class="btn btn-warning btn-sm btn-full" style="margin-top: 10px; justify-content: center;" onclick="irParaConfirmarPagamentos()">
                    <i class="fa-solid fa-money-check-dollar"></i> Ir para Confirmar Pagamentos
                </button>
            </div>`;
        pendingListEl.innerHTML = listHTML;
    } else {
        const aviso = aindaVaoAcontecer.length > 0
            ? `<p style="color: var(--text-muted); font-size: 12px; margin: 8px 0 0 0;">
                   ${aindaVaoAcontecer.length} atendimento(s) ainda por vir hoje não impedem o fechamento.
               </p>`
            : '';
        pendingListEl.innerHTML = `
            <div style="background: rgba(46, 204, 113, 0.1); border: 1px solid rgba(46, 204, 113, 0.3); border-radius: 10px; padding: 12px; text-align: center;">
                <i class="fa-solid fa-check-circle" style="color: #2ecc71; font-size: 1.5rem; margin-bottom: 5px;"></i>
                <p style="color: #2ecc71; font-weight: 600; margin: 0;">Todos os pagamentos até agora estão confirmados!</p>
                ${aviso}
            </div>`;
    }

    // Trava o botão enquanto houver pendência
    const btnConfirmar = document.getElementById('btn-confirm-close-register');
    if (btnConfirmar) {
        btnConfirmar.disabled = travamFechamento.length > 0;
        btnConfirmar.title = travamFechamento.length > 0
            ? 'Confirme os pagamentos pendentes para liberar o fechamento do caixa.'
            : '';
    }

    // Populate the cash summary
    const gaveta = resumoDaGaveta(active);
    document.getElementById('close-reg-initial').innerText = formatCurrency(gaveta.inicial);
    document.getElementById('close-reg-cash-in').innerText = formatCurrency(gaveta.entradas);
    document.getElementById('close-reg-cash-out').innerText = formatCurrency(gaveta.saidas);
    document.getElementById('close-reg-final').innerText = formatCurrency(gaveta.saldo);

    openModal('modal-close-register');
};

// Fecha o modal do caixa e leva até o painel "Confirmar Pagamentos", que fica
// na mesma página do Financeiro.
window.irParaConfirmarPagamentos = function () {
    closeModal('modal-close-register');
    const painel = document.getElementById('dash-pending-payments-list');
    if (painel) {
        painel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

// Confirm close register button
document.getElementById('btn-confirm-close-register').addEventListener('click', () => {
    const active = window.getCurrentCashRegister();
    if (!active) return;

    // O botão já fica desabilitado quando há pendência, mas a conferência é
    // refeita aqui: entre abrir o modal e clicar, um atendimento pode ter
    // passado da hora e virado pendente.
    const pendentes = pagamentosPendentesAte(new Date());
    if (pendentes.length > 0) {
        showToast(`Ainda há ${pendentes.length} pagamento(s) pendente(s). Confirme todos antes de fechar o caixa.`, 'danger');
        window.closeCashRegister();
        return;
    }

    // O saldo é calculado ANTES de carimbar o fechamento: com dateClosed já
    // preenchido, resumoDaGaveta cortaria os lançamentos feitos neste mesmo
    // instante.
    active.finalCash = resumoDaGaveta(active).saldo;
    active.dateClosed = new Date().toISOString();
    active.status = 'closed';

    saveData(STATE_KEYS.CASH_REGISTERS, data.cashRegisters);
    showToast("Caixa fechado com sucesso!", "success");
    closeModal('modal-close-register');
    renderFinance();

    // Extrato do fechamento sai sozinho: é o documento daquela sessão de caixa
    // e fecha a janela do próximo extrato.
    gerarExtratoDia({ caixa: active, automatico: true });
});



// --- 12. EXTRATOS EM PDF (FINANCEIRO) ---------------------------------------
// jsPDF e o autoTable entram por CDN com "defer", então podem ainda não estar
// prontos quando o usuário clica. Os geradores checam antes de rodar.

const PDF_DOURADO = [201, 162, 75];
const PDF_ESCURO = [12, 17, 15];
const PDF_CINZA = [110, 120, 115];
const PDF_VERDE = [22, 140, 100];
const PDF_VERMELHO = [200, 50, 70];

function pdfDisponivel() {
    const ok = window.jspdf && window.jspdf.jsPDF;
    if (!ok) {
        showToast('Gerador de PDF ainda carregando. Tente de novo em instantes.', 'warning');
    }
    return ok;
}

function nomeDoSalao() {
    return (data.businessInfo && data.businessInfo.name) || 'Barbearia';
}

function nomeDoProfissional(profId) {
    const p = data.professionals.find(x => x.id === profId);
    return p ? p.name : '—';
}

// Cabeçalho comum: marca, título e subtítulo. Devolve o Y onde o corpo começa.
function pdfCabecalho(doc, titulo, subtitulo) {
    const larguraPag = doc.internal.pageSize.getWidth();

    doc.setFillColor(PDF_ESCURO[0], PDF_ESCURO[1], PDF_ESCURO[2]);
    doc.rect(0, 0, larguraPag, 26, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(nomeDoSalao(), 14, 12);

    doc.setTextColor(PDF_DOURADO[0], PDF_DOURADO[1], PDF_DOURADO[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(titulo, 14, 19);

    doc.setTextColor(180, 188, 184);
    doc.setFontSize(8);
    doc.text(subtitulo, larguraPag - 14, 19, { align: 'right' });

    return 34;
}

// Rodapé com paginação e data de emissão, aplicado em todas as páginas.
function pdfRodape(doc) {
    const total = doc.internal.getNumberOfPages();
    const larguraPag = doc.internal.pageSize.getWidth();
    const alturaPag = doc.internal.pageSize.getHeight();
    const emissao = new Date().toLocaleString('pt-BR');

    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(PDF_CINZA[0], PDF_CINZA[1], PDF_CINZA[2]);
        doc.text('Emitido em ' + emissao, 14, alturaPag - 8);
        doc.text('Página ' + i + ' de ' + total, larguraPag - 14, alturaPag - 8, { align: 'right' });
    }
}

// Faixa de cartões com os números principais.
function pdfResumo(doc, y, itens) {
    const larguraPag = doc.internal.pageSize.getWidth();
    const larguraUtil = larguraPag - 28;
    const larguraCard = larguraUtil / itens.length;

    itens.forEach(function (item, i) {
        const x = 14 + i * larguraCard;
        const cor = item.cor || PDF_ESCURO;

        doc.setDrawColor(225, 228, 226);
        doc.setFillColor(248, 249, 248);
        doc.roundedRect(x + 1, y, larguraCard - 2, 16, 2, 2, 'FD');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(PDF_CINZA[0], PDF_CINZA[1], PDF_CINZA[2]);
        doc.text(item.rotulo, x + 4, y + 6);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(cor[0], cor[1], cor[2]);
        doc.text(item.valor, x + 4, y + 12.5);
    });

    return y + 24;
}

function estiloTabela(y) {
    return {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2.5, lineColor: [225, 228, 226], textColor: [40, 45, 42] },
        headStyles: { fillColor: PDF_ESCURO, textColor: PDF_DOURADO, fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [250, 251, 250] },
        margin: { left: 14, right: 14 }
    };
}

function tituloSecao(doc, y, texto) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(PDF_ESCURO[0], PDF_ESCURO[1], PDF_ESCURO[2]);
    doc.text(texto, 14, y);
    return y + 3;
}

function baixarPdf(doc, partes) {
    // Data E hora no nome: dois extratos no mesmo dia (o avulso e o do
    // fechamento de caixa) tinham nome idêntico, e o segundo sobrescrevia o
    // primeiro na pasta de downloads.
    const agora = new Date();
    const hora = String(agora.getHours()).padStart(2, '0') + String(agora.getMinutes()).padStart(2, '0');
    const nome = partes.concat([getLocalDateString(agora), hora])
        .filter(Boolean).map(sanitizeSlug).join('-');
    doc.save(nome + '.pdf');
}

// Marca até onde o último extrato do dia já prestou contas. Fica só neste
// aparelho de propósito: é um marcador de emissão de documento, não dado do
// salão.
const CHAVE_ULTIMO_EXTRATO = 'lexion_ultimo_extrato_dia';

// Janela coberta pelo extrato do dia: do último extrato emitido até agora.
// É isso que impede que algo escape entre um extrato e o seguinte — inclusive
// pagamento de dia anterior confirmado hoje, que era exatamente o que sumia.
// Sem extrato anterior, começa na abertura do caixa; sem caixa, no início do dia.
function janelaDoExtratoDia(caixa) {
    const fim = new Date().toISOString();
    const ultimo = localStorage.getItem(CHAVE_ULTIMO_EXTRATO);

    if (ultimo) return { inicio: ultimo, fim: fim, origem: 'desde o último extrato' };
    if (caixa && caixa.dateOpened) return { inicio: caixa.dateOpened, fim: fim, origem: 'desde a abertura do caixa' };

    const inicioDoDia = new Date();
    inicioDoDia.setHours(0, 0, 0, 0);
    return { inicio: inicioDoDia.toISOString(), fim: fim, origem: 'desde o início do dia' };
}

function dataHoraBR(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

// --- Extrato do Dia: presta contas da janela desde o último extrato ---------
// opcoes.caixa      -> caixa a descrever (o fechamento passa o que acabou de fechar)
// opcoes.automatico -> emitido pelo fechamento de caixa, cobre a sessão inteira
function gerarExtratoDia(opcoes) {
    if (!pdfDisponivel()) return;

    const cfg = opcoes || {};
    const caixa = cfg.caixa || (window.getCurrentCashRegister ? window.getCurrentCashRegister() : null);

    // No fechamento o documento é da SESSÃO inteira, da abertura ao fechamento:
    // o saldo em gaveta se refere a ela, e um recorte parcial não fecharia com
    // esse saldo. Nos extratos avulsos, vale a janela desde o último emitido.
    const janela = (cfg.automatico && caixa && caixa.dateOpened)
        ? { inicio: caixa.dateOpened, fim: caixa.dateClosed || new Date().toISOString(), origem: 'sessão de caixa completa' }
        : janelaDoExtratoDia(caixa);

    const naJanela = data.transactions.filter(function (t) {
        const quando = momentoDoLancamento(t);
        return quando >= janela.inicio && quando <= janela.fim;
    }).sort(function (a, b) {
        return momentoDoLancamento(a).localeCompare(momentoDoLancamento(b));
    });

    if (naJanela.length === 0 && !caixa && !cfg.automatico) {
        showToast('Nenhuma movimentação nova desde o último extrato.', 'info');
        return;
    }

    const doc = new window.jspdf.jsPDF();
    let y = pdfCabecalho(doc, 'Extrato do Caixa — Diário',
        dataHoraBR(janela.inicio) + ' até ' + dataHoraBR(janela.fim) + '  (' + janela.origem + ')');

    // Pendentes ficam fora dos totais, igual à tela do Financeiro.
    const efetivadas = naJanela.filter(function (t) { return t.status !== 'pending'; });
    const entradas = efetivadas.filter(function (t) { return t.type === 'income'; })
        .reduce(function (s, t) { return s + t.amount; }, 0);
    const saidas = efetivadas.filter(function (t) { return t.type === 'expense'; })
        .reduce(function (s, t) { return s + t.amount; }, 0);

    // Comissões da janela, calculadas em cima dos próprios lançamentos de
    // serviço — não tentando casar cada atendimento com a transação dele.
    // Casar por profissional e data erra quando o mesmo profissional atende o
    // mesmo cliente duas vezes no dia; aqui a comissão sai do dinheiro que
    // realmente entrou nesta janela.
    const servicosNaJanela = efetivadas.filter(function (t) {
        return t.type === 'income' && t.category === 'Serviço' && t.profId;
    });
    const comissaoTotal = servicosNaJanela.reduce(function (s, t) {
        const prof = data.professionals.find(function (p) { return p.id === t.profId; });
        if (!prof || !prof.commission) return s;
        return s + (Number(t.amount) || 0) * (Number(prof.commission) / 100);
    }, 0);

    const gaveta = resumoDaGaveta(caixa);

    y = pdfResumo(doc, y, [
        { rotulo: 'ENTRADAS', valor: formatCurrency(entradas), cor: PDF_VERDE },
        { rotulo: 'SAÍDAS', valor: formatCurrency(saidas), cor: PDF_VERMELHO },
        { rotulo: 'RESULTADO', valor: formatCurrency(entradas - saidas) },
        { rotulo: 'COMISSÕES', valor: formatCurrency(comissaoTotal), cor: [150, 115, 40] },
        { rotulo: 'SALDO EM GAVETA', valor: caixa ? formatCurrency(gaveta.saldo) : '—' }
    ]);

    y = tituloSecao(doc, y, 'Situação do caixa');

    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Situação', 'Abertura', 'Valor inicial', 'Fechamento', 'Valor final']],
        body: [[
            caixa ? (caixa.status === 'open' ? 'Aberto' : 'Fechado') : 'Sem caixa',
            caixa && caixa.dateOpened ? dataHoraBR(caixa.dateOpened) : '—',
            caixa ? formatCurrency(gaveta.inicial) : '—',
            caixa && caixa.dateClosed ? dataHoraBR(caixa.dateClosed) : '—',
            caixa && caixa.finalCash != null ? formatCurrency(parseFloat(caixa.finalCash) || 0) : '—'
        ]]
    }));

    y = doc.lastAutoTable.finalY + 10;

    // --- Comissões por profissional -----------------------------------------
    y = tituloSecao(doc, y, 'Comissões no período (' + servicosNaJanela.length + ' atendimento(s) pago(s))');

    const linhasComissao = data.professionals.filter(function (p) {
        return servicosNaJanela.some(function (t) { return t.profId === p.id; });
    }).map(function (p) {
        const meus = servicosNaJanela.filter(function (t) { return t.profId === p.id; });
        const faturado = meus.reduce(function (s, t) { return s + (Number(t.amount) || 0); }, 0);
        const comissao = faturado * ((Number(p.commission) || 0) / 100);
        return [p.name, String(meus.length), formatCurrency(faturado),
            (p.commission || 0) + '%', formatCurrency(comissao), formatCurrency(faturado - comissao)];
    });

    if (linhasComissao.length === 0) {
        // Distingue "não houve atendimento" de "o percentual não foi
        // cadastrado" — sem isso, comissão zerada vira um mistério.
        const semPercentual = data.professionals.length > 0 &&
            data.professionals.every(function (p) { return !p.commission; });
        linhasComissao.push([{
            content: semPercentual
                ? 'Nenhum profissional tem percentual de comissão cadastrado. Preencha em Configurações > Profissionais.'
                : 'Nenhum atendimento com pagamento confirmado neste período.',
            colSpan: 6, styles: { halign: 'center', textColor: PDF_CINZA }
        }]);
    }

    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Profissional', 'Atend.', 'Faturado', 'Comissão %', 'Comissão R$', 'Líquido barbearia']],
        body: linhasComissao,
        columnStyles: {
            1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'center' },
            4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' }
        }
    }));

    y = doc.lastAutoTable.finalY + 10;
    y = tituloSecao(doc, y, 'Movimentações do período (' + naJanela.length + ')');

    const linhas = naJanela.map(function (t) {
        return [
            dataHoraBR(momentoDoLancamento(t)),
            t.type === 'income' ? 'Entrada' : 'Saída',
            t.description || '—',
            t.profId ? nomeDoProfissional(t.profId) : '—',
            t.paymentMethod || '—',
            t.status === 'pending' ? 'Pendente' : 'Efetivada',
            (t.type === 'income' ? '+ ' : '- ') + formatCurrency(t.amount)
        ];
    });

    if (linhas.length === 0) {
        linhas.push([{ content: 'Nenhuma movimentação nesta janela.', colSpan: 7,
            styles: { halign: 'center', textColor: PDF_CINZA } }]);
    }

    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Lançado em', 'Tipo', 'Descrição', 'Profissional', 'Pagamento', 'Status', 'Valor']],
        body: linhas,
        columnStyles: { 6: { halign: 'right', fontStyle: 'bold' } }
    }));

    pdfRodape(doc);
    baixarPdf(doc, ['extrato-diario', nomeDoSalao()]);

    // Só depois de emitido o marcador avança: se o PDF falhar, a próxima
    // tentativa ainda cobre a mesma janela em vez de perder o período.
    localStorage.setItem(CHAVE_ULTIMO_EXTRATO, janela.fim);

    showToast(cfg.automatico
        ? 'Caixa fechado e extrato gerado!'
        : 'Extrato gerado (' + janela.origem + ').', 'success');
}

// --- Extrato do Período: respeita os filtros da tela -----------------------
function gerarExtratoPeriodo() {
    if (!pdfDisponivel()) return;

    const rotulos = { daily: 'Hoje', weekly: 'Últimos 7 dias', monthly: 'Últimos 30 dias' };
    const rotuloPeriodo = rotulos[currentFinancePeriod] || 'Período';

    // Mesma janela de datas de renderFinance(), para os números baterem com a tela.
    const agora = new Date();
    const inicio = new Date(agora);
    if (currentFinancePeriod === 'daily') inicio.setHours(0, 0, 0, 0);
    else if (currentFinancePeriod === 'weekly') inicio.setDate(agora.getDate() - 7);
    else inicio.setDate(agora.getDate() - 30);
    const inicioStr = getLocalDateString(inicio);

    const geral = currentFinanceProfId === 'all';
    const alvo = geral ? 'Geral — todos os profissionais' : nomeDoProfissional(currentFinanceProfId);

    const transacoes = data.transactions.filter(function (t) {
        return (geral || t.profId === currentFinanceProfId) && t.date >= inicioStr;
    });
    const efetivadas = transacoes.filter(function (t) { return t.status !== 'pending'; });
    const entradas = efetivadas.filter(function (t) { return t.type === 'income'; })
        .reduce(function (s, t) { return s + t.amount; }, 0);
    const saidas = efetivadas.filter(function (t) { return t.type === 'expense'; })
        .reduce(function (s, t) { return s + t.amount; }, 0);

    const atendimentos = data.appointments.filter(function (a) {
        return atendimentoRealizado(a) &&
            (geral || a.profId === currentFinanceProfId) && a.date >= inicioStr;
    });

    let somaTicket = 0;
    let comissaoTotal = 0;
    atendimentos.forEach(function (a) {
        const srv = data.services.find(function (s) { return s.id === a.serviceId; });
        if (!srv) return;
        somaTicket += srv.price;
        const prof = data.professionals.find(function (p) { return p.id === a.profId; });
        if (prof && prof.commission) comissaoTotal += srv.price * (prof.commission / 100);
    });
    const ticketMedio = atendimentos.length > 0 ? somaTicket / atendimentos.length : 0;

    const doc = new window.jspdf.jsPDF();
    let y = pdfCabecalho(doc, 'Extrato do Período — ' + rotuloPeriodo,
        inicio.toLocaleDateString('pt-BR') + ' a ' + agora.toLocaleDateString('pt-BR'));

    y = tituloSecao(doc, y, alvo) + 3;

    y = pdfResumo(doc, y, [
        { rotulo: 'FATURAMENTO', valor: formatCurrency(entradas), cor: PDF_VERDE },
        { rotulo: 'GASTOS', valor: formatCurrency(saidas), cor: PDF_VERMELHO },
        { rotulo: 'LUCRO', valor: formatCurrency(entradas - saidas) },
        { rotulo: 'TICKET MÉDIO', valor: formatCurrency(ticketMedio) },
        { rotulo: 'COMISSÕES', valor: formatCurrency(comissaoTotal), cor: [150, 115, 40] }
    ]);

    if (geral) {
        // Visão consolidada: uma linha por profissional.
        y = tituloSecao(doc, y, 'Desempenho por profissional');

        const linhas = data.professionals.map(function (p) {
            const meus = atendimentos.filter(function (a) { return a.profId === p.id; });
            let faturado = 0;
            let comissao = 0;
            meus.forEach(function (a) {
                const srv = data.services.find(function (s) { return s.id === a.serviceId; });
                if (!srv) return;
                faturado += srv.price;
                if (p.commission) comissao += srv.price * (p.commission / 100);
            });
            return [p.name, String(meus.length), formatCurrency(faturado),
                (p.commission || 0) + '%', formatCurrency(comissao), formatCurrency(faturado - comissao)];
        });

        if (linhas.length === 0) {
            linhas.push([{ content: 'Nenhum profissional cadastrado.', colSpan: 6,
                styles: { halign: 'center', textColor: PDF_CINZA } }]);
        }

        doc.autoTable(Object.assign(estiloTabela(y), {
            head: [['Profissional', 'Atend.', 'Faturado', 'Comissão %', 'Comissão R$', 'Líquido barbearia']],
            body: linhas,
            columnStyles: {
                1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'center' },
                4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' }
            }
        }));
    } else {
        // Visão individual: atendimento a atendimento.
        y = tituloSecao(doc, y, 'Atendimentos realizados (' + atendimentos.length + ')');

        const prof = data.professionals.find(function (p) { return p.id === currentFinanceProfId; });
        const pct = prof && prof.commission ? prof.commission : 0;

        const linhas = atendimentos.slice().sort(function (a, b) {
            return (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
        }).map(function (a) {
            const srv = data.services.find(function (s) { return s.id === a.serviceId; });
            const cli = data.clients.find(function (c) { return c.id === a.clientId; });
            const preco = srv ? srv.price : 0;
            return [
                a.date.split('-').reverse().join('/'),
                a.time || '—',
                cli ? cli.name : '—',
                srv ? srv.name : '—',
                formatCurrency(preco),
                formatCurrency(preco * (pct / 100))
            ];
        });

        if (linhas.length === 0) {
            linhas.push([{ content: 'Nenhum atendimento pago no período.', colSpan: 6,
                styles: { halign: 'center', textColor: PDF_CINZA } }]);
        }

        doc.autoTable(Object.assign(estiloTabela(y), {
            head: [['Data', 'Hora', 'Cliente', 'Serviço', 'Valor', 'Comissão (' + pct + '%)']],
            body: linhas,
            columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } }
        }));
    }

    y = doc.lastAutoTable.finalY + 10;

    if (y > doc.internal.pageSize.getHeight() - 50) {
        doc.addPage();
        y = 20;
    }
    y = tituloSecao(doc, y, 'Movimentações financeiras (' + transacoes.length + ')');

    const linhasMov = transacoes.slice().sort(function (a, b) {
        return a.date.localeCompare(b.date);
    }).map(function (t) {
        return [
            t.date.split('-').reverse().join('/'),
            t.type === 'income' ? 'Entrada' : 'Saída',
            t.description || '—',
            t.paymentMethod || '—',
            t.status === 'pending' ? 'Pendente' : 'Efetivada',
            (t.type === 'income' ? '+ ' : '- ') + formatCurrency(t.amount)
        ];
    });

    if (linhasMov.length === 0) {
        linhasMov.push([{ content: 'Nenhuma movimentação no período.', colSpan: 6,
            styles: { halign: 'center', textColor: PDF_CINZA } }]);
    }

    doc.autoTable(Object.assign(estiloTabela(y), {
        head: [['Data', 'Tipo', 'Descrição', 'Pagamento', 'Status', 'Valor']],
        body: linhasMov,
        columnStyles: { 5: { halign: 'right', fontStyle: 'bold' } }
    }));

    pdfRodape(doc);
    // Nome distinto por periodo e por alvo: gerando um PDF por profissional,
    // os arquivos nao se sobrescrevem na pasta de downloads.
    baixarPdf(doc, ['extrato', rotuloPeriodo, geral ? 'geral' : alvo, nomeDoSalao()]);
    showToast('Extrato do período gerado!', 'success');
}
