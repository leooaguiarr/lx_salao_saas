-- ============================================================================
-- 13 — FINALIZAR_VENDA QUE ENTENDE A TELA
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Em 05/10/2026 o botão "Receber" do Início devolveu:
--   null value in column "reference_id" of relation "sale_items"
--   violates not-null constraint
--
-- A tela de venda (venda-calculo.js, montarPayloadDaVenda) veio da Alabama e
-- manda cada item como { itemType, serviceId | productId, itemName, ... }. A
-- finalizar_venda da migração 04 foi reescrita para o SaaS lendo outros nomes
-- ('referenceId', 'name', 'commissionRate', 'clientName'...), que a tela nunca
-- enviou. Resultado: NENHUMA venda com item gravava — nem pelo "Receber", nem
-- pela aba Atendimentos. Além disso a 04:
--   - gravava sale_id em stock_movements, coluna que a tabela do SaaS não tem
--     (toda venda de produto falharia no mesmo ponto);
--   - calculava a comissão como base * taxa, com a taxa em PORCENTAGEM
--     (50 = 50%, é assim que a aba Comissões mostra): 50 vezes o devido;
--   - tinha perdido as conferências da versão da Alabama (totais, estoque
--     insuficiente, venda repetida do mesmo atendimento, profissional fechando
--     atendimento de outro).
--
-- O QUE MUDA
--
--   1. stock_movements ganha a coluna sale_id (vínculo do movimento com a venda).
--   2. venda_em_json devolve também transações, movimentos de estoque e saldo
--      dos produtos — o checkout.js (guardarRetornoDaVenda) já esperava isso —
--      e cada item sai TAMBÉM com os nomes que a tela lê (item_name,
--      gross_amount, net_amount, service_id, product_id).
--   3. finalizar_venda é a da Alabama (docs/legacy_sql/32), com as mesmas
--      regras, escrevendo nas colunas do SaaS (reference_id, name,
--      gross_total, net_total, commission_amount).
--
-- O formato do payload continua o da tela; nada no front precisa mudar para
-- a venda gravar. Seguro rodar mais de uma vez.
-- ============================================================================

ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS sale_id TEXT;

-- ----------------------------------------------------------------------------
-- venda_em_json
-- ----------------------------------------------------------------------------
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
        -- Os apelidos são os nomes da Alabama, que é como vendas-base.js,
        -- recibo.js e venda-calculo.js leem os itens (saleValue).
        'itens', COALESCE((
            SELECT jsonb_agg(to_jsonb(i.*) || jsonb_build_object(
                       'item_name',    i.name,
                       'gross_amount', i.gross_total,
                       'net_amount',   i.net_total,
                       'service_id',   CASE WHEN i.item_type = 'service' THEN NULLIF(i.reference_id, '') END,
                       'product_id',   CASE WHEN i.item_type = 'product' THEN NULLIF(i.reference_id, '') END
                   ) ORDER BY i.id)
            FROM sale_items i
            WHERE i.sale_id = s.id AND i.user_id = s.user_id
        ), '[]'::jsonb),
        'pagamentos', COALESCE((
            SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.id)
            FROM sale_payments p
            WHERE p.sale_id = s.id AND p.user_id = s.user_id
        ), '[]'::jsonb),
        'transacoes', COALESCE((
            SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.id)
            FROM transactions t
            WHERE t.sale_id = s.id AND t.user_id = s.user_id
        ), '[]'::jsonb),
        'movimentos', COALESCE((
            SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.id)
            FROM stock_movements m
            WHERE m.sale_id = s.id AND m.user_id = s.user_id
        ), '[]'::jsonb),
        'produtos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'stock', pr.stock))
            FROM products pr
            WHERE pr.user_id = s.user_id
              AND pr.id IN (SELECT i.reference_id FROM sale_items i
                            WHERE i.sale_id = s.id AND i.user_id = s.user_id
                              AND i.item_type = 'product')
        ), '[]'::jsonb)
    )
    FROM sales s
    WHERE s.id = p_sale_id AND s.user_id = p_salao;
$$;

-- ----------------------------------------------------------------------------
-- finalizar_venda
-- ----------------------------------------------------------------------------
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
    v_estoque         integer;
    v_seq             integer := 0;
    v_qtd_serv        integer := 0;
    v_qtd_prod        integer := 0;
