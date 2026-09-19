-- ============================================================
-- 04_RPCS_FINALIZAR_VENDA_E_FIDELIDADE.SQL
-- RPCs Atômicas de Venda, Crediário, Fidelidade e JSON Consolidador
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Leitura Consolidada de uma Venda (venda_em_json)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.venda_em_json(
    p_salao    UUID,
    p_sale_id  TEXT,
    p_repetida BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'ok', true,
        'repetida', p_repetida,
        'venda', to_jsonb(s.*),
        'itens', COALESCE((
            SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.id)
            FROM sale_items i
            WHERE i.sale_id = s.id AND i.user_id = s.user_id
        ), '[]'::jsonb),
        'pagamentos', COALESCE((
            SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.id)
            FROM sale_payments p
            WHERE p.sale_id = s.id AND p.user_id = s.user_id
        ), '[]'::jsonb)
    )
    FROM sales s
    WHERE s.id = p_sale_id AND s.user_id = p_salao;
$$;

GRANT EXECUTE ON FUNCTION public.venda_em_json(UUID, TEXT, BOOLEAN) TO authenticated, anon;

-- ------------------------------------------------------------
-- 2. Geração de Crediário (gerar_crediario)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_crediario(
    p_sale_id TEXT,
    p_plano   JSONB DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_venda      record;
    v_id         text;
    v_existente  text;
    v_parcela    jsonb;
    v_soma       numeric(14,2) := 0;
    v_valor      numeric(14,2);
    v_vence      date;
    v_seq        integer := 0;
    v_qtd        integer;
BEGIN
    SELECT * INTO v_venda FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venda % nao encontrada.', p_sale_id;
    END IF;

    IF COALESCE(v_venda.amount_receivable, 0) <= 0 THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_existente FROM receivables WHERE sale_id = p_sale_id;
    IF v_existente IS NOT NULL THEN
        RETURN v_existente;
    END IF;

    IF v_venda.client_id IS NULL THEN
        RAISE EXCEPTION 'Venda a prazo precisa de cliente identificado.';
    END IF;

    v_id := 'rec-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);

    INSERT INTO receivables (
        id, user_id, sale_id, client_id, client_name,
        total_amount, paid_amount, open_amount, status, opened_at
    ) VALUES (
        v_id, v_venda.user_id, p_sale_id, v_venda.client_id, v_venda.client_name,
        v_venda.amount_receivable, 0, v_venda.amount_receivable, 'open',
        COALESCE(v_venda.sold_at, now())
    );

    IF p_plano IS NOT NULL AND jsonb_typeof(p_plano->'installments') = 'array'
       AND jsonb_array_length(p_plano->'installments') > 0 THEN

        v_qtd := jsonb_array_length(p_plano->'installments');
        FOR v_parcela IN SELECT * FROM jsonb_array_elements(p_plano->'installments') LOOP
            v_seq   := v_seq + 1;
            v_valor := ROUND(COALESCE((v_parcela->>'amount')::numeric, 0), 2);
            v_vence := COALESCE((v_parcela->>'dueDate')::date,
                                (COALESCE(v_venda.sold_at, now()))::date + (30 * v_seq));

            INSERT INTO receivable_installments (
                id, user_id, receivable_id, sale_id,
                number, due_date, amount, paid_amount, open_amount, status
            ) VALUES (
                v_id || '-p' || v_seq, v_venda.user_id, v_id, p_sale_id,
                v_seq, v_vence, v_valor, 0, v_valor, 'open'
            );

            v_soma := v_soma + v_valor;
        END LOOP;

        IF v_soma <> v_venda.amount_receivable THEN
            RAISE EXCEPTION 'As parcelas somam % e o saldo a prazo e %.', v_soma, v_venda.amount_receivable;
        END IF;
    ELSE
        INSERT INTO receivable_installments (
            id, user_id, receivable_id, sale_id,
            number, due_date, amount, paid_amount, open_amount, status
        ) VALUES (
            v_id || '-p1', v_venda.user_id, v_id, p_sale_id,
            1, (COALESCE(v_venda.sold_at, now()))::date + 30,
            v_venda.amount_receivable, 0, v_venda.amount_receivable, 'open'
        );
    END IF;

    RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- 3. Recebimento de Crediário (receber_crediario)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receber_crediario(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao       uuid;
    v_parcela     record;
    v_conta       record;
    v_pag         jsonb;
    v_metodo      text;
    v_valor       numeric(14,2);
    v_entregue    numeric(14,2);
    v_troco       numeric(14,2);
    v_total       numeric(14,2) := 0;
    v_chave       text;
    v_caixa       text;
    v_competencia date;
    v_agora       timestamptz := now();
    v_seq         integer := 0;
    v_sufixo      text;
    v_tr_id       text;
    v_ja          record;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.';
    END IF;

    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietario pode receber crediario.';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_payload->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Recebimento sem chave de idempotencia.';
    END IF;

    SELECT receivable_id INTO v_ja FROM receivable_payments
    WHERE user_id = v_salao AND idempotency_key = v_chave LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'repetida', true, 'receivableId', v_ja.receivable_id);
    END IF;

    SELECT * INTO v_parcela FROM receivable_installments
    WHERE id = p_payload->>'installmentId' AND user_id = v_salao
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela nao encontrada neste salao.';
    END IF;
    IF v_parcela.status <> 'open' THEN
        RAISE EXCEPTION 'Esta parcela ja esta %.', v_parcela.status;
    END IF;

    SELECT * INTO v_conta FROM receivables
    WHERE id = v_parcela.receivable_id AND user_id = v_salao
    FOR UPDATE;

    v_competencia := COALESCE((p_payload->>'competenceDate')::date, CURRENT_DATE);
    v_sufixo := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

    SELECT id INTO v_caixa FROM cash_registers
    WHERE user_id = v_salao AND status = 'open'
    ORDER BY "dateOpened" DESC LIMIT 1;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
        v_seq      := v_seq + 1;
        v_metodo   := v_pag->>'paymentMethod';
        v_valor    := ROUND(COALESCE((v_pag->>'amount')::numeric, 0), 2);
        v_entregue := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
        v_troco    := CASE WHEN v_metodo = 'cash' THEN GREATEST(0, v_entregue - v_valor) ELSE 0 END;
        v_total    := v_total + v_valor;

        v_tr_id := 'tr-rec-' || v_sufixo || '-' || v_seq;

        INSERT INTO transactions (
            id, user_id, type, amount, date, "registradoEm",
            description, category, "paymentMethod", status, "clientId",
            sale_id, cash_register_id, source
        ) VALUES (
            v_tr_id, v_salao, 'income', v_valor,
            to_char(v_competencia, 'YYYY-MM-DD'),
            to_char(v_agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'Recebimento parcela #' || v_parcela.number || ' - ' || COALESCE(v_conta.client_name, 'Cliente'),
            'Vendas', v_metodo,
            CASE WHEN v_metodo = 'cash' AND v_caixa IS NULL THEN 'pending' ELSE 'completed' END,
            v_conta.client_id, v_conta.sale_id,
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, 'credit'
        );

        INSERT INTO receivable_payments (
            id, user_id, receivable_id, installment_id, payment_method,
            amount, cash_received, change_amount, transaction_id,
            idempotency_key, paid_at
        ) VALUES (
            'rp-' || v_sufixo || '-' || v_seq, v_salao, v_conta.id, v_parcela.id,
            v_metodo, v_valor, v_entregue, v_troco, v_tr_id,
            v_chave || '-' || v_seq, v_agora
        );
    END LOOP;

    IF v_total <> v_parcela.amount THEN
        RAISE EXCEPTION 'Valor recebido (%) difere da parcela (%).', v_total, v_parcela.amount;
    END IF;

    UPDATE receivable_installments
    SET paid_amount = amount, open_amount = 0, status = 'settled', settled_at = v_agora
    WHERE id = v_parcela.id;

    UPDATE receivables
    SET paid_amount = paid_amount + v_total,
        open_amount = open_amount - v_total,
        status = CASE WHEN open_amount - v_total <= 0 THEN 'settled' ELSE 'open' END,
        settled_at = CASE WHEN open_amount - v_total <= 0 THEN v_agora ELSE NULL END
    WHERE id = v_conta.id;

    RETURN jsonb_build_object('ok', true, 'receivableId', v_conta.id);
END;
$$;

-- ------------------------------------------------------------
-- 4. Resgate de Fidelidade (resgatar_fidelidade)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resgatar_fidelidade(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao    uuid;
    v_chave    text;
    v_cliente  record;
    v_programa record;
    v_id       text;
    v_ja       record;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.';
    END IF;

    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietario pode resgatar beneficio de fidelidade.';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_payload->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Resgate sem chave de idempotencia.';
    END IF;

    SELECT client_id INTO v_ja FROM loyalty_movements
    WHERE user_id = v_salao AND idempotency_key = v_chave LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'repetida', true, 'clientId', v_ja.client_id);
    END IF;

    SELECT id, name, "loyaltyEnrolled", "loyaltyPoints" INTO v_cliente
    FROM clients
    WHERE id = p_payload->>'clientId' AND user_id = v_salao
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente nao encontrado neste salao.';
    END IF;

    SELECT active, goal, benefit_description INTO v_programa
    FROM loyalty_programs WHERE user_id = v_salao
    FOR UPDATE;
    IF NOT FOUND OR v_programa.active IS NOT TRUE THEN
        RAISE EXCEPTION 'Programa de fidelidade inativo ou nao configurado.';
    END IF;

    IF v_cliente."loyaltyPoints" < v_programa.goal THEN
        RAISE EXCEPTION 'Saldo insuficiente: cliente tem % de % pontos.', v_cliente."loyaltyPoints", v_programa.goal;
    END IF;

    UPDATE clients
    SET "loyaltyPoints" = "loyaltyPoints" - v_programa.goal
    WHERE id = v_cliente.id AND user_id = v_salao;

    v_id := 'lm-resgate-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

    INSERT INTO loyalty_movements (
        id, user_id, client_id, sale_id, sale_item_id, points, reason, idempotency_key
    ) VALUES (
        v_id, v_salao, v_cliente.id, NULLIF(p_payload->>'saleId', ''), NULL,
        -v_programa.goal, 'Resgate: ' || v_programa.benefit_description, v_chave
    );

    RETURN jsonb_build_object('ok', true, 'clientId', v_cliente.id, 'saldoRestante', v_cliente."loyaltyPoints" - v_programa.goal);
END;
$$;

-- ------------------------------------------------------------
-- 5. Finalizar Venda Atômica (finalizar_venda)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_venda(p_venda JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao           uuid;
    v_chave           text;
    v_sale_id         text;
    v_sufixo          text;
    v_numero          bigint;
    v_agora           timestamptz := NOW();
    v_competencia     date;

    v_item            jsonb;
    v_pag             jsonb;
    v_produto         record;

    v_tipo            text;
    v_qtd             integer;
    v_unit            numeric(14,2);
    v_bruto           numeric(14,2);
    v_desc_item       numeric(14,2);
    v_acr_item        numeric(14,2);
    v_liq_item        numeric(14,2);
    v_nome            text;
    v_ref_id          text;
    v_prof_item       text;
    v_prof_item_nome  text;
    v_taxa            numeric(7,4);
    v_base            numeric(14,2);

    v_sub_serv        numeric(14,2) := 0;
    v_sub_prod        numeric(14,2) := 0;
    v_desc_soma       numeric(14,2) := 0;
    v_acr_soma        numeric(14,2) := 0;
    v_liq_soma        numeric(14,2) := 0;
    v_subtotal        numeric(14,2);
    v_desconto        numeric(14,2);
    v_acrescimo       numeric(14,2);
    v_total           numeric(14,2);

    v_metodo          text;
    v_valor           numeric(14,2);
    v_entregue        numeric(14,2);
    v_troco_pag       numeric(14,2);
    v_recebido        numeric(14,2) := 0;
    v_troco           numeric(14,2) := 0;
    v_receber         numeric(14,2);
    v_metodo_principal text;
    v_maior_pag       numeric(14,2) := -1;

    v_cliente_id      text;
    v_cliente_nome    text;
    v_prof_id         text;
    v_prof_nome       text;
    v_appt_id         text;
    v_origem          text;
    v_caixa           text;
    v_categoria       text;
    v_resumo          text;
    v_seq             integer := 0;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.' USING ERRCODE = '42501';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_venda->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Venda sem chave de idempotencia.' USING ERRCODE = '23502';
    END IF;

    SELECT id INTO v_sale_id FROM sales WHERE user_id = v_salao AND idempotency_key = v_chave LIMIT 1;
    IF v_sale_id IS NOT NULL THEN
        RETURN public.venda_em_json(v_salao, v_sale_id, true);
    END IF;

    v_cliente_id   := NULLIF(TRIM(COALESCE(p_venda->>'clientId', '')), '');
    v_cliente_nome := NULLIF(TRIM(COALESCE(p_venda->>'clientName', '')), '');
    v_prof_id      := NULLIF(TRIM(COALESCE(p_venda->>'professionalId', '')), '');
    v_prof_nome    := NULLIF(TRIM(COALESCE(p_venda->>'professionalName', '')), '');
    v_appt_id      := NULLIF(TRIM(COALESCE(p_venda->>'appointmentId', '')), '');
    v_origem       := COALESCE(p_venda->>'origin', 'counter');
    v_competencia  := COALESCE((p_venda->>'competenceDate')::date, CURRENT_DATE);

    v_desconto     := ROUND(COALESCE((p_venda->>'discountAmount')::numeric, 0), 2);
    v_acrescimo    := ROUND(COALESCE((p_venda->>'surchargeAmount')::numeric, 0), 2);

    -- 1. Itera sobre os itens
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_venda->'items') LOOP
        v_tipo      := v_item->>'itemType';
        v_qtd       := COALESCE((v_item->>'quantity')::integer, 0);
        v_unit      := ROUND(COALESCE((v_item->>'unitPrice')::numeric, 0), 2);
        v_bruto     := ROUND(v_unit * v_qtd, 2);
        v_desc_item := ROUND(COALESCE((v_item->>'discountAmount')::numeric, 0), 2);
        v_acr_item  := ROUND(COALESCE((v_item->>'surchargeAmount')::numeric, 0), 2);
        v_liq_item  := v_bruto - v_desc_item + v_acr_item;

        IF v_tipo = 'service' THEN
            v_sub_serv := v_sub_serv + v_bruto;
        ELSE
            v_sub_prod := v_sub_prod + v_bruto;
        END IF;

        v_desc_soma := v_desc_soma + v_desc_item;
        v_acr_soma  := v_acr_soma + v_acr_item;
        v_liq_soma  := v_liq_soma + v_liq_item;
    END LOOP;

    v_subtotal := v_sub_serv + v_sub_prod;
    v_total    := v_subtotal - v_desconto + v_acrescimo;

    -- 2. Itera sobre pagamentos
    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_venda->'payments') LOOP
        v_metodo   := v_pag->>'paymentMethod';
        v_valor    := ROUND(COALESCE((v_pag->>'amount')::numeric, 0), 2);
        v_entregue := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
        v_recebido := v_recebido + v_valor;

        IF v_valor > v_maior_pag THEN
            v_maior_pag := v_valor;
            v_metodo_principal := v_metodo;
        END IF;
    END LOOP;

    v_receber := GREATEST(0, v_total - v_recebido);

    -- 3. Sequencial e IDs
    SELECT COALESCE(MAX(sale_number), 0) + 1 INTO v_numero FROM sales WHERE user_id = v_salao;
    v_sufixo  := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    v_sale_id := 'sale-' || to_char(v_competencia, 'YYYYMMDD') || '-' || lpad(v_numero::text, 4, '0') || '-' || v_sufixo;

    -- 4. Grava cabeçalho
    INSERT INTO sales (
        id, user_id, sale_number, appointment_id, client_id, client_name,
        professional_id, professional_name, origin, status,
        subtotal_services, subtotal_products, subtotal,
        discount_type, discount_value, discount_amount,
        surcharge_type, surcharge_value, surcharge_amount,
        total, amount_received, amount_receivable, change_amount,
        notes, idempotency_key, created_by, sold_at
    ) VALUES (
        v_sale_id, v_salao, v_numero, v_appt_id, v_cliente_id, v_cliente_nome,
        v_prof_id, v_prof_nome, v_origem,
        CASE WHEN v_receber = 0 THEN 'paid' WHEN v_recebido > 0 THEN 'partial' ELSE 'on_credit' END,
        v_sub_serv, v_sub_prod, v_subtotal,
        p_venda->>'discountType', COALESCE((p_venda->>'discountValue')::numeric, 0), v_desconto,
        p_venda->>'surchargeType', COALESCE((p_venda->>'surchargeValue')::numeric, 0), v_acrescimo,
        v_total, v_recebido, v_receber, v_troco,
        p_venda->>'notes', v_chave, auth.uid(), v_agora
    );

    -- 5. Grava itens e abate estoque se produto
    v_seq := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_venda->'items') LOOP
        v_seq       := v_seq + 1;
        v_tipo      := v_item->>'itemType';
        v_ref_id    := v_item->>'referenceId';
        v_nome      := v_item->>'name';
        v_qtd       := (v_item->>'quantity')::integer;
        v_unit      := ROUND((v_item->>'unitPrice')::numeric, 2);
        v_bruto     := ROUND(v_unit * v_qtd, 2);
        v_desc_item := ROUND(COALESCE((v_item->>'discountAmount')::numeric, 0), 2);
        v_acr_item  := ROUND(COALESCE((v_item->>'surchargeAmount')::numeric, 0), 2);
        v_liq_item  := v_bruto - v_desc_item + v_acr_item;
        v_prof_item := COALESCE(v_item->>'professionalId', v_prof_id);
        v_prof_item_nome := COALESCE(v_item->>'professionalName', v_prof_nome);
        v_taxa      := COALESCE((v_item->>'commissionRate')::numeric, 0);
        v_base      := v_bruto - v_desc_item;

        IF v_tipo = 'product' THEN
            SELECT * INTO v_produto FROM products WHERE id = v_ref_id AND user_id = v_salao FOR UPDATE;
            IF FOUND THEN
                UPDATE products SET stock = stock - v_qtd WHERE id = v_ref_id AND user_id = v_salao;
                INSERT INTO stock_movements (id, user_id, "productId", type, quantity, reason, date, sale_id)
                VALUES ('sm-' || v_sufixo || '-' || v_seq, v_salao, v_ref_id, 'out', v_qtd, 'Venda #' || v_numero, to_char(v_competencia, 'YYYY-MM-DD'), v_sale_id);
            END IF;
        END IF;

        INSERT INTO sale_items (
            id, user_id, sale_id, item_type, reference_id, name,
            quantity, unit_price, gross_total, discount_amount, surcharge_amount, net_total,
            professional_id, professional_name, commission_rate, commission_base, commission_amount
        ) VALUES (
            'si-' || v_sufixo || '-' || v_seq, v_salao, v_sale_id, v_tipo, v_ref_id, v_nome,
            v_qtd, v_unit, v_bruto, v_desc_item, v_acr_item, v_liq_item,
            v_prof_item, v_prof_item_nome, v_taxa, v_base, ROUND(v_base * v_taxa, 2)
        );
    END LOOP;

    -- 6. Caixa aberto
    SELECT id INTO v_caixa FROM cash_registers WHERE user_id = v_salao AND status = 'open' ORDER BY "dateOpened" DESC LIMIT 1;

    -- 7. Grava pagamentos e movimentações financeiras
    v_seq := 0;
    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_venda->'payments') LOOP
        v_seq      := v_seq + 1;
        v_metodo   := v_pag->>'paymentMethod';
        v_valor    := ROUND((v_pag->>'amount')::numeric, 2);
        v_entregue := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
        v_troco_pag := CASE WHEN v_metodo = 'cash' THEN GREATEST(0, v_entregue - v_valor) ELSE 0 END;

        INSERT INTO sale_payments (
            id, user_id, sale_id, payment_method, amount, cash_received, change_amount,
            installment_count, transaction_id, status, paid_at
        ) VALUES (
            'sp-' || v_sufixo || '-' || v_seq, v_salao, v_sale_id, v_metodo, v_valor, v_entregue, v_troco_pag,
            1, 'tr-' || v_sufixo || '-' || v_seq, 'confirmed', v_agora
        );

        INSERT INTO transactions (
            id, user_id, type, amount, date, "registradoEm", description, category,
            "paymentMethod", status, "clientId", appointment_id, sale_id, sale_payment_id, cash_register_id, source
        ) VALUES (
            'tr-' || v_sufixo || '-' || v_seq, v_salao, 'income', v_valor,
            to_char(v_competencia, 'YYYY-MM-DD'),
            to_char(v_agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'Venda #' || v_numero || ' - ' || COALESCE(v_cliente_nome, 'Balcão'),
            'Vendas', v_metodo,
            CASE WHEN v_metodo = 'cash' AND v_caixa IS NULL THEN 'pending' ELSE 'completed' END,
            v_cliente_id, v_appt_id, v_sale_id, 'sp-' || v_sufixo || '-' || v_seq,
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, 'sale'
        );
    END LOOP;

    -- 8. Atualiza atendimento e último corte
    IF v_appt_id IS NOT NULL THEN
        UPDATE appointments
        SET status = 'done', "paymentStatus" = 'paid', "paymentMethod" = COALESCE(v_metodo_principal, "paymentMethod")
        WHERE id = v_appt_id AND user_id = v_salao;
    END IF;

    IF v_cliente_id IS NOT NULL THEN
        UPDATE clients
        SET "lastVisit" = to_char(v_competencia, 'YYYY-MM-DD')
        WHERE id = v_cliente_id AND user_id = v_salao
          AND (COALESCE("lastVisit", '') < to_char(v_competencia, 'YYYY-MM-DD'));
    END IF;

    -- 9. Crediário se houver saldo a prazo
    IF v_receber > 0 THEN
        PERFORM public.gerar_crediario(v_sale_id, p_venda->'creditPlan');
    END IF;

    RETURN public.venda_em_json(v_salao, v_sale_id, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalizar_venda(JSONB) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.gerar_crediario(TEXT, JSONB) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.receber_crediario(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resgatar_fidelidade(JSONB) TO authenticated;

COMMIT;
