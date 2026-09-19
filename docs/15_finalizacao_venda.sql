-- ============================================================
-- FASE B — FINALIZACAO ATOMICA DA VENDA
-- Execute depois de 14_vendas_base.sql.
-- Pode rodar mais de uma vez sem apagar ou regravar dados.
-- ============================================================
--
-- O QUE FALTAVA
--
-- A migration 14 criou as tabelas e fechou a escrita direta: `authenticated`
-- so tem SELECT em sales, sale_items e sale_payments. Faltava a porta.
--
-- Hoje uma venda nasce em tres lugares (atendimento, Financeiro e Estoque) e
-- cada um grava por conta propria. Quando a segunda gravacao falha, sobra meia
-- venda: dinheiro sem baixa de estoque, ou baixa sem dinheiro. Nao ha nada que
-- amarre as duas coisas, e nao ha nada que impeca o mesmo atendimento de ser
-- cobrado duas vezes.
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. Liga o extrato do estoque a venda (stock_movements.sale_id).
--   2. Cria venda_em_json(): leitura consolidada de uma venda (cabecalho,
--      itens e pagamentos) usada tanto pelo retorno da finalizacao quanto pela
--      repeticao idempotente.
--   3. Cria finalizar_venda(): A UNICA porta por onde uma venda nasce. Numa
--      transacao unica ela valida, bloqueia o estoque, grava venda, itens,
--      pagamentos, lancamentos financeiros e movimentos, e conclui o
--      atendimento de origem.
--
-- POR QUE UMA RPC, E NAO VARIOS INSERTS DO NAVEGADOR
--
--   a) ATOMICIDADE. Ou entra tudo, ou nao entra nada. Seis upserts separados
--      pelo PostgREST sao seis transacoes distintas: a queda da rede no meio
--      deixa o estoque baixado e a venda sem pagamento.
--
--   b) ESTOQUE. registrar_movimento_estoque() usa GREATEST(0, ...) e ACEITA
--      vender mais do que existe, zerando o saldo. Para um movimento fisico
--      isso esta certo (o inventario e que estava atrasado). Para uma venda
--      nao: aqui a linha do produto e bloqueada com FOR UPDATE e a venda
--      inteira e recusada quando o saldo nao cobre. Dois caixas nao conseguem
--      vender a mesma ultima unidade.
--
--   c) IDEMPOTENCIA. A chave vem do navegador e e travada com advisory lock. O
--      segundo clique (ou o F5 no meio) espera o primeiro terminar e recebe a
--      MESMA venda, em vez de cobrar de novo.
--
--   d) CONFIANCA. O total, o rateio do desconto e a soma dos pagamentos sao
--      recalculados aqui. O navegador propoe; o banco confere.
--
-- ⚠️ Este script NAO apaga nada e NAO mexe nos fluxos antigos. O Estoque e o
-- Financeiro continuam funcionando exatamente como antes ate a Fase C.

BEGIN;

-- ------------------------------------------------------------
-- 1. O extrato do estoque passa a saber de qual venda ele veio
-- ------------------------------------------------------------
-- "transactionId" nao serve para isso: uma venda com pagamento dividido gera
-- VARIOS lancamentos financeiros, e o movimento nasce de um so. Sem uma coluna
-- propria, a aba Vendas ainda leria essas saidas como "registro anterior" — a
-- mesma venda apareceria duas vezes no historico.
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS sale_id      TEXT;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS sale_item_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_sale_id_fkey') THEN
        ALTER TABLE public.stock_movements
            ADD CONSTRAINT stock_movements_sale_id_fkey
            FOREIGN KEY (user_id, sale_id)
            REFERENCES public.sales(user_id, id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_mov_venda
    ON public.stock_movements (user_id, sale_id)
    WHERE sale_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Leitura consolidada de uma venda
-- ------------------------------------------------------------
-- Devolve o que a tela precisa para atualizar sem recarregar tudo. Serve
-- tambem a repeticao idempotente: a segunda chamada recebe a venda que ja
-- existe, com o mesmo formato da primeira.
CREATE OR REPLACE FUNCTION public.venda_em_json(
    p_salao   uuid,
    p_sale_id text,
    p_repetida boolean DEFAULT false
)
RETURNS jsonb
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
            WHERE i.user_id = p_salao AND i.sale_id = s.id
        ), '[]'::jsonb),
        'pagamentos', COALESCE((
            SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.id)
            FROM sale_payments p
            WHERE p.user_id = p_salao AND p.sale_id = s.id
        ), '[]'::jsonb),
        'transacoes', COALESCE((
            SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.id)
            FROM transactions t
            WHERE t.user_id = p_salao AND t.sale_id = s.id
        ), '[]'::jsonb),
        'movimentos', COALESCE((
            SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.id)
            FROM stock_movements m
            WHERE m.user_id = p_salao AND m.sale_id = s.id
        ), '[]'::jsonb),
        'produtos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'stock', pr.stock))
            FROM products pr
            WHERE pr.user_id = p_salao
              AND pr.id IN (
                  SELECT i.product_id FROM sale_items i
                  WHERE i.user_id = p_salao AND i.sale_id = s.id
                    AND i.product_id IS NOT NULL
              )
        ), '[]'::jsonb),
        'atendimento', (
            SELECT to_jsonb(a.*) FROM appointments a
            WHERE a.user_id = p_salao AND a.id = s.appointment_id
        )
    )
    FROM sales s
    WHERE s.user_id = p_salao AND s.id = p_sale_id;
$$;

REVOKE ALL ON FUNCTION public.venda_em_json(uuid, text, boolean) FROM public;