BEGIN
    -- 1. Contexto, papel e idempotência --------------------------------------
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salão vinculado.' USING ERRCODE = '42501';
    END IF;

    -- O profissional conclui venda de balcão, mas o atendimento agendado só
    -- sai pelo dono ou por quem fez o serviço.
    IF public.meu_papel() <> 'owner'
       AND NULLIF(TRIM(COALESCE(p_venda->>'appointmentId', '')), '') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM appointments a
            WHERE a.id = NULLIF(TRIM(p_venda->>'appointmentId'), '')
              AND a.user_id = v_salao
              AND a."profId" = public.meu_profissional()
       ) THEN
        RAISE EXCEPTION 'Este atendimento é de outro profissional.' USING ERRCODE = '42501';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_venda->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Chave de idempotência obrigatória.';
    END IF;

    -- Serializa o duplo clique: a segunda chamada espera a primeira e devolve
    -- a mesma venda, em vez de baixar estoque duas vezes.
    PERFORM pg_advisory_xact_lock(hashtext(v_salao::text || ':venda:' || v_chave));

    SELECT id INTO v_sale_id FROM sales
    WHERE user_id = v_salao AND idempotency_key = v_chave;
    IF v_sale_id IS NOT NULL THEN
        RETURN public.venda_em_json(v_salao, v_sale_id, true);
    END IF;

    -- 2. Cabeçalho: cliente, profissional e atendimento ----------------------
    v_competencia := COALESCE(NULLIF(p_venda->>'competenceDate', '')::date, CURRENT_DATE);

    v_cliente_id := NULLIF(p_venda->>'clientId', '');
    IF v_cliente_id IS NOT NULL THEN
        SELECT name INTO v_cliente_nome FROM clients
        WHERE id = v_cliente_id AND user_id = v_salao;
        IF v_cliente_nome IS NULL THEN
            RAISE EXCEPTION 'Cliente não encontrado neste salão.';
        END IF;
    END IF;

    v_prof_id := NULLIF(p_venda->>'professionalId', '');
    IF v_prof_id IS NOT NULL THEN
        SELECT name INTO v_prof_nome FROM professionals
        WHERE id = v_prof_id AND user_id = v_salao;
        IF v_prof_nome IS NULL THEN
            RAISE EXCEPTION 'Profissional não encontrado neste salão.';
        END IF;
    END IF;

    v_appt_id := NULLIF(p_venda->>'appointmentId', '');
    IF v_appt_id IS NOT NULL THEN
        PERFORM 1 FROM appointments WHERE id = v_appt_id AND user_id = v_salao;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Atendimento não encontrado neste salão.';
        END IF;

        PERFORM 1 FROM sales
        WHERE user_id = v_salao AND appointment_id = v_appt_id
          AND status NOT IN ('cancelled', 'refunded');
        IF FOUND THEN
            RAISE EXCEPTION 'Este atendimento já possui uma venda concluída.';
        END IF;
    END IF;

    v_origem := CASE WHEN v_appt_id IS NULL THEN 'counter' ELSE 'appointment' END;

    -- 3. Itens: confere as contas antes de gravar qualquer coisa -------------
    IF jsonb_typeof(p_venda->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_venda->'items') = 0 THEN
        RAISE EXCEPTION 'A venda precisa de ao menos um item.';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_venda->'items') LOOP
        v_tipo := v_item->>'itemType';
        IF v_tipo IS NULL OR v_tipo NOT IN ('service', 'product') THEN
            RAISE EXCEPTION 'Tipo de item inválido: %', COALESCE(v_tipo, 'nulo');
        END IF;

        v_qtd  := COALESCE((v_item->>'quantity')::integer, 0);
        v_unit := ROUND(COALESCE((v_item->>'unitPrice')::numeric, -1), 2);
        IF v_qtd <= 0 THEN
            RAISE EXCEPTION 'Quantidade do item precisa ser maior que zero.';
        END IF;
        IF v_unit < 0 THEN
            RAISE EXCEPTION 'Preço do item não pode ser negativo.';
        END IF;

        v_bruto     := ROUND(v_unit * v_qtd, 2);
        v_desc_item := ROUND(COALESCE((v_item->>'discountAmount')::numeric, 0), 2);
        v_acr_item  := ROUND(COALESCE((v_item->>'surchargeAmount')::numeric, 0), 2);
        v_liq_item  := ROUND(COALESCE((v_item->>'netAmount')::numeric, -1), 2);

        IF v_desc_item < 0 OR v_acr_item < 0 THEN
            RAISE EXCEPTION 'Ajustes do item não podem ser negativos.';
        END IF;
        IF v_desc_item > v_bruto THEN
            RAISE EXCEPTION 'Desconto do item maior que o próprio item.';
        END IF;
        IF v_liq_item <> v_bruto - v_desc_item + v_acr_item THEN
            RAISE EXCEPTION 'Valor líquido do item não confere com o rateio enviado.';
        END IF;

        IF v_tipo = 'service' THEN
            v_sub_serv := v_sub_serv + v_bruto;
            v_qtd_serv := v_qtd_serv + v_qtd;
        ELSE
            v_sub_prod := v_sub_prod + v_bruto;
            v_qtd_prod := v_qtd_prod + v_qtd;
        END IF;

        v_desc_soma := v_desc_soma + v_desc_item;
        v_acr_soma  := v_acr_soma + v_acr_item;
        v_liq_soma  := v_liq_soma + v_liq_item;
    END LOOP;

    v_subtotal  := ROUND(v_sub_serv + v_sub_prod, 2);
    v_desconto  := ROUND(COALESCE((p_venda->>'discountAmount')::numeric, 0), 2);
    v_acrescimo := ROUND(COALESCE((p_venda->>'surchargeAmount')::numeric, 0), 2);
    v_total     := ROUND(v_subtotal - v_desconto + v_acrescimo, 2);

    -- O rateio é decidido na tela, mas a soma tem que bater aqui: é o que
    -- impede a comissão de ser calculada sobre uma base que o cliente não pagou.
    IF v_desc_soma <> v_desconto THEN
        RAISE EXCEPTION 'A soma dos descontos dos itens (%) não fecha com o desconto da venda (%).', v_desc_soma, v_desconto;
    END IF;
    IF v_acr_soma <> v_acrescimo THEN
        RAISE EXCEPTION 'A soma dos acréscimos dos itens (%) não fecha com o acréscimo da venda (%).', v_acr_soma, v_acrescimo;
    END IF;
    IF v_liq_soma <> v_total THEN
        RAISE EXCEPTION 'A soma dos itens (%) não fecha com o total da venda (%).', v_liq_soma, v_total;
    END IF;
    IF v_desconto > v_subtotal THEN
        RAISE EXCEPTION 'Desconto maior que o subtotal da venda.';
    END IF;
    IF v_total < 0 THEN
        RAISE EXCEPTION 'Total da venda não pode ser negativo.';
    END IF;

    -- 4. Pagamentos: só o que foi realmente recebido -------------------------
    IF jsonb_typeof(p_venda->'payments') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Lista de pagamentos inválida.';
    END IF;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_venda->'payments') LOOP
        v_metodo := v_pag->>'paymentMethod';
        IF v_metodo IS NULL
           OR v_metodo NOT IN ('pix', 'cash', 'debit_card', 'credit_card', 'other') THEN
            RAISE EXCEPTION 'Forma de pagamento inválida: %', COALESCE(v_metodo, 'nula');
        END IF;

        v_valor := ROUND(COALESCE((v_pag->>'amount')::numeric, 0), 2);
        IF v_valor <= 0 THEN
            RAISE EXCEPTION 'Valor do pagamento precisa ser maior que zero.';
        END IF;

        IF v_metodo = 'cash' THEN
            v_entregue := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
            IF v_entregue < v_valor THEN
                RAISE EXCEPTION 'Valor entregue em dinheiro é menor que o valor do pagamento.';
            END IF;
            v_troco := v_troco + (v_entregue - v_valor);
        END IF;

        v_recebido := v_recebido + v_valor;
        IF v_valor > v_maior_pag THEN
            v_maior_pag := v_valor;
            v_metodo_principal := v_metodo;
        END IF;
    END LOOP;

    v_recebido := ROUND(v_recebido, 2);
    v_troco    := ROUND(v_troco, 2);
    v_receber  := ROUND(v_total - v_recebido, 2);

    -- O troco entra como valor entregue no próprio pagamento em dinheiro. Um
    -- pagamento MAIOR que o devido inflaria o caixa e o faturamento.
    IF v_recebido > v_total THEN
        RAISE EXCEPTION 'Os pagamentos (%) somam mais que o total da venda (%).', v_recebido, v_total;
    END IF;
    IF v_receber > 0 AND v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venda a prazo precisa de cliente identificado: não há de quem cobrar.';
    END IF;

    -- 5. Estoque: bloqueia, confere e baixa ----------------------------------
    -- ORDER BY no produto: duas vendas concorrentes pegam os locks na mesma
    -- ordem e não travam uma na outra.
    FOR v_produto IN
        SELECT NULLIF(i->>'productId', '') AS product_id,
               SUM((i->>'quantity')::integer) AS qtd
        FROM jsonb_array_elements(p_venda->'items') i
        WHERE i->>'itemType' = 'product'
        GROUP BY 1
        ORDER BY 1
    LOOP
        IF v_produto.product_id IS NULL THEN
            RAISE EXCEPTION 'Item de produto sem identificação do produto.';
        END IF;

        SELECT stock, name INTO v_estoque, v_nome
        FROM products
        WHERE id = v_produto.product_id AND user_id = v_salao
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto não encontrado neste salão.';
        END IF;

        IF v_estoque < v_produto.qtd THEN
            RAISE EXCEPTION 'Estoque insuficiente de %: restam % e a venda pede %.', v_nome, v_estoque, v_produto.qtd;
        END IF;

        UPDATE products SET stock = stock - v_produto.qtd
        WHERE id = v_produto.product_id AND user_id = v_salao;
    END LOOP;

    -- 6. Cabeçalho da venda --------------------------------------------------
    v_sale_id := 'sale-' || replace(gen_random_uuid()::text, '-', '');
    v_sufixo  := substr(v_sale_id, 6);

    -- Número visível: sequencial por salão, alocado sob lock.
    PERFORM pg_advisory_xact_lock(hashtext(v_salao::text || ':numero_venda'));
    SELECT COALESCE(MAX(sale_number), 0) + 1 INTO v_numero
    FROM sales WHERE user_id = v_salao;

    INSERT INTO sales (
        id, user_id, sale_number, appointment_id,
        client_id, client_name, professional_id, professional_name,
        origin, status, subtotal_services, subtotal_products, subtotal,
        discount_type, discount_value, discount_amount,
        surcharge_type, surcharge_value, surcharge_amount,
        total, amount_received, amount_receivable, change_amount,
        notes, idempotency_key, sold_at, sold_by
    ) VALUES (
        v_sale_id, v_salao, v_numero, v_appt_id,
        v_cliente_id, v_cliente_nome, v_prof_id, v_prof_nome,
        v_origem,
        CASE WHEN v_receber <= 0 THEN 'paid' WHEN v_recebido > 0 THEN 'partial' ELSE 'on_credit' END,
        v_sub_serv, v_sub_prod, v_subtotal,
        NULLIF(p_venda->>'discountType', ''), ROUND(COALESCE((p_venda->>'discountValue')::numeric, 0), 4), v_desconto,
        NULLIF(p_venda->>'surchargeType', ''), ROUND(COALESCE((p_venda->>'surchargeValue')::numeric, 0), 4), v_acrescimo,
        v_total, v_recebido, GREATEST(v_receber, 0), v_troco,
        NULLIF(TRIM(COALESCE(p_venda->>'notes', '')), ''), v_chave, v_agora, auth.uid()
    );

    -- 7. Itens e movimentos de estoque ---------------------------------------
    v_seq := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_venda->'items') LOOP
        v_seq  := v_seq + 1;
        v_tipo := v_item->>'itemType';
        v_qtd  := (v_item->>'quantity')::integer;
        v_unit := ROUND((v_item->>'unitPrice')::numeric, 2);
        v_bruto     := ROUND(v_unit * v_qtd, 2);
        v_desc_item := ROUND(COALESCE((v_item->>'discountAmount')::numeric, 0), 2);
        v_acr_item  := ROUND(COALESCE((v_item->>'surchargeAmount')::numeric, 0), 2);
        v_liq_item  := ROUND((v_item->>'netAmount')::numeric, 2);

        v_ref_id := NULLIF(v_item->>(CASE WHEN v_tipo = 'service' THEN 'serviceId' ELSE 'productId' END), '');
        v_nome   := NULL;

        IF v_ref_id IS NOT NULL THEN
            IF v_tipo = 'service' THEN
                SELECT name INTO v_nome FROM services WHERE id = v_ref_id AND user_id = v_salao;
            ELSE
                SELECT name INTO v_nome FROM products WHERE id = v_ref_id AND user_id = v_salao;
            END IF;
            IF v_nome IS NULL THEN
                RAISE EXCEPTION 'Item não encontrado no cadastro deste salão.';
            END IF;
        END IF;

        -- Cadastro excluído depois: o nome enviado vira o registro, para o item
        -- não ficar sem identificação no histórico.
        v_nome := COALESCE(v_nome, NULLIF(TRIM(COALESCE(v_item->>'itemName', '')), ''));
        IF v_nome IS NULL THEN
            RAISE EXCEPTION 'Item sem nome e sem vínculo com o cadastro.';
        END IF;

        v_prof_item := COALESCE(NULLIF(v_item->>'professionalId', ''), v_prof_id);
        v_prof_item_nome := NULL;
        v_taxa := 0;

        IF v_prof_item IS NOT NULL THEN
            SELECT name, COALESCE(commission, 0) INTO v_prof_item_nome, v_taxa
            FROM professionals WHERE id = v_prof_item AND user_id = v_salao;
            IF v_prof_item_nome IS NULL THEN
                RAISE EXCEPTION 'Profissional do item não encontrado neste salão.';
            END IF;
        END IF;

        -- Produto nunca gera comissão, e acréscimo não aumenta a base. A taxa é
        -- PORCENTAGEM (50 = 50%), como no cadastro do profissional e na aba
        -- Comissões; por isso o /100. No Solo ela é 0 e nenhuma comissão nasce.
        IF v_tipo = 'service' AND v_prof_item IS NOT NULL THEN
            v_taxa := LEAST(GREATEST(COALESCE(v_taxa, 0), 0), 100);
            v_base := ROUND(v_bruto - v_desc_item, 2);
        ELSE
            v_taxa := 0;
            v_base := 0;
        END IF;

        INSERT INTO sale_items (
            id, user_id, sale_id, item_type, reference_id, name,
            quantity, unit_price, gross_total, discount_amount, surcharge_amount, net_total,
            professional_id, professional_name, commission_rate, commission_base, commission_amount
        ) VALUES (
            'si-' || v_sufixo || '-' || v_seq, v_salao, v_sale_id, v_tipo,
            -- reference_id é NOT NULL; item sem cadastro (só nome) fica com ''.
            COALESCE(v_ref_id, ''), v_nome,
            v_qtd, v_unit, v_bruto, v_desc_item, v_acr_item, v_liq_item,
            v_prof_item, v_prof_item_nome, v_taxa, v_base, ROUND(v_base * v_taxa / 100, 2)
        );

        IF v_tipo = 'product' THEN
            INSERT INTO stock_movements (id, user_id, "productId", type, quantity, reason, date, sale_id)
            VALUES ('mov-' || v_sufixo || '-' || v_seq, v_salao, v_ref_id, 'out', v_qtd,
                    'Venda #' || lpad(v_numero::text, 6, '0'), to_char(v_competencia, 'YYYY-MM-DD'), v_sale_id);
        END IF;
    END LOOP;

    -- 8. Pagamentos, caixa e financeiro --------------------------------------
    SELECT id INTO v_caixa FROM cash_registers
    WHERE user_id = v_salao AND status = 'open'
    ORDER BY "dateOpened" DESC LIMIT 1;

    -- Mesmas categorias dos relatórios: só serviço = 'Serviço', só produto =
    -- 'Produto', venda mista = 'Venda'.
    v_categoria := CASE
        WHEN v_qtd_prod = 0 THEN 'Serviço'
        WHEN v_qtd_serv = 0 THEN 'Produto'
        ELSE 'Venda'
    END;
    v_resumo := 'Venda #' || lpad(v_numero::text, 6, '0') || COALESCE(' - ' || v_cliente_nome, '');

    v_seq := 0;
    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_venda->'payments') LOOP
        v_seq    := v_seq + 1;
        v_metodo := v_pag->>'paymentMethod';
        v_valor  := ROUND((v_pag->>'amount')::numeric, 2);

        IF v_metodo = 'cash' THEN
            v_entregue  := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
            v_troco_pag := ROUND(v_entregue - v_valor, 2);
        ELSE
            v_entregue  := NULL;
            v_troco_pag := 0;
        END IF;

        INSERT INTO sale_payments (
            id, user_id, sale_id, payment_method, amount, cash_received, change_amount,
            installment_count, transaction_id, status, paid_at
        ) VALUES (
            'sp-' || v_sufixo || '-' || v_seq, v_salao, v_sale_id, v_metodo, v_valor,
            v_entregue, v_troco_pag, 1, 'tr-' || v_sufixo || '-' || v_seq, 'confirmed', v_agora
        );

        -- Uma linha no financeiro por pagamento, com o valor DEVIDO, nunca o
        -- entregue: o troco não infla faturamento nem gaveta. Dinheiro com o
        -- caixa fechado entra como 'pending', como no lançamento manual.
        INSERT INTO transactions (
            id, user_id, type, amount, date, "registradoEm", description, category,
            "paymentMethod", status, "clientId", professional_id, appointment_id,
            sale_id, sale_payment_id, cash_register_id, source
        ) VALUES (
            'tr-' || v_sufixo || '-' || v_seq, v_salao, 'income', v_valor,
            -- Mesmo formato de new Date().toISOString(): o saldo em gaveta
            -- compara "registradoEm" com "dateOpened" como texto.
            to_char(v_competencia, 'YYYY-MM-DD'),
            to_char(v_agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            v_resumo, v_categoria,
            v_metodo,
            CASE WHEN v_metodo = 'cash' AND v_caixa IS NULL THEN 'pending' ELSE 'completed' END,
            v_cliente_id, v_prof_id, v_appt_id,
            v_sale_id, 'sp-' || v_sufixo || '-' || v_seq,
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, 'sale'
        );
    END LOOP;

    -- 9. Atendimento de origem e último corte do cliente ---------------------
    IF v_appt_id IS NOT NULL THEN
        UPDATE appointments
        SET status = 'done', "paymentStatus" = 'paid',
            "paymentMethod" = COALESCE(v_metodo_principal, "paymentMethod")
        WHERE id = v_appt_id AND user_id = v_salao;
    END IF;

    -- Qualquer venda com cliente atualiza o último corte, inclusive a de
    -- balcão (correção do script 32 da Alabama).
    IF v_cliente_id IS NOT NULL THEN
        UPDATE clients
        SET "lastVisit" = to_char(v_competencia, 'YYYY-MM-DD')
        WHERE id = v_cliente_id AND user_id = v_salao
          AND (COALESCE("lastVisit", '') < to_char(v_competencia, 'YYYY-MM-DD'));
    END IF;

    IF v_receber > 0 THEN
        PERFORM public.gerar_crediario(v_sale_id, p_venda->'creditPlan');
    END IF;

    RETURN public.venda_em_json(v_salao, v_sale_id, false);
END;
$$;

-- Só quem está logado vende. A função já recusaria a anon (salao_do_usuario
-- volta nulo), mas não há motivo para a chave pública alcançá-la.
REVOKE ALL ON FUNCTION public.finalizar_venda(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_venda(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA (as três linhas têm que vir com ok = true)
-- ============================================================================
SELECT 'stock_movements tem sale_id' AS conferencia,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'stock_movements'
                 AND column_name = 'sale_id') AS ok
UNION ALL
SELECT 'finalizar_venda le serviceId',
       pg_get_functiondef('public.finalizar_venda(jsonb)'::regprocedure) LIKE '%serviceId%'
UNION ALL
SELECT 'anon nao executa finalizar_venda',
       NOT has_function_privilege('anon', 'public.finalizar_venda(jsonb)', 'EXECUTE');
