-- ============================================================
-- MOVIMENTAÇÃO DE ESTOQUE
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE FALTAVA
--
-- O script 12 criou o catálogo com uma coluna `stock`, e o Financeiro baixava
-- essa coluna direto. Dois problemas apareceram com o uso:
--
--   1. NÃO HAVIA HISTÓRICO. O número mudava e ninguém sabia por quê. Chegou
--      mercadoria? Vendeu? Quebrou? Alguém errou a digitação? Estoque sem
--      extrato é um saldo que ninguém consegue defender.
--
--   2. GRAVAR ERA UM UPSERT DO CATÁLOGO INTEIRO. Se duas pessoas vendessem ao
--      mesmo tempo — o dono no balcão e o profissional no celular — a última
--      gravação sobrescrevia a outra, e uma das vendas sumia do estoque.
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. Cria stock_movements: o extrato do estoque, uma linha por entrada e por
--      saída, com o motivo e com o vínculo de quem comprou.
--   2. Cria registrar_movimento_estoque(): a ÚNICA porta por onde a quantidade
--      muda. Faz o UPDATE relativo (`stock - qtd`, não `stock = número`) e
--      grava o extrato na mesma transação.
--   3. Acrescenta em transactions as colunas que o app já vinha mandando sem
--      que existissem — ver a seção 0.
--
-- ⚠️ Este script NÃO recria products, get_public_products, get_public_salon nem
-- get_public_queue. Script que recria função definida em outro arquivo já
-- derrubou o link público uma vez: o GRANT ficou com a assinatura errada e o
-- erro 42883 abortou a transação inteira sem ninguém perceber.

-- ------------------------------------------------------------
-- 0. Conserto: colunas que o app mandava e a tabela não tinha
-- ------------------------------------------------------------
-- A venda de produto no Financeiro grava em cada lançamento QUAL produto saiu.
-- Essas colunas nunca foram criadas, e o PostgREST recusa a linha inteira
-- quando recebe campo que não existe: a venda aparecia na tela, sumia no
-- refresh e o dinheiro ficava só no navegador de quem lançou.
--
-- "clientId" e "appointmentId" são as duas colunas novas, e são elas que
-- respondem a pergunta que motivou este script: produto vende mais para quem
-- agenda ou para quem entra só para comprar?
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS "productId"     TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS "productQty"    INTEGER;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS "clientId"      TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;

