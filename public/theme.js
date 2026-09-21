/**
 * ThemeManager & Multi-Nicho Engine
 * Gerencia cores personalizadas e termos adaptativos para:
 * - Barbearia
 * - Salão de Beleza
 * - Estética / Manicure / Spa
 */

const ThemeManager = {
    // Os dois temas visuais do painel. O nome do modo é o que vai para o banco
    // (business_info.theme) e para o atributo data-theme do documento; toda a
    // paleta em si vive no index.css, não aqui.
    MODES: {
        escuro: {
            id: 'escuro',
            name: 'Escuro Nobre',
            description: 'Verde profundo e dourado latão. O visual original da Lexion.',
            swatch: ['#07100B', '#0D1A14', '#C5A059']
        },
        claro: {
            id: 'claro',
            name: 'Bege Quente',
            description: 'Fundo claro e dourado tostado, para salões de ambiente iluminado.',
            swatch: ['#F6F1E8', '#EFE7D9', '#8A6A3B']
        }
    },

    MODE_PADRAO: 'escuro',

    // Cópia local da escolha. O tema de verdade mora no banco, mas ele só chega
    // depois do login e de uma ida à rede: sem esta cópia, todo carregamento
    // começaria escuro e piscaria para claro alguns segundos depois.
    STORAGE_KEY: 'lexion_theme_mode',

    modoAtual: 'escuro',

    modoValido(modo) {
        return Object.prototype.hasOwnProperty.call(this.MODES, modo) ? modo : this.MODE_PADRAO;
    },

    /**
     * Escreve o tema no documento. É o único lugar que mexe no data-theme.
     */
    applyMode(modo) {
        const alvo = this.modoValido(modo);
        this.modoAtual = alvo;

        // O escuro é o :root puro; só o claro precisa do atributo.
        if (alvo === this.MODE_PADRAO) {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', alvo);
        }

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
        return this.applyMode(lembrado || this.MODE_PADRAO);
    },

    getMode() {
        return this.modoAtual;
    },

    // Presets de cores recomendados por segmento
    PRESETS: {
        barbearia: [
            { name: 'Ouro Vintage (Padrão)', primary: '#d4af37', secondary: '#18181b' },
            { name: 'Âmbar Clássico', primary: '#f59e0b', secondary: '#1c1917' },
            { name: 'Azul Petróleo Nobre', primary: '#0284c7', secondary: '#0f172a' },
            { name: 'Rubi Intenso', primary: '#e11d48', secondary: '#18181b' }
        ],
        salao: [
            { name: 'Rose Gold Luxury', primary: '#f43f5e', secondary: '#1c1917' },
            { name: 'Violeta Glamour', primary: '#8b5cf6', secondary: '#09090b' },
            { name: 'Esmeralda Sofisticado', primary: '#10b981', secondary: '#064e3b' },
            { name: 'Cobre Acobreado', primary: '#ea580c', secondary: '#1c1917' }
        ],
        estetica: [
            { name: 'Lavanda & Spa', primary: '#a855f7', secondary: '#18181b' },
            { name: 'Turquesa Clean', primary: '#06b6d4', secondary: '#0f172a' },
            { name: 'Nude Rosé', primary: '#fb7185', secondary: '#1f1f23' },
            { name: 'Verde Menta Suave', primary: '#14b8a6', secondary: '#134e4a' }
        ]
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
        const cor = this.getMode() === 'claro'
            ? this.escurecerAteLer(primaryColor, '#F6F1E8', 3.2)
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

    /**
     * Aplica o tema completo a partir dos dados do salão (business_info)
     */
    applyTheme(businessInfo) {
        if (!businessInfo) return;

        const type = businessInfo.business_type || businessInfo.businessType || 'barbearia';
        const primary = businessInfo.primary_color || businessInfo.primaryColor || '#d4af37';
        const secondary = businessInfo.secondary_color || businessInfo.secondaryColor || '#18181b';

        // Claro ou escuro vem do cadastro do salão e vale para a equipe toda.
        // Um salão que nunca escolheu fica no escuro, como sempre foi.
        this.applyMode(businessInfo.theme || businessInfo.themeMode || this.MODE_PADRAO);

        this.applyColors(primary, secondary);
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
