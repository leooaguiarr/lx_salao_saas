/**
 * ThemeManager & Multi-Nicho Engine
 * Gerencia cores personalizadas e termos adaptativos para:
 * - Barbearia
 * - Salão de Beleza
 * - Estética / Manicure / Spa
 */

const ThemeManager = {
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

        const root = document.documentElement;
        root.style.setProperty('--primary', primaryColor);
        root.style.setProperty('--primary-color', primaryColor);
        root.style.setProperty('--primary-hover', this.adjustBrightness(primaryColor, -15));
        root.style.setProperty('--primary-light', this.hexToRgba(primaryColor, 0.15));
        root.style.setProperty('--primary-glow', this.hexToRgba(primaryColor, 0.35));

        if (secondaryColor) {
            root.style.setProperty('--secondary-color', secondaryColor);
        }
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