-- ------------------------------------------------------------
-- 1. O extrato
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "productId"     TEXT NOT NULL,
    -- Nome copiado na hora do movimento. O produto pode ser excluído do
    -- catálogo depois, e o extrato de dezembro não pode virar uma lista de
    -- linhas sem nome.
    "productName"   TEXT,
    -- 'in'  = entrou mercadoria (compra, devolução, acerto para cima)
    -- 'out' = saiu (venda, perda, uso interno, acerto para baixo)
    type            TEXT NOT NULL CHECK (type IN ('in', 'out')),
    qty             INTEGER NOT NULL CHECK (qty > 0),
    -- 'compra', 'devolucao', 'ajuste', 'venda', 'perda', 'uso_interno'
    reason          TEXT NOT NULL DEFAULT 'ajuste',
    "unitPrice"     NUMERIC DEFAULT 0,
    total           NUMERIC DEFAULT 0,
    -- Quem levou. É isto que responde se produto vende mais para quem agenda
    -- ou para quem entra só para comprar.
    "clientId"      TEXT,
    -- Preenchido quando a venda saiu junto com um atendimento.
    "appointmentId" TEXT,
    "profId"        TEXT,
    -- Amarra o movimento ao lançamento do Financeiro, quando houve dinheiro.
    "transactionId" TEXT,
    note            TEXT,
    date            DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_mov_salao   ON public.stock_movements (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_mov_produto ON public.stock_movements (user_id, "productId");

-- ------------------------------------------------------------
-- 2. RLS: acesso por salão
-- ------------------------------------------------------------
-- Aqui o profissional ESCREVE, diferente de products. Quem vende a cerveja é
-- quem está no balcão, e travar isso no dono faria a venda não ser registrada —
-- que é exatamente o buraco que este script existe para fechar.
--
-- Apagar movimento ninguém pode: extrato que se apaga não é extrato. O acerto
-- de um lançamento errado é um movimento no sentido contrário, com o motivo
-- escrito, e é assim que se enxerga quem está errando a digitação.
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura por salao"  ON public.stock_movements;
DROP POLICY IF EXISTS "Escrita por salao"  ON public.stock_movements;

CREATE POLICY "Leitura por salao" ON public.stock_movements
    FOR SELECT
    USING (user_id = public.salao_do_usuario());

CREATE POLICY "Escrita por salao" ON public.stock_movements
    FOR INSERT
    WITH CHECK (user_id = public.salao_do_usuario());

-- ------------------------------------------------------------
-- 3. A única porta por onde o estoque muda
-- ------------------------------------------------------------
-- SECURITY DEFINER por dois motivos:
--
--   a) products só aceita escrita do dono (política do script 12), e o
--      profissional precisa poder vender. A função confere o vínculo com o
--      salão por conta própria, então a permissão continua sendo verificada —
--      só não passa mais pela política de products.
--
--   b) o UPDATE é RELATIVO: `stock = stock - qtd`. O app não manda o número
--      final, manda quanto saiu. Duas vendas simultâneas somam em vez de uma
--      apagar a outra.
--
-- GREATEST(...,0) mantém a regra que já valia na tela: vender mais do que o
-- sistema registra zera o saldo em vez de deixar negativo. Estoque do sistema
-- atrás do real é erro de inventário, e travar a venda por causa dele deixaria
-- o cliente esperando no balcão.
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
    IF p_type NOT IN ('in', 'out') THEN
        RAISE EXCEPTION 'Tipo de movimento invalido: %', p_type;
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantidade precisa ser maior que zero';
    END IF;

    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado';
    END IF;

    -- O produto tem que ser do salão de quem chamou. Sem isto, a função
    -- SECURITY DEFINER mexeria no estoque de qualquer barbearia.
    SELECT name INTO v_nome
    FROM products
    WHERE id = p_product_id AND user_id = v_salao;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto nao encontrado neste salao';
    END IF;

    UPDATE products
    SET stock = GREATEST(0, stock + CASE WHEN p_type = 'in' THEN p_qty ELSE -p_qty END)
    WHERE id = p_product_id AND user_id = v_salao
    RETURNING stock INTO v_estoque;

    INSERT INTO stock_movements (
        id, user_id, "productId", "productName", type, qty, reason,
        "unitPrice", total, "clientId", "appointmentId", "profId",
        "transactionId", note, date
    ) VALUES (
        p_id, v_salao, p_product_id, v_nome, p_type, p_qty, COALESCE(p_reason, 'ajuste'),
        COALESCE(p_unit_price, 0), COALESCE(p_unit_price, 0) * p_qty,
        NULLIF(p_client_id, ''), NULLIF(p_appointment_id, ''), NULLIF(p_prof_id, ''),
        NULLIF(p_transaction_id, ''), NULLIF(p_note, ''), COALESCE(p_date, CURRENT_DATE)
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN jsonb_build_object('ok', true, 'stock', v_estoque, 'name', v_nome);
END;
$$;

-- `anon` fica de fora: movimentar estoque é operação de quem está logado no
-- painel. A vitrine pública continua sendo get_public_products(), que só lê.
REVOKE ALL ON FUNCTION public.registrar_movimento_estoque(
    text, text, text, integer, text, numeric, text, text, text, text, text, date
) FROM public;
GRANT EXECUTE ON FUNCTION public.registrar_movimento_estoque(
    text, text, text, integer, text, numeric, text, text, text, text, text, date
) TO authenticated;

-- ------------------------------------------------------------
-- 4. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- As colunas do conserto entraram:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'transactions'
--     AND column_name IN ('productId','productQty','clientId','appointmentId');
--
-- Tem que devolver as 4.
--
-- A tabela existe com RLS ligada:
--
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'stock_movements';
--
-- A função existe com os 12 parâmetros (assinatura incompleta aborta o GRANT
-- e o script inteiro, sem quebrar nada visível — o erro só aparece na primeira
-- venda):
--
--   SELECT proname, pronargs
--   FROM pg_proc WHERE proname = 'registrar_movimento_estoque';
--
-- Tem que devolver pronargs = 12.