-- ------------------------------------------------------------
-- 3. A unica porta por onde uma venda nasce
-- ------------------------------------------------------------
-- Formato esperado em p_venda (numeros com no maximo 2 casas):
--
--   {
--     "idempotencyKey": "...",            obrigatoria, unica por salao
--     "appointmentId": "appt-1" | null,
--     "clientId": "c1" | null,            null = venda de balcao
--     "professionalId": "p1" | null,      responsavel pela venda
--     "competenceDate": "2026-09-02",     dia da competencia (default: hoje)
--     "notes": "...",
--     "discountType": "amount"|"percent", "discountValue": 0,
--     "surchargeType": "amount"|"percent", "surchargeValue": 0,
--     "subtotalServices": 0, "subtotalProducts": 0, "subtotal": 0,
--     "discountAmount": 0, "surchargeAmount": 0, "total": 0,
--     "amountReceived": 0, "changeAmount": 0,
--     "items": [{
--        "itemType": "service"|"product",
--        "serviceId": "s1" | null, "productId": "pr1" | null,
--        "itemName": "Corte",            usado so quando o cadastro sumiu
--        "professionalId": "p1" | null,
--        "quantity": 1, "unitPrice": 50.00,
--        "grossAmount": 50.00, "discountAmount": 0, "surchargeAmount": 0,
--        "netAmount": 50.00
--     }],
--     "payments": [{
--        "paymentMethod": "pix"|"cash"|"debit_card"|"credit_card"|"other",
--        "amount": 50.00,
--        "cashReceived": 100.00 | null   somente para cash
--     }]
--   }
--
-- commission_rate e commission_base NAO vem do navegador: sao lidos do
-- cadastro do profissional no instante da venda e congelados no item. Mudar o
-- percentual amanha nao mexe na comissao de hoje.
CREATE OR REPLACE FUNCTION public.finalizar_venda(p_venda jsonb)
RETURNS jsonb
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
    -- --------------------------------------------------------
    -- 1. Contexto, papel e idempotencia
    -- --------------------------------------------------------
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.' USING ERRCODE = '42501';
    END IF;

    -- Decisao da Fase A: somente o dono conclui venda. Ampliar isso exige uma
    -- matriz de acesso explicita, nao um ajuste de tela.
    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietario pode concluir vendas nesta versao.'
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
    IF v_receber <> 0 THEN
        RAISE EXCEPTION 'Faltam % para fechar a venda. O crediario chega na Fase E.', v_receber;
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
        notes, idempotency_key, sold_at
    ) VALUES (
        v_sale_id, v_salao, v_numero, v_appt_id,
        v_cliente_id, v_cliente_nome, v_prof_id, v_prof_nome,
        v_origem, 'paid', v_sub_serv, v_sub_prod, v_subtotal,
        NULLIF(p_venda->>'discountType', ''), ROUND(COALESCE((p_venda->>'discountValue')::numeric, 0), 4), v_desconto,
        NULLIF(p_venda->>'surchargeType', ''), ROUND(COALESCE((p_venda->>'surchargeValue')::numeric, 0), 4), v_acrescimo,
        v_total, v_recebido, v_receber, v_troco,
        NULLIF(TRIM(COALESCE(p_venda->>'notes', '')), ''), v_chave, v_agora
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
    -- 9. O atendimento de origem
    -- --------------------------------------------------------
    -- Fica concluido e pago pela venda, sem passar pelo caminho antigo: o
    -- gatilho de 05-agenda.js nao roda aqui, entao nao ha lancamento duplicado.
    IF v_appt_id IS NOT NULL THEN
        UPDATE appointments
        SET status = 'done',
            "paymentStatus" = 'paid',
            "paymentMethod" = COALESCE(v_metodo_principal, "paymentMethod")
        WHERE id = v_appt_id AND user_id = v_salao;

        IF v_cliente_id IS NOT NULL THEN
            UPDATE clients
            SET "lastVisit" = to_char(v_competencia, 'YYYY-MM-DD')
            WHERE id = v_cliente_id AND user_id = v_salao
              AND (COALESCE("lastVisit", '') < to_char(v_competencia, 'YYYY-MM-DD'));
        END IF;
    END IF;

    RETURN public.venda_em_json(v_salao, v_sale_id, false);
END;
$$;

-- `anon` fica de fora: concluir venda e operacao de quem esta logado no painel.
REVOKE ALL ON FUNCTION public.finalizar_venda(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.finalizar_venda(jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA
-- ============================================================
--
-- As duas funcoes existem:
--
--   SELECT proname, pronargs, prosecdef
--   FROM pg_proc
--   WHERE proname IN ('finalizar_venda', 'venda_em_json')
--   ORDER BY proname;
--
-- finalizar_venda tem que aparecer com pronargs = 1 e prosecdef = true.
--
-- So `authenticated` executa a finalizacao:
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_routine_grants
--   WHERE routine_name = 'finalizar_venda';
--
-- Teste de ida e volta (roda como o dono do salao, no SQL Editor com a sessao
-- autenticada; repetir a MESMA chave tem que devolver "repetida": true e NAO
-- criar uma segunda venda):
--
--   SELECT public.finalizar_venda('{
--     "idempotencyKey": "teste-1",
--     "competenceDate": "2026-09-02",
--     "subtotalServices": 50, "subtotalProducts": 0, "subtotal": 50,
--     "discountAmount": 0, "surchargeAmount": 0, "total": 50,
--     "amountReceived": 50, "changeAmount": 0,
--     "items": [{"itemType":"service","serviceId":null,"itemName":"Corte",
--                "quantity":1,"unitPrice":50,"grossAmount":50,
--                "discountAmount":0,"surchargeAmount":0,"netAmount":50}],
--     "payments": [{"paymentMethod":"pix","amount":50}]
--   }'::jsonb);
--
--   SELECT sale_number, total, status FROM public.sales ORDER BY sale_number;
