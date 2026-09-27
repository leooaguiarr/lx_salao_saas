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
        // Sem valor (link público antes da migração 10, que passa a devolver o
        // tema) vale o mesmo que 'escuro', o DEFAULT da coluna: o do nicho.
        const legado = this.LEGADO[valor || 'escuro'];
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
    // `opcoes.lembrar === false`: aplica sem gravar no aparelho. É o caso do
    // link público — o dono que abre o link de OUTRO salão não pode ter o
    // tema do próprio painel trocado por isso.
    applyMode(modo, opcoes) {
        const alvo = this.temaDoSalao(modo, this.nichoAtual);
        const tema = this.TEMAS[alvo];
        this.modoAtual = alvo;

        const raiz = document.documentElement;
        raiz.setAttribute('data-theme', alvo);
        raiz.setAttribute('data-base', tema.base);
        raiz.setAttribute('data-personalidade', tema.personalidade);

        if (!opcoes || opcoes.lembrar !== false) {
            // O tema certo do painel agora é conhecido: a tela de carregamento
            // (se voltar, no login) pode usar as cores dele. Ver o <head>.
            raiz.removeAttribute('data-boot-neutro');
            try {
                localStorage.setItem(this.STORAGE_KEY, alvo);
            } catch (err) {
                // Navegador com armazenamento bloqueado: o tema ainda funciona
                // nesta sessão, só não é lembrado na próxima.
            }
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

    /* COR DE DESTAQUE (acento). A paleta curada que a tela mostra: a cor do
       próprio tema primeiro, depois sete tons pensados para a base — claros o
       bastante para ler sobre fundo escuro, escuros o bastante sobre fundo
       claro. Quem tem identidade própria usa "Usar a cor da minha marca". */
    ACENTOS: {
        escuro: ['#C8862F', '#D1A54A', '#D07A55', '#D08BA0', '#A99BD6', '#8FB0CF', '#9BA7B4'],
        claro: ['#8C3A2E', '#A0455C', '#7A4A7E', '#1F5C73', '#2E4A7A', '#5A7446', '#A2603C']
    },

    // null = o acento do próprio tema (o do index.css).
    acentoAtual: null,

    acentosDoTema(id) {
        const tema = this.TEMAS[id] || this.TEMAS[this.TEMA_PADRAO];
        const proprio = tema.amostra[2].toUpperCase();
        return [proprio, ...this.ACENTOS[tema.base].filter(c => c.toUpperCase() !== proprio)];
    },

    /**
     * Aplica uma cor de destaque por cima do tema. Mexe SÓ nas variáveis do
     * acento: fundo, cartões e texto continuam os do tema, e é isso que
     * impede o salão de deixar o próprio painel ilegível.
     *
     * A cor passa por ajustarAteLer: clareia (base escura) ou escurece (base
     * clara) até ler a 4,5:1 sobre fundo e cartão, preservando o matiz — um
     * salão de identidade rosa continua rosa, num tom que dá para ler.
     */
    aplicarAcento(corEscolhida, opcoes) {
        const lembrar = !opcoes || opcoes.lembrar !== false;
        const tema = this.TEMAS[this.getMode()];
        if (!corEscolhida || !tema || corEscolhida.toUpperCase() === tema.amostra[2].toUpperCase()) {
            this.acentoAtual = null;
            this.limparCores();
            if (lembrar) this.guardarAcento(null);
            return null;
        }
        const [fundo, cartao] = tema.amostra;
        const escuro = tema.base === 'escuro';
        const cor = this.ajustarAteLer(corEscolhida, [fundo, cartao], 4.5, escuro);
        // Texto dentro do botão: branco quando lê, senão o fundo do tema.
        const sobre = this.contraste('#FFFFFF', cor) >= 4.5 ? '#FFFFFF'
            : (this.contraste(fundo, cor) >= 4.5 ? fundo : '#111111');

        const vars = {
            '--accent-gold': cor,
            '--primary': cor,
            '--primary-color': cor,
            '--text-accent-gold': sobre,
            '--primary-hover': this.misturar(cor, escuro ? '#FFFFFF' : '#000000', 0.18),
            '--primary-dark': this.misturar(cor, '#000000', 0.3),
            '--primary-light': this.hexToRgba(cor, 0.16),
            '--primary-soft': this.hexToRgba(cor, 0.10),
            '--primary-medium': this.hexToRgba(cor, 0.18),
            '--primary-ring': this.hexToRgba(cor, 0.30),
            '--primary-edge': this.hexToRgba(cor, 0.35),
            '--primary-strong': this.hexToRgba(cor, 0.45),
            '--primary-glow': this.hexToRgba(cor, 0.35),
            '--border-color-active': this.hexToRgba(cor, 0.45),
            '--shadow-glow': `0 0 18px ${this.hexToRgba(cor, 0.22)}`,
            '--primary-gradient': `linear-gradient(135deg, ${this.misturar(cor, '#FFFFFF', 0.06)}, ${this.misturar(cor, '#000000', 0.08)})`,
            '--primary-gradient-hover': `linear-gradient(135deg, ${this.misturar(cor, '#FFFFFF', 0.14)}, ${cor})`
        };
        const root = document.documentElement;
        Object.entries(vars).forEach(([nome, valor]) => root.style.setProperty(nome, valor));
        this.acentoAtual = corEscolhida;
        if (lembrar) this.guardarAcento(vars);
        return cor;
    },

    /* As variáveis já calculadas do acento ficam guardadas no aparelho, junto
       com o tema. O script curto do <head> do index.html as aplica antes da
       primeira pintura — sem isso a tela nascia com a cor do tema e trocava
       para a da marca um segundo depois, quando o banco respondia. Guarda o
       resultado, e não a cor crua, porque o <head> não tem como refazer o
       ajuste de contraste antes do theme.js carregar. */
    ACENTO_KEY: 'lexion_theme_acento',

    guardarAcento(vars) {
        try {
            if (vars) localStorage.setItem(this.ACENTO_KEY, JSON.stringify(vars));
            else localStorage.removeItem(this.ACENTO_KEY);
        } catch (err) {
            // Armazenamento bloqueado: a cor só não é lembrada na próxima.
        }
    },

    // Mantido para quem ainda chama o nome antigo.
    applyColors(primaryColor, opcoes) {
        return this.aplicarAcento(primaryColor, opcoes);
    },

    /**
     * Clareia (ou escurece) a cor em passos pequenos até ela alcançar o
     * contraste pedido sobre TODOS os fundos dados.
     */
    ajustarAteLer(cor, fundos, minimo, clarear) {
        let atual = cor;
        // 30 passos de 5% vão da cor até quase branco ou preto; o limite
        // existe para uma cor impossível não virar laço infinito.
        for (let i = 0; i < 30; i++) {
            if (fundos.every(f => this.contraste(atual, f) >= minimo)) return atual;
            atual = this.misturar(atual, clarear ? '#FFFFFF' : '#000000', 0.05);
        }
        return atual;
    },

    escurecerAteLer(cor, fundo, minimo) {
        return this.ajustarAteLer(cor, [fundo], minimo, false);
    },

    // Mistura `cor` com `alvo` na proporção `t` (0 = cor, 1 = alvo).
    misturar(cor, alvo, t) {
        const a = this.rgb(cor), b = this.rgb(alvo);
        return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
    },

    rgb(hex) {
        let c = String(hex).replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
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

    // A cor da marca guardada em primary_color. String vazia é "sem cor
    // própria" (a coluna é NOT NULL; é o que o "Voltar ao padrão" grava).
    corEscolhidaPeloSalao(cor) {
        if (!cor || !/^#[0-9a-f]{6}$/i.test(String(cor).trim())) return null;
        return this.CORES_DE_FABRICA.includes(String(cor).trim().toLowerCase()) ? null : String(cor).trim();
    },

    // Devolve o acento ao do tema (o do CSS), apagando o que aplicarAcento pôs.
    limparCores() {
        const root = document.documentElement;
        ['--accent-gold', '--primary', '--primary-color', '--text-accent-gold', '--primary-hover',
            '--primary-dark', '--primary-light', '--primary-soft', '--primary-medium', '--primary-ring',
            '--primary-edge', '--primary-strong', '--primary-glow', '--border-color-active',
            '--shadow-glow', '--primary-gradient', '--primary-gradient-hover']
            .forEach(nome => root.style.removeProperty(nome));
    },

    /**
     * Aplica o tema completo a partir dos dados do salão (business_info).
     * `opcoes.lembrar === false` no link público (ver applyMode).
     */
    applyTheme(businessInfo, opcoes) {
        if (!businessInfo) return;

        const type = businessInfo.business_type || businessInfo.businessType || 'barbearia';
        this.nichoAtual = type;

        // Cadastro sem tema = ainda não veio do banco (o boot chama isto com o
        // cache vazio antes do login). Aplicar tudo bem, mas não guardar nem
        // dar o tema como conhecido: senão o aparelho novo "lembraria" o tema
        // padrão e a tela de carregamento do login sairia com ele.
        if (!businessInfo.theme && !businessInfo.themeMode) {
            opcoes = Object.assign({}, opcoes, { lembrar: false });
        }

        // O tema vem do cadastro do salão e vale para a equipe toda. Quem
        // nunca escolheu (ou escolheu no tempo do claro/escuro) cai no tema
        // do próprio nicho — ver LEGADO.
        this.applyMode(businessInfo.theme || businessInfo.themeMode, opcoes);

        // A cor da marca, por cima do tema. As cores de fábrica que o banco
        // grava sozinho não contam como escolha (CORES_DE_FABRICA).
        this.aplicarAcento(this.corEscolhidaPeloSalao(businessInfo.primary_color || businessInfo.primaryColor), opcoes);
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
