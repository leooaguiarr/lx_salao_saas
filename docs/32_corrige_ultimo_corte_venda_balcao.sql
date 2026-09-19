-- ============================================================
-- SCRIPT 32: ULTIMO CORTE NAO ATUALIZAVA NA VENDA DE BALCAO
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTE SCRIPT CONSERTA
--
-- Cliente relatou: faz a venda, escolhe o cliente no checkout, finaliza — e a
-- coluna "Ultimo Corte" da aba Clientes nao muda.
--
-- Causa: dentro de finalizar_venda() (script 15, secao 9), o UPDATE de
-- clients."lastVisit" estava ANINHADO dentro do `IF v_appt_id IS NOT NULL`,
-- que so e verdadeiro quando a venda nasceu de um agendamento. Venda de
-- balcao (cliente escolhido direto no checkout, sem horario agendado) tem
-- v_appt_id NULL — o bloco inteiro nunca rodava, e o ultimo corte desse
-- cliente ficava parado na visita anterior (ou "Sem registros").
--
-- Conferido no banco: 8 vendas de balcao com cliente identificado, 6 clientes
-- com o "Ultimo Corte" desatualizado por causa disso.
--
-- O QUE MUDA
--
--   1. finalizar_venda(): o UPDATE de lastVisit sai de dentro do IF do
--      agendamento. Agora roda para QUALQUER venda com cliente identificado,
--      balcao ou agendamento — a condicao de sempre continua valendo (so
--      atualiza se a data da venda for mais recente que a que ja estava
--      gravada, entao uma venda antiga lancada fora de ordem nao "volta o
--      relogio" do cliente).
--   2. Backfill: os clientes cujo Ultimo Corte ja ficou preso por causa disso
--      recebem a data da venda mais recente encontrada no historico.
--
-- Nada mais na funcao muda — mesma validacao, mesmo estoque, mesmo caixa,
-- mesmo crediario.

BEGIN;

-- ------------------------------------------------------------
-- 1. finalizar_venda(): corrige a secao 9
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_venda(p_venda jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    -- --------------------------------------------------------
    -- 1. Contexto, papel e idempotencia
    -- --------------------------------------------------------
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.' USING ERRCODE = '42501';
    END IF;

    -- Decisao da Fase A: somente o dono conclui venda. Ampliar isso exige uma
    -- matriz de acesso explicita, nao um ajuste de tela.
    -- Fase I (niveis de acesso): o profissional TAMBEM conclui venda.
    -- O que ele nao pode e fechar o atendimento de OUTRO: venda de balcao
    -- e livre, mas a que nasce de um agendamento so sai pelo dono ou por
    -- quem vai fazer o corte.
    IF public.meu_papel() <> 'owner'
       AND NULLIF(TRIM(COALESCE(p_venda->>'appointmentId', '')), '') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM appointments a
            WHERE a.id = NULLIF(TRIM(p_venda->>'appointmentId'), '')
              AND a.user_id = v_salao
              AND a."profId" = public.meu_profissional()
       ) THEN
        RAISE EXCEPTION 'Este atendimento e de outro profissional.'
            USING ERRCODE = '42501';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_venda->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Chave de idempotencia obrigatoria.';
    END IF;

    -- O lock serializa requisicoes com a MESMA chave. Sem ele, o duplo clique
    -- faria as duas transacoes passarem pela consulta abaixo antes de qualquer
    -- gravacao, e a segunda so morreria na unicidade — com o estoque ja
    -- baixado no rascunho dela. Aqui a segunda espera e devolve a primeira.
    PERFORM pg_advisory_xact_lock(hashtext(v_salao::text || ':venda:' || v_chave));

    SELECT id INTO v_sale_id
    FROM sales
    WHERE user_id = v_salao AND idempotency_key = v_chave;

    IF v_sale_id IS NOT NULL THEN
        RETURN public.venda_em_json(v_salao, v_sale_id, true);
    END IF;

    -- --------------------------------------------------------
    -- 2. Cabecalho: cliente, profissional e atendimento
    -- --------------------------------------------------------
    v_competencia := COALESCE(NULLIF(p_venda->>'competenceDate', '')::date, CURRENT_DATE);

    v_cliente_id := NULLIF(p_venda->>'clientId', '');
    IF v_cliente_id IS NOT NULL THEN
        SELECT name INTO v_cliente_nome FROM clients
        WHERE id = v_cliente_id AND user_id = v_salao;
        IF v_cliente_nome IS NULL THEN
            RAISE EXCEPTION 'Cliente nao encontrado neste salao.';
        END IF;
    END IF;

    v_prof_id := NULLIF(p_venda->>'professionalId', '');
    IF v_prof_id IS NOT NULL THEN
        SELECT name INTO v_prof_nome FROM professionals
        WHERE id = v_prof_id AND user_id = v_salao;
        IF v_prof_nome IS NULL THEN
            RAISE EXCEPTION 'Profissional nao encontrado neste salao.';
        END IF;
    END IF;

    v_appt_id := NULLIF(p_venda->>'appointmentId', '');
    IF v_appt_id IS NOT NULL THEN
        PERFORM 1 FROM appointments WHERE id = v_appt_id AND user_id = v_salao;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Atendimento nao encontrado neste salao.';
        END IF;

        -- Mensagem legivel antes de o indice unico parcial responder com
        -- "duplicate key". A protecao de verdade continua sendo o indice.
        PERFORM 1 FROM sales
        WHERE user_id = v_salao AND appointment_id = v_appt_id
          AND status NOT IN ('cancelled', 'refunded');
        IF FOUND THEN
            RAISE EXCEPTION 'Este atendimento ja possui uma venda concluida.';
        END IF;
    END IF;

    v_origem := CASE WHEN v_appt_id IS NULL THEN 'counter' ELSE 'appointment' END;

    -- --------------------------------------------------------
    -- 3. Itens: confere as contas antes de gravar qualquer coisa
    -- --------------------------------------------------------
    IF jsonb_typeof(p_venda->'items') <> 'array'
       OR jsonb_array_length(p_venda->'items') = 0 THEN
        RAISE EXCEPTION 'A venda precisa de ao menos um item.';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_venda->'items') LOOP
        v_tipo := v_item->>'itemType';
        -- O teste do IS NULL vem antes de proposito: `NULL NOT IN (...)` nao e
        -- verdadeiro, entao um campo ausente passaria batido aqui e so morreria
        -- la na frente, no CHECK da tabela, com uma mensagem que ninguem no
        -- balcao entende.
        IF v_tipo IS NULL OR v_tipo NOT IN ('service', 'product') THEN
            RAISE EXCEPTION 'Tipo de item invalido: %', COALESCE(v_tipo, 'nulo');
        END IF;

        v_qtd  := COALESCE((v_item->>'quantity')::integer, 0);
        v_unit := ROUND(COALESCE((v_item->>'unitPrice')::numeric, -1), 2);
        IF v_qtd <= 0 THEN
            RAISE EXCEPTION 'Quantidade do item precisa ser maior que zero.';
        END IF;
        IF v_unit < 0 THEN
            RAISE EXCEPTION 'Preco do item nao pode ser negativo.';
        END IF;

        v_bruto     := ROUND(v_unit * v_qtd, 2);
        v_desc_item := ROUND(COALESCE((v_item->>'discountAmount')::numeric, 0), 2);
        v_acr_item  := ROUND(COALESCE((v_item->>'surchargeAmount')::numeric, 0), 2);
        v_liq_item  := ROUND(COALESCE((v_item->>'netAmount')::numeric, -1), 2);

        IF v_desc_item < 0 OR v_acr_item < 0 THEN
            RAISE EXCEPTION 'Ajustes do item nao podem ser negativos.';
        END IF;
        IF v_desc_item > v_bruto THEN
            RAISE EXCEPTION 'Desconto do item maior que o proprio item.';
        END IF;
        IF v_liq_item <> v_bruto - v_desc_item + v_acr_item THEN
            RAISE EXCEPTION 'Valor liquido do item nao confere com o rateio enviado.';
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

    -- O rateio e decidido na tela, mas a soma tem que bater aqui. E isto que
    -- impede um desconto "some" no caminho e a comissao ser calculada sobre
    -- uma base que o cliente nunca pagou.
    IF v_desc_soma <> v_desconto THEN
        RAISE EXCEPTION 'A soma dos descontos dos itens (%) nao fecha com o desconto da venda (%).',
            v_desc_soma, v_desconto;
    END IF;
    IF v_acr_soma <> v_acrescimo THEN
        RAISE EXCEPTION 'A soma dos acrescimos dos itens (%) nao fecha com o acrescimo da venda (%).',
            v_acr_soma, v_acrescimo;
    END IF;
    IF v_liq_soma <> v_total THEN
        RAISE EXCEPTION 'A soma dos itens (%) nao fecha com o total da venda (%).',
            v_liq_soma, v_total;
    END IF;
    IF v_desconto > v_subtotal THEN
        RAISE EXCEPTION 'Desconto maior que o subtotal da venda.';
    END IF;
    IF v_total < 0 THEN
        RAISE EXCEPTION 'Total da venda nao pode ser negativo.';
    END IF;

    -- --------------------------------------------------------
    -- 4. Pagamentos: so o que foi realmente recebido
    -- --------------------------------------------------------
    IF jsonb_typeof(p_venda->'payments') <> 'array' THEN
        RAISE EXCEPTION 'Lista de pagamentos invalida.';
    END IF;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_venda->'payments') LOOP
        v_metodo := v_pag->>'paymentMethod';
        IF v_metodo IS NULL
           OR v_metodo NOT IN ('pix', 'cash', 'debit_card', 'credit_card', 'other') THEN
            RAISE EXCEPTION 'Forma de pagamento invalida: %', COALESCE(v_metodo, 'nula');
        END IF;

        v_valor := ROUND(COALESCE((v_pag->>'amount')::numeric, 0), 2);
        IF v_valor <= 0 THEN
            RAISE EXCEPTION 'Valor do pagamento precisa ser maior que zero.';
        END IF;

        IF v_metodo = 'cash' THEN
            v_entregue := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
            IF v_entregue < v_valor THEN
                RAISE EXCEPTION 'Valor entregue em dinheiro e menor que o valor do pagamento.';
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

    IF v_recebido > v_total THEN
        -- O troco entra como valor entregue no proprio pagamento em dinheiro.
        -- Um pagamento MAIOR que o devido inflaria o caixa e o faturamento.
        RAISE EXCEPTION 'Os pagamentos (%) somam mais que o total da venda (%).',
            v_recebido, v_total;
    END IF;

    -- Reservado para a Fase E. O modelo ja separa recebido de a receber, mas
    -- ninguem grava divida antes do Crediario existir de verdade.
    IF v_receber > 0 AND v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venda a prazo precisa de cliente identificado: nao ha de quem cobrar.';
    END IF;

    -- --------------------------------------------------------
    -- 5. Estoque: bloqueia, confere e baixa
    -- --------------------------------------------------------
    -- ORDER BY no product_id de proposito: duas vendas concorrentes com os
    -- mesmos produtos pegam os locks na mesma ordem e nao travam uma na outra.
    FOR v_produto IN
        SELECT (i->>'productId') AS product_id,
               SUM((i->>'quantity')::integer) AS qtd
        FROM jsonb_array_elements(p_venda->'items') i
        WHERE i->>'itemType' = 'product'
        GROUP BY 1
        ORDER BY 1
    LOOP
        IF v_produto.product_id IS NULL THEN
            RAISE EXCEPTION 'Item de produto sem identificacao do produto.';
        END IF;

        SELECT stock, name INTO v_estoque, v_nome
        FROM products
        WHERE id = v_produto.product_id AND user_id = v_salao
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto nao encontrado neste salao.';
        END IF;

        -- Diferente de registrar_movimento_estoque(): aqui NAO existe
        -- GREATEST(0, ...). Venda sem saldo derruba a operacao inteira.
        IF v_estoque < v_produto.qtd THEN
            RAISE EXCEPTION 'Estoque insuficiente de %: restam % e a venda pede %.',
                v_nome, v_estoque, v_produto.qtd;
        END IF;

        UPDATE products
        SET stock = stock - v_produto.qtd
        WHERE id = v_produto.product_id AND user_id = v_salao;
    END LOOP;

    -- --------------------------------------------------------
    -- 6. Cabecalho da venda
    -- --------------------------------------------------------
    v_sale_id := 'sale-' || replace(gen_random_uuid()::text, '-', '');
    -- O uuid INTEIRO vira o prefixo dos ids filhos (si-, sp-, mov-, tr-). Um
    -- pedaco menor economizaria caracteres num campo TEXT e criaria uma chance
    -- real de colisao entre salões — e colisao aqui derruba a venda no balcao.
    v_sufixo  := substr(v_sale_id, 6);

    -- Numero visivel: sequencial por salao, alocado sob lock. MAX()+1 sem lock
    -- daria o mesmo numero para duas vendas simultaneas.
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
        v_origem, CASE WHEN v_receber <= 0 THEN 'paid' WHEN v_recebido > 0 THEN 'partial' ELSE 'on_credit' END, v_sub_serv, v_sub_prod, v_subtotal,
        NULLIF(p_venda->>'discountType', ''), ROUND(COALESCE((p_venda->>'discountValue')::numeric, 0), 4), v_desconto,
        NULLIF(p_venda->>'surchargeType', ''), ROUND(COALESCE((p_venda->>'surchargeValue')::numeric, 0), 4), v_acrescimo,
        v_total, v_recebido, v_receber, v_troco,
        NULLIF(TRIM(COALESCE(p_venda->>'notes', '')), ''), v_chave, v_agora, auth.uid()
    );

    -- --------------------------------------------------------
    -- 7. Itens e movimentos de estoque
    -- --------------------------------------------------------
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
                SELECT name INTO v_nome FROM services
                WHERE id = v_ref_id AND user_id = v_salao;
            ELSE
                SELECT name INTO v_nome FROM products
                WHERE id = v_ref_id AND user_id = v_salao;
            END IF;
            IF v_nome IS NULL THEN
                RAISE EXCEPTION 'Item nao encontrado no cadastro deste salao.';
            END IF;
        END IF;

        -- Cadastro excluido depois da venda antiga: o nome enviado vira o
        -- snapshot, para o item nao ficar sem identificacao no historico.
        v_nome := COALESCE(v_nome, NULLIF(TRIM(COALESCE(v_item->>'itemName', '')), ''));
        IF v_nome IS NULL THEN
            RAISE EXCEPTION 'Item sem nome e sem vinculo com o cadastro.';
        END IF;

        v_prof_item := COALESCE(NULLIF(v_item->>'professionalId', ''), v_prof_id);
        v_prof_item_nome := NULL;
        v_taxa := 0;

        IF v_prof_item IS NOT NULL THEN
            SELECT name, COALESCE(commission, 0)
            INTO v_prof_item_nome, v_taxa
            FROM professionals
            WHERE id = v_prof_item AND user_id = v_salao;
            IF v_prof_item_nome IS NULL THEN
                RAISE EXCEPTION 'Profissional do item nao encontrado neste salao.';
            END IF;
        END IF;

        -- Produto nunca gera comissao, e acrescimo nao aumenta a base: a
        -- comissao incide sobre o bruto MENOS o desconto proporcional. Sao os
        -- valores congelados que a Fase D vai usar.
        IF v_tipo = 'service' AND v_prof_item IS NOT NULL THEN
            v_taxa := LEAST(GREATEST(COALESCE(v_taxa, 0), 0), 100);
            v_base := ROUND(v_bruto - v_desc_item, 2);
        ELSE
            v_taxa := 0;
            v_base := 0;
        END IF;

        INSERT INTO sale_items (
            id, user_id, sale_id, item_type, service_id, product_id, item_name,
            professional_id, professional_name, quantity, unit_price,
            gross_amount, discount_amount, surcharge_amount, net_amount,
            commission_rate, commission_base
        ) VALUES (
            'si-' || v_sufixo || '-' || v_seq, v_salao, v_sale_id, v_tipo,
            CASE WHEN v_tipo = 'service' THEN v_ref_id END,
            CASE WHEN v_tipo = 'product' THEN v_ref_id END,
            v_nome, v_prof_item, v_prof_item_nome, v_qtd, v_unit,
            v_bruto, v_desc_item, v_acr_item, v_liq_item,
            v_taxa, v_base
        );

        -- Extrato do estoque, uma linha por item da venda. O saldo ja foi
        -- baixado no passo 5; aqui fica o registro do porque, com o vinculo
        -- direto para a venda e para o item que a Fase C vai mostrar.
        IF v_tipo = 'product' THEN
            INSERT INTO stock_movements (
                id, user_id, "productId", "productName", type, qty, reason,
                "unitPrice", total, "clientId", "appointmentId", "profId",
                sale_id, sale_item_id, note, date
            ) VALUES (
                'mov-' || v_sufixo || '-' || v_seq, v_salao, v_ref_id, v_nome,
                'out', v_qtd, 'venda', v_unit, v_liq_item,
                v_cliente_id, v_appt_id, v_prof_item,
                v_sale_id, 'si-' || v_sufixo || '-' || v_seq,
                'Venda #' || lpad(v_numero::text, 6, '0'), v_competencia
            );
        END IF;
    END LOOP;

    -- --------------------------------------------------------
    -- 8. Pagamentos, caixa e razao financeiro
    -- --------------------------------------------------------
    SELECT id INTO v_caixa
    FROM cash_registers
    WHERE user_id = v_salao AND status = 'open'
    ORDER BY "dateOpened" DESC
    LIMIT 1;

    -- Categoria compativel com os relatorios atuais: venda so de servico
    -- continua sendo 'Servico', so de produto continua 'Produto'. So a venda
    -- mista estreia a categoria 'Venda' — ela nao existia antes justamente
    -- porque nao havia como misturar os dois num lancamento.
    v_categoria := CASE
        WHEN v_qtd_prod = 0 THEN 'Serviço'
        WHEN v_qtd_serv = 0 THEN 'Produto'
        ELSE 'Venda'
    END;

    v_resumo := 'Venda #' || lpad(v_numero::text, 6, '0')
                || COALESCE(' - ' || v_cliente_nome, '');

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
            id, user_id, sale_id, payment_method, amount,
            cash_received, change_amount, status, cash_register_id, paid_at
        ) VALUES (
            'sp-' || v_sufixo || '-' || v_seq, v_salao, v_sale_id, v_metodo, v_valor,
            v_entregue, v_troco_pag, 'completed',
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, v_agora
        );

        -- Uma linha no razao por pagamento REALMENTE recebido, com o valor
        -- devido — nunca com o valor entregue. E isto que impede o troco de
        -- inflar o faturamento e o saldo em gaveta.
        --
        -- Dinheiro com o caixa fechado entra como 'pending', a mesma regra que
        -- ja vale no lancamento manual e na venda pelo Estoque.
        INSERT INTO transactions (
            id, user_id, type, amount, date, "registradoEm", description,
            category, "paymentMethod", "profId", status,
            "clientId", "appointmentId",
            sale_id, sale_payment_id, cash_register_id, source
        ) VALUES (
            'tr-' || v_sufixo || '-' || v_seq, v_salao, 'income', v_valor,
            -- Mesmo formato de new Date().toISOString(): o saldo em gaveta
            -- compara "registradoEm" com "dateOpened" como TEXTO, e um formato
            -- diferente ("+00" em vez de "Z") poria o lancamento fora do caixa.
            to_char(v_competencia, 'YYYY-MM-DD'),
            to_char(v_agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            v_resumo, v_categoria, v_metodo, v_prof_id,
            CASE WHEN v_metodo = 'cash' AND v_caixa IS NULL THEN 'pending' ELSE 'completed' END,
            v_cliente_id, v_appt_id,
            v_sale_id, 'sp-' || v_sufixo || '-' || v_seq,
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, 'sale'
        );
    END LOOP;

    -- --------------------------------------------------------
    -- 9. O atendimento de origem e o ultimo corte do cliente
    -- --------------------------------------------------------
    -- O atendimento so existe quando a venda nasceu de um agendamento.
    IF v_appt_id IS NOT NULL THEN
        UPDATE appointments
        SET status = 'done',
            "paymentStatus" = 'paid',
            "paymentMethod" = COALESCE(v_metodo_principal, "paymentMethod")
        WHERE id = v_appt_id AND user_id = v_salao;
    END IF;

    -- CORRECAO (script 32): o ultimo corte tem que refletir QUALQUER venda com
    -- cliente identificado, nao so a que nasceu de agendamento. Antes esta
    -- atualizacao morava dentro do IF acima e a venda de balcao (cliente
    -- escolhido direto no checkout) nunca atualizava o cliente.
    IF v_cliente_id IS NOT NULL THEN
        UPDATE clients
        SET "lastVisit" = to_char(v_competencia, 'YYYY-MM-DD')
        WHERE id = v_cliente_id AND user_id = v_salao
          AND (COALESCE("lastVisit", '') < to_char(v_competencia, 'YYYY-MM-DD'));
    END IF;

    IF v_receber > 0 THEN PERFORM public.gerar_crediario(v_sale_id, p_venda->'creditPlan'); END IF;
    RETURN public.venda_em_json(v_salao, v_sale_id, false);
END;
$function$;

-- ------------------------------------------------------------
-- 2. Backfill: clientes que ja ficaram com o Ultimo Corte preso
-- ------------------------------------------------------------
-- Usa a data da venda mais recente e nao cancelada/estornada de cada cliente:
-- primeiro tenta a competencia gravada no Financeiro (transactions.date,
-- mais precisa), e cai para a data de fechamento (sold_at) quando a venda
-- nao gerou lancamento financeiro (ex.: credito 100% a prazo, sem entrada).
WITH ultima_venda AS (
    SELECT s.user_id,
           s.client_id,
           MAX(COALESCE(
               (SELECT MAX(t.date) FROM transactions t
                 WHERE t.sale_id = s.id AND t.user_id = s.user_id),
               to_char(s.sold_at, 'YYYY-MM-DD')
           )) AS dia
    FROM sales s
    WHERE s.client_id IS NOT NULL
      AND s.status NOT IN ('cancelled', 'refunded')
    GROUP BY s.user_id, s.client_id
)
UPDATE clients c
SET "lastVisit" = u.dia
FROM ultima_venda u
WHERE c.id = u.client_id
  AND c.user_id = u.user_id
  AND COALESCE(c."lastVisit", '') < u.dia;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA
-- ============================================================
--
-- 1. Nenhuma venda de balcao com cliente deveria mais ficar "atrasada":
--
--      SELECT count(*)
--        FROM sales s
--        JOIN clients c ON c.id = s.client_id AND c.user_id = s.user_id
--       WHERE s.client_id IS NOT NULL
--         AND s.status NOT IN ('cancelled','refunded')
--         AND COALESCE(c."lastVisit",'') < to_char(s.sold_at,'YYYY-MM-DD');
--
--    Tem que devolver zero (ou perto disso — uma venda de HOJE registrada
--    poucos segundos ates desta consulta pode aparecer por um instante).
--
-- 2. Teste na tela: abra o Checkout, monte uma venda de balcao (sem vir de
--    agendamento), escolha um cliente e finalize. A aba Clientes tem que
--    mostrar a data de hoje em "Ultimo Corte" imediatamente.
