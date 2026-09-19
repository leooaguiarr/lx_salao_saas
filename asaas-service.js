// ============================================================
// SERVIÇO DE INTEGRAÇÃO COM GATEWAY ASAAS (Assinaturas SaaS)
// ============================================================

const ASAAS_ENV = process.env.ASAAS_ENV || 'sandbox'; // 'production' ou 'sandbox'
const ASAAS_API_URL = ASAAS_ENV === 'production' 
    ? 'https://api.asaas.com/v3' 
    : 'https://sandbox.asaas.com/api/v3';

const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';

/**
 * Realiza chamadas HTTP autenticadas para a API do Asaas
 */
async function asaasRequest(endpoint, method = 'GET', body = null) {
    if (!ASAAS_API_KEY) {
        throw new Error('ASAAS_API_KEY não configurada no servidor.');
    }

    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'access_token': ASAAS_API_KEY,
            'User-Agent': 'Lexion-Salao-SaaS'
        }
    };

    if (body && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${ASAAS_API_URL}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
        const errorMsg = data.errors && data.errors.length > 0 
            ? data.errors.map(e => e.description).join(', ') 
            : 'Erro desconhecido na API do Asaas';
        throw new Error(`[Asaas API] ${errorMsg}`);
    }

    return data;
}

/**
 * Cria ou localiza um cliente no Asaas pelo CPF/CNPJ ou Email
 */
async function createOrFindCustomer({ name, email, cpfCnpj, phone }) {
    // 1. Tenta buscar cliente existente por CPF/CNPJ
    if (cpfCnpj) {
        const cleanCpf = cpfCnpj.replace(/\D/g, '');
        const search = await asaasRequest(`/customers?cpfCnpj=${cleanCpf}`);
        if (search.data && search.data.length > 0) {
            return search.data[0];
        }
    }

    // 2. Tenta buscar por email
    if (email) {
        const searchEmail = await asaasRequest(`/customers?email=${encodeURIComponent(email)}`);
        if (searchEmail.data && searchEmail.data.length > 0) {
            return searchEmail.data[0];
        }
    }

    // 3. Cria novo cliente
    const newCustomer = await asaasRequest('/customers', 'POST', {
        name,
        email,
        cpfCnpj: cpfCnpj ? cpfCnpj.replace(/\D/g, '') : undefined,
        mobilePhone: phone ? phone.replace(/\D/g, '') : undefined,
        notificationDisabled: false
    });

    return newCustomer;
}

/**
 * Cria assinatura recorrente no Asaas
 */
async function createSubscription({
    customerId,
    value,
    billingType = 'UNDEFINED', // 'PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED'
    planName = 'Plano SaaS',
    creditCard = null,
    creditCardHolderInfo = null
}) {
    // Calcula próxima data de vencimento (hoje)
    const today = new Date();
    const nextDueDate = today.toISOString().split('T')[0];

    const payload = {
        customer: customerId,
        billingType, // 'PIX', 'CREDIT_CARD', 'BOLETO'
        value: Number(value),
        nextDueDate,
        cycle: 'MONTHLY',
        description: `Assinatura mensal: ${planName} - Lexion Salão SaaS`
    };

    // Se for cartão de crédito transparente
    if (billingType === 'CREDIT_CARD' && creditCard) {
        payload.creditCard = creditCard;
        payload.creditCardHolderInfo = creditCardHolderInfo;
    }

    const subscription = await asaasRequest('/subscriptions', 'POST', payload);
    return subscription;
}

/**
 * Busca a primeira cobrança gerada para a assinatura
 */
async function getSubscriptionFirstPayment(subscriptionId) {
    const payments = await asaasRequest(`/subscriptions/${subscriptionId}/payments`);
    if (payments.data && payments.data.length > 0) {
        return payments.data[0];
    }
    return null;
}

/**
 * Busca o QR Code Pix e payload Copia-e-Cola de um pagamento
 */
async function getPixQrCode(paymentId) {
    return await asaasRequest(`/payments/${paymentId}/pixQrCode`);
}

module.exports = {
    ASAAS_ENV,
    ASAAS_API_URL,
    asaasRequest,
    createOrFindCustomer,
    createSubscription,
    getSubscriptionFirstPayment,
    getPixQrCode
};
