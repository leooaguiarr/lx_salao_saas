/**
 * Servidor de desenvolvimento LOCAL (não é usado em produção).
 * Em produção o site é servido como estático pelo Vercel, a partir de public/.
 * Uso: node server.js  →  http://localhost:8000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

const asaasService = require('./asaas-service');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apisalao.lexionconsultoria.tech';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4OTg0NjIwMCwiZXhwIjo0OTQ1NTE5ODAwLCJyb2xlIjoiYW5vbiJ9.E9S2LlOKz5rNOPgg-gqwb__Mt0P4KS65xqBRCc70tYE';

// Helper para ler corpo JSON de requisições POST
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // ------------------------------------------------------------
    // 1. ROTAS DE API (Backend Asaas & SaaS)
    // ------------------------------------------------------------
    if (req.url.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, asaas-access-token');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Rota de Health Check
        if (req.url === '/api/health' && req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({ 
                status: 'healthy', 
                asaasEnv: asaasService.ASAAS_ENV,
                timestamp: new Date().toISOString()
            }));
            return;
        }

        // Rota: Criar Assinatura no Asaas (Checkout)
        if (req.url === '/api/asaas/create-subscription' && req.method === 'POST') {
            try {
                const data = await parseJsonBody(req);
                const { salonId, planId, name, email, cpfCnpj, phone, billingType, creditCard, creditCardHolderInfo } = data;

                if (!salonId || !planId || !name || !email) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Campos obrigatórios ausentes (salonId, planId, name, email).' }));
                    return;
                }

                // Tabela de preços oficial
                const PLAN_PRICES = {
                    'individual': { price: 59.90, name: 'Plano Solo / Individual' },
                    'equipe_4':   { price: 119.90, name: 'Plano Equipe (Até 4)' },
                    'ilimitado':  { price: 199.90, name: 'Plano Ilimitado Premium' }
                };

                const selectedPlan = PLAN_PRICES[planId];
                if (!selectedPlan) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Plano inválido selecionado.' }));
                    return;
                }

                // 1. Cria ou busca cliente no Asaas
                const customer = await asaasService.createOrFindCustomer({ name, email, cpfCnpj, phone });

                // 2. Cria a assinatura mensal no Asaas
                const subscription = await asaasService.createSubscription({
                    customerId: customer.id,
                    value: selectedPlan.price,
                    billingType: billingType || 'PIX',
                    planName: selectedPlan.name,
                    creditCard,
                    creditCardHolderInfo
                });

                // 3. Busca a 1ª cobrança para obter dados de pagamento (Pix/Boleto)
                const firstPayment = await asaasService.getSubscriptionFirstPayment(subscription.id);
                let pixData = null;

                if (firstPayment && (billingType === 'PIX' || firstPayment.billingType === 'PIX')) {
                    try {
                        pixData = await asaasService.getPixQrCode(firstPayment.id);
                    } catch (pixErr) {
                        console.warn('Aviso: Não foi possível obter QR Code Pix imediato:', pixErr.message);
                    }
                }

                // 4. Salva no Supabase (business_info e subscriptions)
                try {
                    await fetch(`${SUPABASE_URL}/rest/v1/business_info?user_id=eq.${salonId}`, {
                        method: 'PATCH',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({
                            asaas_customer_id: customer.id,
                            asaas_subscription_id: subscription.id,
                            plan_id: planId
                        })
                    });

                    await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify({
                            salon_id: salonId,
                            plan_id: planId,
                            asaas_subscription_id: subscription.id,
                            asaas_customer_id: customer.id,
                            status: 'TRIAL',
                            value: selectedPlan.price,
                            cycle: 'MONTHLY'
                        })
                    });
                } catch (dbErr) {
                    console.error('Erro ao sincronizar assinatura com Supabase:', dbErr);
                }

                res.writeHead(200);
                res.end(JSON.stringify({
                    ok: true,
                    customerId: customer.id,
                    subscriptionId: subscription.id,
                    payment: firstPayment,
                    pix: pixData
                }));
            } catch (err) {
                console.error('Erro em create-subscription:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // Rota: Receber Webhook do Asaas
        if (req.url === '/api/asaas/webhook' && req.method === 'POST') {
            try {
                const webhookData = await parseJsonBody(req);
                console.log(`[Asaas Webhook] Evento recebido: ${webhookData.event}`);

                if (webhookData.event && webhookData.payment) {
                    // Chama a RPC process_asaas_webhook no Supabase
                    const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_asaas_webhook`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': `Bearer ${SUPABASE_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            p_event: webhookData.event,
                            p_payment: webhookData.payment
                        })
                    });

                    const rpcResult = await rpcResponse.json();
                    console.log('[Asaas Webhook] RPC Resultado:', rpcResult);
                }

                res.writeHead(200);
                res.end(JSON.stringify({ received: true }));
            } catch (err) {
                console.error('[Asaas Webhook] Erro ao processar:', err);
                res.writeHead(200); // Responde 200 pro Asaas não ficar retentando em loop caso seja payload inválido
                res.end(JSON.stringify({ received: false, error: err.message }));
            }
            return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Rota de API não encontrada' }));
        return;
    }

    // ------------------------------------------------------------
    // 2. SERVIDOR DE ARQUIVOS ESTÁTICOS (SPA & Landing Page)
    // ------------------------------------------------------------
    let safeUrl = req.url.split('?')[0];
    if (safeUrl === '/' || safeUrl === '/home') {
        safeUrl = '/landing.html';
    } else if (safeUrl === '/app' || safeUrl === '/painel' || safeUrl === '/login' || safeUrl === '/sistema') {
        safeUrl = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, safeUrl);
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        // Fallback SPA
        let fallback = 'landing.html';
        if (safeUrl.startsWith('/app') || safeUrl.startsWith('/painel')) {
            fallback = 'index.html';
        }
        const finalPath = (err || !stats.isFile()) ? path.join(PUBLIC_DIR, fallback) : filePath;

        const ext = path.extname(finalPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });

        const stream = fs.createReadStream(finalPath);
        stream.on('error', (streamErr) => {
            console.error('Stream error:', streamErr);
            res.end();
        });
        stream.pipe(res);
    });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}/`);
});
