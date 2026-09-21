-- ============================================================================
-- 08 — O PLANO SÓ MUDA QUANDO O PAGAMENTO É CONFIRMADO
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Até aqui o servidor gravava o plan_id no salão no momento em que o checkout
-- GERAVA a cobrança (/api/asaas/create-subscription). Abrir o checkout do
-- Ilimitado já liberava o Ilimitado, pagando ou não. E a rota nem conferia
-- quem chamava: aceitava o id do salão no corpo da requisição.
--
-- O server.js agora identifica o salão pelo token de login e não toca mais
-- no plan_id. O plano escolhido fica em subscriptions.plan_id, e esta versão
-- da process_asaas_webhook o aplica ao salão quando chega a confirmação.
--
-- Mudou também a ordem da busca do salão: primeiro pela ASSINATURA, depois
-- pelo cliente. O cliente do Asaas é localizado pelo CPF/CNPJ
-- (createOrFindCustomer), então dois salões do mesmo dono dividem o mesmo
-- cliente — e a busca por cliente, com LIMIT 1, podia ativar o salão errado.
-- A assinatura é única por salão.
--
-- O resto da função é o mesmo da 03. As permissões da 07 são reafirmadas no
-- fim (só a service_role executa).
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

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
    v_plano_assinado TEXT;
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

    -- 1º pela assinatura: é única por salão, e traz o plano que foi assinado.
    IF v_subscription_id IS NOT NULL THEN
        SELECT salon_id, plan_id INTO v_salon_id, v_plano_assinado
        FROM public.subscriptions
        WHERE asaas_subscription_id = v_subscription_id
        LIMIT 1;
    END IF;

    -- 2º pelo cliente, para cobrança avulsa (sem assinatura).
    IF v_salon_id IS NULL THEN
        SELECT user_id INTO v_salon_id
        FROM public.business_info
        WHERE asaas_customer_id = v_customer_id
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
        -- O plano pago entra agora, e só agora. Sem assinatura (cobrança
        -- avulsa), o plano fica como está.
        UPDATE public.business_info
        SET status = 'active',
            plan_id = COALESCE(v_plano_assinado, plan_id)
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

-- Mesmas permissões da 07: só o servidor.
REVOKE ALL ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- CONFERÊNCIA — as três linhas têm que vir com ok = true.
-- ----------------------------------------------------------------------------
SELECT 'função aplica o plano assinado' AS verificacao,
       pg_get_functiondef('public.process_asaas_webhook(text, jsonb)'::regprocedure) LIKE '%v_plano_assinado%' AS ok
UNION ALL
SELECT 'anon NÃO executa process_asaas_webhook',
       NOT has_function_privilege('anon', 'public.process_asaas_webhook(text, jsonb)', 'EXECUTE')
UNION ALL
SELECT 'service_role executa process_asaas_webhook',
       has_function_privilege('service_role', 'public.process_asaas_webhook(text, jsonb)', 'EXECUTE');
