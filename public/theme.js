/**
 * ThemeManager & Multi-Nicho Engine
 * Gerencia cores personalizadas e termos adaptativos para:
 * - Barbearia
 * - Salão de Beleza
 * - Estética / Manicure / Spa
 */

const ThemeManager = {
    /* Os nove temas (instrucoes-ia/DESIGN_E_TEMAS.md). O id é o que vai para
       o banco (business_info.theme) e para o data-theme do documento; as
       cores vivem no index.css. `base` e `personalidade` viram data-base e
       data-personalidade — é deles que saem sombra, fonte e raio de canto.
       A amostra é [fundo, superfície, acento], as cores de verdade do tema.

       Ao mexer nesta lista, atualize também o mapa curto do <head> do
       index.html, que aplica o tema antes da primeira pintura. */
    TEMAS: {
        oldschool: { nome: 'Oldschool', nicho: 'barbearia', base: 'escuro', personalidade: 'classica',
            descricao: 'Café escuro e cobre.',
            amostra: ['#17130F', '#201A14', '#C8862F'] },
        aco: { nome: 'Aço', nicho: 'barbearia', base: 'escuro', personalidade: 'classica',
            descricao: 'Grafite e aço escovado.',
            amostra: ['#131417', '#1C1E22', '#9BA7B4'] },
        navalha: { nome: 'Navalha', nicho: 'barbearia', base: 'claro', personalidade: 'classica',
            descricao: 'Papel claro e vermelho-tijolo.',
            amostra: ['#F3F1EC', '#FFFFFF', '#8C3A2E'] },
        rose: { nome: 'Rosé', nicho: 'salao', base: 'claro', personalidade: 'refinada',
            descricao: 'Branco quente e rosé.',
            amostra: ['#FBF7F5', '#FFFFFF', '#A0455C'] },
        botanico: { nome: 'Botânico', nicho: 'salao', base: 'claro', personalidade: 'refinada',
            descricao: 'Off-white e verde-folha.',
            amostra: ['#F7F6F1', '#FFFFFF', '#5A7446'] },
        noir: { nome: 'Noir Chic', nicho: 'salao', base: 'escuro', personalidade: 'refinada',
            descricao: 'Noite e rosa antigo.',
            amostra: ['#141216', '#1E1A1F', '#D08BA0'] },
        sereno: { nome: 'Sereno', nicho: 'estetica', base: 'claro', personalidade: 'clean',
            descricao: 'Branco e verde-sálvia.',
            amostra: ['#F4F8F6', '#FFFFFF', '#2F6B54'] },
        areia: { nome: 'Areia', nicho: 'estetica', base: 'claro', personalidade: 'clean',
            descricao: 'Areia e terracota.',
            amostra: ['#F8F5F1', '#FFFFFF', '#A2603C'] },
        clinico: { nome: 'Clínico', nicho: 'estetica', base: 'claro', personalidade: 'clean',
            descricao: 'Branco e azul-petróleo.',
            amostra: ['#F4F6F9', '#FFFFFF', '#1F5C73'] }
    },

    NICHOS: {
        barbearia: 'Barbearia',
        salao: 'Salão de beleza',
        estetica: 'Estética e spa'
    },

    TEMA_PADRAO: 'oldschool',

    /* Antes de 26/09/2026 a coluna só guardava 'escuro' ou 'claro' (e é o
       DEFAULT dela). Esses valores viram o tema do nicho com a mesma base:
       quem nunca escolheu abre com a cara do próprio nicho, e quem escolheu
       claro continua no claro. Estética não tem tema escuro. */
    LEGADO: {
        escuro: { barbearia: 'oldschool', salao: 'noir', estetica: 'sereno' },
        claro: { barbearia: 'navalha', salao: 'rose', estetica: 'sereno' }
    },

    // Cópia local da escolha. O tema de verdade mora no banco, mas ele só chega
    // depois do login e de uma ida à rede: sem esta cópia, todo carregamento
    // começaria no tema padrão e trocaria alguns segundos depois.
    STORAGE_KEY: 'lexion_theme_mode',

    modoAtual: 'oldschool',
    nichoAtual: 'barbearia',

    temaDoSalao(valor, nicho) {
        if (this.TEMAS[valor]) return valor;
        const legado = this.LEGADO[valor];
        if (legado) return legado[nicho] || legado.barbearia;
        return this.TEMA_PADRAO;
    },

    // Os temas na ordem da tela de escolha: os do nicho primeiro.
    temasDoNicho(nicho) {
        return Object.keys(this.TEMAS).filter(id => this.TEMAS[id].nicho === nicho);
    },

    /**
     * Escreve o tema no documento. É o único lugar que mexe nos atributos.
     */
    applyMode(modo) {
        const alvo = this.temaDoSalao(modo, this.nichoAtual);
        const tema = this.TEMAS[alvo];
        this.modoAtual = alvo;

        const raiz = document.documentElement;
        raiz.setAttribute('data-theme', alvo);
        raiz.setAttribute('data-base', tema.base);
        raiz.setAttribute('data-personalidade', tema.personalidade);

        try {
            localStorage.setItem(this.STORAGE_KEY, alvo);
        } catch (err) {
            // Navegador com armazenamento bloqueado: o tema ainda funciona
            // nesta sessão, só não é lembrado na próxima.
        }

        document.dispatchEvent(new CustomEvent('tema:alterado', { detail: { modo: alvo } }));
        return alvo;
    },

    /**
     * Aplica o tema lembrado antes de qualquer ida ao banco, para a tela não
     * nascer com a paleta errada e trocar na frente do usuário.
     */
    applyRememberedMode() {
        let lembrado = null;
        try {
            lembrado = localStorage.getItem(this.STORAGE_KEY);
        } catch (err) {
            lembrado = null;
        }
        return this.applyMode(lembrado || this.TEMA_PADRAO);
    },

    getMode() {
        return this.modoAtual;
    },

    // Dicionário de termos por segmento
    VOCABULARY: {
        barbearia: {
            establishmentLabel: 'Barbearia',
            professionalSingular: 'Barbeiro',
            professionalPlural: 'Barbeiros',
            serviceLabel: 'Cortes & Barba',
            clientAction: 'Cortar com',
            headerSubtitle: 'Gerencie sua barbearia com elegância e precisão.',
            emptyAgenda: 'Nenhum agendamento na cadeira hoje.'
        },
        salao: {
            establishmentLabel: 'Salão de Beleza',
            professionalSingular: 'Cabeleireiro(a)',
            professionalPlural: 'Profissionais / Cabeleireiros',
            serviceLabel: 'Cabelo, Mechas & Manicure',
            clientAction: 'Atendimento com',
            headerSubtitle: 'Gerencie seu salão e equipe com excelência.',
            emptyAgenda: 'Nenhum atendimento marcado para hoje.'
        },
        estetica: {
            establishmentLabel: 'Clínica de Estética & Spa',
            professionalSingular: 'Especialista / Terapeuta',
            professionalPlural: 'Especialistas',
            serviceLabel: 'Procedimentos & Sessões',
            clientAction: 'Sessão com',
            headerSubtitle: 'Gestão completa para sua clínica e atendimentos.',
            emptyAgenda: 'Nenhuma sessão agendada para hoje.'
        }
    },

    /**
     * Aplica as cores dinamicamente no CSS do documento
     */
    applyColors(primaryColor, secondaryColor) {
        if (!primaryColor) return;

        // A cor da marca escolhida pelo salão e o tema claro/escuro são duas
        // escolhas independentes que caem no MESMO --primary, e esta função
        // escreve direto no style do <html>, que vence qualquer regra do CSS.
        // Sem o ajuste abaixo, um salão de dourado claro ou rosa ficaria com
        // ícones e links ilegíveis assim que trocasse para o tema bege.
        const tema = this.TEMAS[this.getMode()];
        const cor = tema && tema.base === 'claro'
            ? this.escurecerAteLer(primaryColor, tema.amostra[0], 4.5)
            : primaryColor;

        const root = document.documentElement;
        root.style.setProperty('--primary', cor);
        root.style.setProperty('--primary-color', cor);
        root.style.setProperty('--primary-hover', this.adjustBrightness(cor, -15));
        root.style.setProperty('--primary-light', this.hexToRgba(cor, 0.15));
        root.style.setProperty('--primary-glow', this.hexToRgba(cor, 0.35));

        if (secondaryColor) {
            root.style.setProperty('--secondary-color', secondaryColor);
        }
    },

    /**
     * Escurece a cor em passos pequenos até ela alcançar o contraste pedido
     * sobre o fundo. Preserva o matiz — um salão de identidade rosa continua
     * rosa, só num tom que dá para ler sobre bege.
     */
    escurecerAteLer(cor, fundo, minimo) {
        let atual = cor;
        // 20 passos de 4% cobrem do branco ao quase preto; o limite existe para
        // uma cor impossível não virar laço infinito.
        for (let i = 0; i < 20; i++) {
            if (this.contraste(atual, fundo) >= minimo) return atual;
            atual = this.adjustBrightness(atual, -4);
        }
        return atual;
    },

    contraste(corA, corB) {
        const claro = Math.max(this.luminancia(corA), this.luminancia(corB));
        const escuro = Math.min(this.luminancia(corA), this.luminancia(corB));
        return (claro + 0.05) / (escuro + 0.05);
    },

    luminancia(hex) {
        let c = String(hex).replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        const canais = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map(v => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
    },

    /**
     * Ajusta os termos do sistema na interface com base no tipo de negócio
     */
    applyVocabulary(businessType = 'barbearia') {
        const vocab = this.VOCABULARY[businessType] || this.VOCABULARY.barbearia;
        
        // Elementos que possuem marcadores de vocabulário
        document.querySelectorAll('[data-vocab]').forEach(el => {
            const key = el.getAttribute('data-vocab');
            if (vocab[key]) {
                el.textContent = vocab[key];
            }
        });

        // Atualização dos placeholders e inputs se necessário
        document.querySelectorAll('[data-vocab-placeholder]').forEach(el => {
            const key = el.getAttribute('data-vocab-placeholder');
            if (vocab[key]) {
                el.placeholder = vocab[key];
            }
        });
    },

    // As cores que o banco e o cadastro gravam sozinhos: o DEFAULT da coluna
    // primary_color e as do `typeColors` do server.js. Nenhum salão as
    // escolheu — até 26/09/2026 o painel nem enviava primary_color ao banco
    // (fora da allowedCols do api.js). Aplicá-las escreveria no style do
    // <html> um dourado que vence o acento do tema no index.css.
    CORES_DE_FABRICA: ['#d4af37', '#c89547', '#e0a96d'],

    corEscolhidaPeloSalao(cor) {
        if (!cor) return null;
        return this.CORES_DE_FABRICA.includes(String(cor).trim().toLowerCase()) ? null : cor;
    },

    // Devolve o acento ao do tema (o do CSS), apagando o que applyColors pôs.
    limparCores() {
        const root = document.documentElement;
        ['--primary', '--primary-color', '--primary-hover', '--primary-light', '--primary-glow']
            .forEach(nome => root.style.removeProperty(nome));
    },

    /**
     * Aplica o tema completo a partir dos dados do salão (business_info)
     */
    applyTheme(businessInfo) {
        if (!businessInfo) return;

        const type = businessInfo.business_type || businessInfo.businessType || 'barbearia';
        this.nichoAtual = type;

        // O tema vem do cadastro do salão e vale para a equipe toda. Quem
        // nunca escolheu (ou escolheu no tempo do claro/escuro) cai no tema
        // do próprio nicho — ver LEGADO.
        this.applyMode(businessInfo.theme || businessInfo.themeMode || this.TEMA_PADRAO);

        // A cor da marca saiu da tela em 26/09/2026: o seletor antigo pintava
        // só metade do painel e nunca foi gravado no banco. O acento agora é o
        // do tema. Limpa o que uma prévia antiga tenha deixado no <html>.
        this.limparCores();
        this.applyVocabulary(type);

        // Atualiza o título do documento se houver nome cadastrado
        if (businessInfo.name) {
            document.title = `${businessInfo.name} | Gestão Inteligente`;
        }
    },

    // Utilitários de manipulação de cores
    hexToRgba(hex, alpha = 1) {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
    },

    adjustBrightness(hex, percent) {
        let num = parseInt(hex.replace('#', ''), 16),
            amt = Math.round(2.55 * percent),
            R = (num >> 16) + amt,
            G = (num >> 8 & 0x00FF) + amt,
            B = (num & 0x0000FF) + amt;
        return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
            (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
            (B < 255 ? B < 1 ? 0 : B : 255))
            .toString(16).slice(1);
    }
};

window.ThemeManager = ThemeManager;
