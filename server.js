/**
 * ============================================================
 * LEXION SALÃO & BARBEARIA SAAS — SERVIDOR UNIFICADO (WEB + API)
 * ============================================================
 * Servidor HTTP nativo em Node.js (sem dependências externas)
 * Executado localmente e em produção via Docker / Coolify.
 * - Landing page de luxo unissex: /
 * - Painel administrativo e sistema SaaS: /app
 * - Agendamento público dinâmico por slug: /<slug-do-salao>
 * - Endpoints de autenticação, onboarding e webhook Asaas: /api/*
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

const asaasService = require('./asaas-service');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://apisalao.lexionconsultoria.tech';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4OTg0NjIwMCwiZXhwIjo0OTQ1NTE5ODAwLCJyb2xlIjoiYW5vbiJ9.E9S2LlOKz5rNOPgg-gqwb__Mt0P4KS65xqBRCc70tYE';

// Token que o Asaas manda no cabeçalho `asaas-access-token` de cada webhook.
// É o "Token de autenticação" cadastrado na tela do webhook, no painel do
// Asaas, e o mesmo valor vai nesta variável no Coolify.
//
// Sem ele, qualquer um que soubesse a URL podia mandar um PAYMENT_CONFIRMED
// inventado e ativar a assinatura de um salão sem pagar. Por isso a regra é
// fechada: variável vazia = webhook recusa tudo, nunca aceita tudo.
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || '';

// Compara em tempo constante: com `===`, o tempo de resposta cresce a cada
// caractere certo, e dá para descobrir o token por tentativa. O hash antes
// iguala o tamanho, que o timingSafeEqual exige.
function tokenDoWebhookConfere(recebido) {
    if (!ASAAS_WEBHOOK_TOKEN || typeof recebido !== 'string' || !recebido) return false;
    const resumo = valor => crypto.createHash('sha256').update(valor).digest();
    return crypto.timingSafeEqual(resumo(recebido), resumo(ASAAS_WEBHOOK_TOKEN));
}

// Papel da chave do Supabase em uso, lido do próprio JWT (sem validar a
// assinatura: é só para diagnóstico). O webhook e o cadastro de salão
// precisam da service_role; com a anon, o banco recusa as duas coisas.
function papelDaChaveSupabase() {
    try {
        const carga = JSON.parse(Buffer.from(SUPABASE_KEY.split('.')[1], 'base64url').toString('utf8'));
        return carga.role || 'desconhecido';
    } catch {
        return 'invalida';
    }
}

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
            // Os dois campos de configuração respondem sim/não e o papel da
            // chave — nunca o valor de segredo nenhum. Servem para conferir o
            // Coolify sem abrir o painel dele.
            res.end(JSON.stringify({
                status: 'healthy',
                asaasEnv: asaasService.ASAAS_ENV,
                webhookProtegido: !!ASAAS_WEBHOOK_TOKEN,
                chaveSupabase: papelDaChaveSupabase(),
                timestamp: new Date().toISOString()
            }));
            return;
        }

        // Rota: Cadastro de Novo Salão (Onboarding SaaS / Trial 7 Dias)
        if (req.url === '/api/auth/register-salon' && req.method === 'POST') {
            try {
                const data = await parseJsonBody(req);
                const { email, password, name, businessType, planId } = data;

                if (!email || !password || !name) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Preencha todos os campos obrigatórios (nome, e-mail e senha).' }));
                    return;
                }

                if (password.length < 6) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'A senha deve conter no mínimo 6 caracteres.' }));
                    return;
                }

                // 1. Cria usuário no Supabase Auth via Admin API
                let userId = null;
                const adminUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email: email.trim().toLowerCase(),
                        password: password,
                        email_confirm: true,
                        user_metadata: {
                            name: name.trim(),
                            business_type: businessType || 'barbearia',
                            plan_id: planId || 'individual'
                        }
                    })
                });

                const adminUserData = await adminUserRes.json();
                if (adminUserRes.ok && adminUserData && adminUserData.id) {
                    userId = adminUserData.id;
                } else if (adminUserData && adminUserData.msg && adminUserData.msg.includes('already registered')) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: 'Este e-mail já está cadastrado. Faça login diretamente.' }));
                    return;
                } else {
                    // Fallback para signup público se admin API não estiver acessível
                    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email: email.trim().toLowerCase(),
                            password: password,
                            data: { name: name.trim(), business_type: businessType || 'barbearia' }
                        })
                    });
                    const signupData = await signupRes.json();
                    if (!signupRes.ok) {
                        throw new Error(signupData.msg || signupData.error_description || 'Erro ao criar conta de usuário.');
                    }
                    userId = signupData.id || (signupData.user && signupData.user.id);
                }

                if (!userId) {
                    throw new Error('Falha ao obter identificador do usuário.');
                }

                // 2. Gera slug único a partir do nome
                const baseSlug = name.trim().toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '') || 'salao';
                const randomHash = Math.random().toString(36).substring(2, 6);
                const slug = `${baseSlug}-${randomHash}`;

                const typeColors = {
                    barbearia: { primary: '#d4af37', service: 'Corte Tradicional & Barba', price: 45.00 },
                    salao:     { primary: '#c89547', service: 'Corte & Escova Modelada', price: 85.00 },
                    estetica:  { primary: '#e0a96d', service: 'Limpeza de Pele Profunda', price: 120.00 }
                };
                const config = typeColors[businessType] || typeColors.barbearia;

                // 3. Insere business_info
                const trialEnds = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                await fetch(`${SUPABASE_URL}/rest/v1/business_info`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({
                        user_id: userId,
                        name: name.trim(),
                        slug: slug,
                        business_type: businessType || 'barbearia',
                        primary_color: config.primary,
                        secondary_color: '#141419',
                        plan_id: planId || 'individual',
                        status: 'trial',
                        trial_ends_at: trialEnds
                    })
                });

                // 4. Insere salon_members como owner
                await fetch(`${SUPABASE_URL}/rest/v1/salon_members`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({
                        user_id: userId,
                        salon_id: userId,
                        role: 'owner'
                    })
                });

                // 5. Cria profissional inicial e serviço inicial
                const profId = 'prof_' + Math.random().toString(36).substring(2, 9);
                await fetch(`${SUPABASE_URL}/rest/v1/professionals`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({
                        id: profId,
                        user_id: userId,
                        name: 'Profissional Principal',
                        commission: 50.00,
                        active: true
                    })
                });

                const servId = 'serv_' + Math.random().toString(36).substring(2, 9);
                await fetch(`${SUPABASE_URL}/rest/v1/services`, {
                    method: 'POST',
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({
                        id: servId,
                        user_id: userId,
                        name: config.service,
                        price: config.price,
                        duration: 45,
                        active: true
                    })
                });

                res.writeHead(200);
                res.end(JSON.stringify({
                    ok: true,
                    userId: userId,
                    email: email,
                    slug: slug,
                    message: 'Salão cadastrado com sucesso! Período de 7 dias grátis iniciado.'
                }));
            } catch (err) {
                console.error('[Register Salon] Erro:', err);
                res.writeHead(500);
                res.end(JSON.stringify({ ok: false, error: err.message || 'Erro ao criar salão.' }));
            }
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
            // Confere o token ANTES de ler o corpo: requisição sem autorização
            // não chega nem perto do banco. 401 faz o Asaas marcar a entrega
            // como falha no painel dele, que é onde um token errado aparece.
            if (!tokenDoWebhookConfere(req.headers['asaas-access-token'])) {
                console.warn(ASAAS_WEBHOOK_TOKEN
                    ? '[Asaas Webhook] Recusado: token ausente ou diferente.'
                    : '[Asaas Webhook] Recusado: ASAAS_WEBHOOK_TOKEN não configurado no servidor.');
                req.resume();
                res.writeHead(401);
                res.end(JSON.stringify({ received: false, error: 'Não autorizado' }));
                return;
            }

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

                    const rpcResult = await rpcResponse.json().catch(() => null);
                    console.log('[Asaas Webhook] RPC Resultado:', rpcResult);

                    // Antes o webhook respondia 200 mesmo com o banco recusando a
                    // chamada — o Asaas dava o evento por entregue e o pagamento
                    // sumia sem rastro. Com 500 ele tenta de novo e a falha
                    // aparece no painel. (Salão não localizado não é falha: a
                    // RPC responde 200 com ok: false, e isso segue como antes.)
                    if (!rpcResponse.ok) {
                        console.error(`[Asaas Webhook] Banco recusou (HTTP ${rpcResponse.status}). Chave em uso: ${papelDaChaveSupabase()}.`);
                        res.writeHead(500);
                        res.end(JSON.stringify({ received: false, error: 'Falha ao registrar o evento' }));
                        return;
                    }
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
    // 2. SERVIDOR DE ARQUIVOS ESTÁTICOS (SPA, Slugs & Landing Page)
    // ------------------------------------------------------------
    const rawPath = decodeURIComponent(req.url.split('?')[0]);

    // Rota da Landing Page oficial
    if (rawPath === '/' || rawPath === '/home' || rawPath === '/landing') {
        return serveStaticFile(res, path.join(PUBLIC_DIR, 'landing.html'));
    }

    const requestedFile = path.join(PUBLIC_DIR, rawPath);
    if (!requestedFile.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
    }

    // Se possui extensão de arquivo (ex: .js, .css, .png, .jpg, .ico, .svg, etc.)
    if (path.extname(rawPath)) {
        fs.stat(requestedFile, (err, stats) => {
            if (!err && stats.isFile()) {
                return serveStaticFile(res, requestedFile);
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        });
        return;
    }

    // Qualquer rota sem extensão (/app, /painel, /login, ou qualquer /<slug-do-salao>)
    // serve o index.html para que o cliente SPA processe a sessão ou o agendamento público
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
});

// Helper para envio de arquivos estáticos com Content-Type e Cache-Control adequados
function serveStaticFile(res, filePath) {
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        // O sw.js e o manifest seguem a regra do HTML: com cache de um dia, um
        // deploy só chegaria ao aplicativo instalado no dia seguinte.
        const semCache = ext === '.html' || ext === '.webmanifest' || path.basename(filePath) === 'sw.js';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': semCache ?'no-cache, no-store, must-revalidate' : 'public, max-age=86400'
        });

        const stream = fs.createReadStream(filePath);
        stream.on('error', (streamErr) => {
            console.error('[Static Stream Error]:', streamErr);
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
        stream.pipe(res);
    });
}

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`[Lexion SaaS] Servidor rodando em http://localhost:${PORT}/`);
});
