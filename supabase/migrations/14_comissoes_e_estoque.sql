-- ============================================================================
-- 14 — BAIXA DE COMISSÃO E MOVIMENTO DE ESTOQUE
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Conferido em 05/10/2026, chamando pela API com os nomes exatos de parâmetro
-- que a tela usa: pagar_comissoes(p_ids, p_paga) e
-- registrar_movimento_estoque(p_id, p_product_id, ...) NÃO EXISTEM no banco do
-- SaaS (PGRST202). Era o "risco 3" do 01_PRODUTO_E_ESTADO: as duas só
-- existiam nos scripts da Alabama (docs/legacy_sql/21_comissoes.sql e
-- add_movimentacao_estoque.sql) e ficaram fora do 00_MASTER. Na prática:
--   - Comissões: "dar baixa" falhava sempre;
--   - Estoque: toda entrada/saída manual falhava no servidor e o app caía para
--     o plano B do estoque.js: regravar o CATÁLOGO INTEIRO de produtos com o
--     saldo calculado no navegador. O saldo chegava ao banco, mas duas pessoas
--     mexendo ao mesmo tempo apagavam o movimento uma da outra, o profissional
--     (sem escrita em products) não conseguia, e o histórico de movimentos
--     ficava só no navegador.
--
-- O QUE MUDA
--
--   1. stock_movements ganha as colunas que a tela (estoque.js) lê e que a
--      tabela do SaaS não tinha: "productName", "unitPrice", total,
--      "clientId", "appointmentId", "profId", "transactionId", note. A
--      quantidade continua em `quantity`; o api.js a expõe também como `qty`,
--      que é o nome que a tela usa.
--   2. registrar_movimento_estoque: a da Alabama, gravando nas colunas do
--      SaaS, e agora idempotente de verdade — a da Alabama mexia no saldo
--      ANTES do INSERT ... ON CONFLICT DO NOTHING, então repetir a chamada com
--      o mesmo id mexia no saldo duas vezes.
--   3. pagar_comissoes: a da Alabama, igual (as colunas de sale_commissions
--      do SaaS têm os mesmos nomes).
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

ALTER TABLE public.stock_movements
    ADD COLUMN IF NOT EXISTS "productName"   TEXT,
    ADD COLUMN IF NOT EXISTS "unitPrice"     NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total           NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "clientId"      TEXT,
    ADD COLUMN IF NOT EXISTS "appointmentId" TEXT,
    ADD COLUMN IF NOT EXISTS "profId"        TEXT,
    ADD COLUMN IF NOT EXISTS "transactionId" TEXT,
    ADD COLUMN IF NOT EXISTS note            TEXT;

