-- ============================================================
-- 03_SAAS_SUBSCRIPTIONS_ASAAS.SQL
-- Gestão de Assinaturas, Faturas, Webhooks do Asaas & Limites de Planos
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela de Assinaturas do Asaas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id                 TEXT NOT NULL REFERENCES public.plans(id),
    asaas_subscription_id   TEXT UNIQUE,
    asaas_customer_id       TEXT,
    status                  TEXT NOT NULL DEFAULT 'TRIAL'
                            CHECK (status IN ('TRIAL', 'ACTIVE', 'OVERDUE', 'CANCELLED', 'EXPIRED')),
    cycle                   TEXT NOT NULL DEFAULT 'MONTHLY'
                            CHECK (cycle IN ('MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY')),
    value                   NUMERIC(10, 2) NOT NULL,
    next_due_date           DATE,
    current_period_end      TIMESTAMPTZ,
    canceled_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_salon ON public.subscriptions (salon_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_asaas ON public.subscriptions (asaas_subscription_id);

-- ------------------------------------------------------------
-- 2. Tabela de Faturas / Cobranças do Asaas (Invoices)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asaas_invoices (
    id                  TEXT PRIMARY KEY, -- ID da cobrança no Asaas (ex: pay_123456)
    salon_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_id     UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    status              TEXT NOT NULL
                        CHECK (status IN ('PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'DELETED')),
    value               NUMERIC(10, 2) NOT NULL,
    net_value           NUMERIC(10, 2),
    billing_type        TEXT CHECK (billing_type IN ('PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED')),
    invoice_url         TEXT,
    bank_slip_url       TEXT,
    pix_qr_code         TEXT,
    pix_copy_paste      TEXT,
    due_date            DATE NOT NULL,
    payment_date        DATE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_salon ON public.asaas_invoices (salon_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.asaas_invoices (status);

-- ------------------------------------------------------------
-- 3. Log de Webhooks Recebidos do Asaas (Auditoria & Resiliência)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asaas_webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event       TEXT NOT NULL,
    payment_id  TEXT,
    payload     JSONB NOT NULL,
    processed   BOOLEAN NOT NULL DEFAULT false,
    error_msg   TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_processed ON public.asaas_webhooks (processed, created_at);

-- ------------------------------------------------------------
-- 4. Função: Verificar se o salão pode adicionar mais profissionais
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_add_professional(p_salon_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_plan_id TEXT;
    v_max_prof INTEGER;
    v_current_count INTEGER;
BEGIN
    -- Busca o plano ativo do salão
    SELECT plan_id INTO v_plan_id
    FROM public.business_info
    WHERE user_id = p_salon_id;

    IF v_plan_id IS NULL THEN
        v_plan_id := 'individual';
    END IF;

    -- Busca o limite de profissionais do plano
    SELECT max_professionals INTO v_max_prof
    FROM public.plans
    WHERE id = v_plan_id;

    IF v_max_prof IS NULL THEN
        v_max_prof := 1;
    END IF;

    -- Conta os profissionais ativos
    SELECT count(*) INTO v_current_count
    FROM public.professionals
    WHERE user_id = p_salon_id AND active = true;

    RETURN v_current_count < v_max_prof;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_add_professional(UUID) TO authenticated, anon;

-- ------------------------------------------------------------
-- 5. Trigger: Proteger limite de profissionais no banco
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_professional_limit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND NEW.active = true AND OLD.active = false) THEN
        IF NOT public.can_add_professional(NEW.user_id) THEN
            RAISE EXCEPTION 'Limite de profissionais do seu plano atingido. Faça upgrade para adicionar mais profissionais.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_professional_limit ON public.professionals;
CREATE TRIGGER trg_check_professional_limit
BEFORE INSERT OR UPDATE ON public.professionals
FOR EACH ROW
EXECUTE FUNCTION public.check_professional_limit_trigger();

-- ------------------------------------------------------------
-- 6. RPC: Processar Webhook do Asaas (Security Definer)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_asaas_webhook(
    p_event TEXT,
    p_payment JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id TEXT;
    v_customer_id TEXT;
    v_subscription_id TEXT;
    v_status TEXT;
    v_value NUMERIC(10, 2);
    v_billing_type TEXT;
    v_due_date DATE;
    v_payment_date DATE;
    v_salon_id UUID;
BEGIN
    v_payment_id := p_payment->>'id';
    v_customer_id := p_payment->>'customer';
    v_subscription_id := p_payment->>'subscription';
    v_status := p_payment->>'status';
    v_value := (p_payment->>'value')::NUMERIC;
    v_billing_type := p_payment->>'billingType';
    v_due_date := (p_payment->>'dueDate')::DATE;
    
    IF p_payment->>'paymentDate' IS NOT NULL THEN
        v_payment_date := (p_payment->>'paymentDate')::DATE;
    ELSE
        v_payment_date := NULL;
    END IF;

    -- Localiza o salão pelo asaas_customer_id ou subscription
    SELECT user_id INTO v_salon_id
    FROM public.business_info
    WHERE asaas_customer_id = v_customer_id
    LIMIT 1;

    -- Se não encontrar por business_info, tenta por subscriptions
    IF v_salon_id IS NULL AND v_subscription_id IS NOT NULL THEN
        SELECT salon_id INTO v_salon_id
        FROM public.subscriptions
        WHERE asaas_subscription_id = v_subscription_id
        LIMIT 1;
    END IF;

    -- Registra o log
    INSERT INTO public.asaas_webhooks (event, payment_id, payload, processed)
    VALUES (p_event, v_payment_id, p_payment, (v_salon_id IS NOT NULL));

    IF v_salon_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Salão não localizado para este cliente/assinatura');
    END IF;

    -- Atualiza ou insere a fatura
    INSERT INTO public.asaas_invoices (
        id, salon_id, status, value, billing_type, due_date, payment_date,
        invoice_url, bank_slip_url, pix_qr_code, pix_copy_paste, updated_at
    )
    VALUES (
        v_payment_id,
        v_salon_id,
        v_status,
        v_value,
        v_billing_type,
        v_due_date,
        v_payment_date,
        p_payment->>'invoiceUrl',
        p_payment->>'bankSlipUrl',
        p_payment->'pix'->>'encodedImage',
        p_payment->'pix'->>'payload',
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        payment_date = EXCLUDED.payment_date,
        updated_at = now();

    -- Ações por evento do Asaas
    IF p_event IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_AUTHORIZED') THEN
        UPDATE public.business_info
        SET status = 'active'
        WHERE user_id = v_salon_id;

        IF v_subscription_id IS NOT NULL THEN
            UPDATE public.subscriptions
            SET status = 'ACTIVE', current_period_end = now() + interval '1 month', updated_at = now()
            WHERE asaas_subscription_id = v_subscription_id;
        END IF;

    ELSIF p_event = 'PAYMENT_OVERDUE' THEN
        UPDATE public.business_info
        SET status = 'past_due'
        WHERE user_id = v_salon_id;

        IF v_subscription_id IS NOT NULL THEN
            UPDATE public.subscriptions
            SET status = 'OVERDUE', updated_at = now()
            WHERE asaas_subscription_id = v_subscription_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'salon_id', v_salon_id, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 7. RLS para Assinaturas e Faturas
-- ------------------------------------------------------------
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_webhooks ENABLE ROW LEVEL SECURITY;

-- Planos são públicos para leitura
DROP POLICY IF EXISTS "Planos sao publicos" ON public.plans;
CREATE POLICY "Planos sao publicos" ON public.plans FOR SELECT USING (true);

-- Subscriptions: Dono do salão lê a própria
DROP POLICY IF EXISTS "Dono le assinatura" ON public.subscriptions;
CREATE POLICY "Dono le assinatura" ON public.subscriptions FOR SELECT USING (salon_id = public.salao_do_usuario());

-- Invoices: Dono do salão lê as próprias faturas
DROP POLICY IF EXISTS "Dono le faturas" ON public.asaas_invoices;
CREATE POLICY "Dono le faturas" ON public.asaas_invoices FOR SELECT USING (salon_id = public.salao_do_usuario());
