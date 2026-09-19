// ============================================================
// CONFIGURAÇÕES GERAIS DA PLATAFORMA (SaaS Multi-Tenant)
// ============================================================
// As variáveis abaixo podem ser sobrescritas diretamente aqui
// ou através de variáveis de ambiente/injeção no Coolify.

window.APP_CONFIG = {
    // ------------------------------------------------------------
    // Supabase Self-Hosted (Coolify Hostinger VPS)
    // ------------------------------------------------------------
    // Substitua pela URL pública do seu Kong no Coolify
    SUPABASE_URL: window.ENV_SUPABASE_URL || 'https://apisalao.lexionconsultoria.tech',
    
    // Cole aqui a Anon Key gerada no Coolify
    SUPABASE_ANON_KEY: window.ENV_SUPABASE_ANON_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4OTg0NjIwMCwiZXhwIjo0OTQ1NTE5ODAwLCJyb2xlIjoiYW5vbiJ9.E9S2LlOKz5rNOPgg-gqwb__Mt0P4KS65xqBRCc70tYE',

    // ------------------------------------------------------------
    // Integração Asaas (Assinaturas e Pagamentos)
    // ------------------------------------------------------------
    ASAAS_ENV: 'sandbox', // 'production' ou 'sandbox'
    ASAAS_API_URL: window.ENV_ASAAS_URL || 'https://sandbox.asaas.com/api/v3',
    
    // ------------------------------------------------------------
    // Identidade do SaaS
    // ------------------------------------------------------------
    PLATFORM_NAME: 'Lexion Salão & Barbearia',
    DEFAULT_TRIAL_DAYS: 7,

    // ------------------------------------------------------------
    // Planos de Assinatura
    // ------------------------------------------------------------
    PLANS: {
        individual: {
            id: 'individual',
            name: 'Plano Solo / Individual',
            price: 59.90,
            maxProfessionals: 1,
            features: {
                booking: true,
                clients: true,
                sales: true,
                cashRegister: true,
                inventory: false,  // Bloqueado
                loyalty: false,    // Bloqueado
                credit: false      // Bloqueado
            }
        },
        equipe_4: {
            id: 'equipe_4',
            name: 'Plano Equipe (Até 4 Profissionais)',
            price: 119.90,
            maxProfessionals: 4,
            features: {
                booking: true,
                clients: true,
                sales: true,
                cashRegister: true,
                inventory: true,   // Liberado
                loyalty: false,    // Bloqueado
                credit: false      // Bloqueado
            }
        },
        ilimitado: {
            id: 'ilimitado',
            name: 'Plano Ilimitado Premium',
            price: 199.90,
            maxProfessionals: 9999,
            features: {
                booking: true,
                clients: true,
                sales: true,
                cashRegister: true,
                inventory: true,   // Liberado
                loyalty: true,     // Liberado
                credit: true       // Liberado
            }
        }
    }
};