-- ----------------------------------------------------------------------------
-- registrar_movimento_estoque
-- ----------------------------------------------------------------------------
-- Entrada e saída MANUAL de estoque (a venda baixa o estoque dentro da
-- finalizar_venda). O UPDATE é RELATIVO (stock + qtd): duas operações ao mesmo
-- tempo somam em vez de uma apagar a outra.
--
-- GREATEST(..., 0) mantém a regra da tela: tirar mais do que o sistema
-- registra zera o saldo em vez de deixar negativo.
CREATE OR REPLACE FUNCTION public.registrar_movimento_estoque(
    p_id             text,
    p_product_id     text,
    p_type           text,
    p_qty            integer,
    p_reason         text    DEFAULT 'ajuste',
    p_unit_price     numeric DEFAULT 0,
    p_client_id      text    DEFAULT NULL,
    p_appointment_id text    DEFAULT NULL,
    p_prof_id        text    DEFAULT NULL,
    p_transaction_id text    DEFAULT NULL,
    p_note           text    DEFAULT NULL,
    p_date           date    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao   uuid;
    v_nome    text;
    v_estoque integer;
BEGIN
    IF p_type IS NULL OR p_type NOT IN ('in', 'out') THEN
        RAISE EXCEPTION 'Tipo de movimento inválido: %', COALESCE(p_type, 'nulo');
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantidade precisa ser maior que zero.';
    END IF;
    IF NULLIF(TRIM(COALESCE(p_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Movimento sem identificador.';
    END IF;

    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salão vinculado.' USING ERRCODE = '42501';
    END IF;

    -- O produto tem que ser do salão de quem chamou: a função é SECURITY
    -- DEFINER e, sem isto, mexeria no estoque de qualquer salão. FOR UPDATE
    -- serializa duas chamadas com o mesmo id (duplo clique).
    SELECT name, stock INTO v_nome, v_estoque
    FROM products
    WHERE id = p_product_id AND user_id = v_salao
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado neste salão.';
    END IF;

    -- Repetição do mesmo movimento (rede que reenviou, duplo clique): devolve
    -- o saldo atual sem mexer de novo.
    IF EXISTS (SELECT 1 FROM stock_movements WHERE id = p_id AND user_id = v_salao) THEN
        RETURN jsonb_build_object('ok', true, 'stock', v_estoque, 'name', v_nome, 'repetido', true);
    END IF;

    UPDATE products
    SET stock = GREATEST(0, stock + CASE WHEN p_type = 'in' THEN p_qty ELSE -p_qty END)
    WHERE id = p_product_id AND user_id = v_salao
    RETURNING stock INTO v_estoque;

    INSERT INTO stock_movements (
        id, user_id, "productId", "productName", type, quantity, reason,
        "unitPrice", total, "clientId", "appointmentId", "profId",
        "transactionId", note, date
    ) VALUES (
        p_id, v_salao, p_product_id, v_nome, p_type, p_qty, COALESCE(NULLIF(p_reason, ''), 'ajuste'),
        COALESCE(p_unit_price, 0), ROUND(COALESCE(p_unit_price, 0) * p_qty, 2),
        NULLIF(p_client_id, ''), NULLIF(p_appointment_id, ''), NULLIF(p_prof_id, ''),
        NULLIF(p_transaction_id, ''), NULLIF(p_note, ''),
        -- date é TEXT no SaaS ('YYYY-MM-DD'), como o resto do app grava.
        to_char(COALESCE(p_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date), 'YYYY-MM-DD')
    );

    RETURN jsonb_build_object('ok', true, 'stock', v_estoque, 'name', v_nome);
END;
$$;

-- Os dois caminhos pelos quais uma função nova chega a anon (o grant a PUBLIC
-- e o default privilege nominal do Supabase) — por isso os dois revokes.
REVOKE ALL ON FUNCTION public.registrar_movimento_estoque(
    text, text, text, integer, text, numeric, text, text, text, text, text, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_movimento_estoque(
    text, text, text, integer, text, numeric, text, text, text, text, text, date
) TO authenticated;

-- ----------------------------------------------------------------------------
-- pagar_comissoes
-- ----------------------------------------------------------------------------
-- Dá baixa (ou desfaz) numa lista de comissões, numa chamada só: pagar é um
-- ato único do fim da semana, e uma chamada por linha deixaria metade marcada
-- se a conexão caísse no meio.
CREATE OR REPLACE FUNCTION public.pagar_comissoes(p_ids text[], p_paga boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao    uuid;
    v_afetadas integer;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salão vinculado.' USING ERRCODE = '42501';
    END IF;

    -- Só o dono paga. A conferência é aqui, e não na tela: a função ignora a
    -- RLS, e sem esta linha um profissional marcaria as próprias comissões
    -- como pagas.
    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietário pode dar baixa em comissão.' USING ERRCODE = '42501';
    END IF;

    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'atualizadas', 0, 'paga', p_paga);
    END IF;

    -- Comissão cancelada (venda estornada) não volta a ser paga nem pendente.
    UPDATE sale_commissions
    SET status  = CASE WHEN p_paga THEN 'paid' ELSE 'pending' END,
        paid_at = CASE WHEN p_paga THEN now() END,
        paid_by = CASE WHEN p_paga THEN auth.uid() END
    WHERE user_id = v_salao
      AND id = ANY(p_ids)
      AND status <> 'cancelled';

    GET DIAGNOSTICS v_afetadas = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'atualizadas', v_afetadas, 'paga', p_paga);
END;
$$;

REVOKE ALL ON FUNCTION public.pagar_comissoes(text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_comissoes(text[], boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA (as quatro linhas têm que vir com ok = true)
-- ============================================================================
SELECT 'registrar_movimento_estoque existe' AS conferencia,
       to_regprocedure('public.registrar_movimento_estoque(text, text, text, integer, text, numeric, text, text, text, text, text, date)') IS NOT NULL AS ok
UNION ALL
SELECT 'pagar_comissoes existe',
       to_regprocedure('public.pagar_comissoes(text[], boolean)') IS NOT NULL
UNION ALL
SELECT 'anon nao executa nenhuma das duas',
       NOT has_function_privilege('anon', 'public.pagar_comissoes(text[], boolean)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.registrar_movimento_estoque(text, text, text, integer, text, numeric, text, text, text, text, text, date)', 'EXECUTE')
UNION ALL
SELECT 'stock_movements tem as colunas da tela',
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stock_movements'
          AND column_name IN ('productName', 'unitPrice', 'total', 'clientId',
                              'appointmentId', 'profId', 'transactionId', 'note')) = 8;
