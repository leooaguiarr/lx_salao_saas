-- ============================================================
-- PRODUTOS E ESTOQUE
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE FALTAVA
--
-- O Financeiro já oferecia a categoria "Venda de Produto", mas ela era órfã:
-- não havia produto nenhum por trás. O valor era digitado à mão, nada baixava
-- de lugar nenhum e não havia como saber que a pomada acabou.
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. Cria a tabela products (catálogo + estoque).
--   2. Cria get_public_products(), a vitrine que o cliente vê no link.
--
-- ⚠️ Este script NÃO recria get_public_salon nem get_public_queue. A vitrine é
-- um RPC separado de propósito: script que recria função definida em outro
-- arquivo foi o que já derrubou o link público uma vez — o GRANT ficou com a
-- assinatura errada e o erro 42883 abortou a transação inteira sem ninguém
-- perceber. Função nova, arquivo novo, sem tocar no que já funciona.

-- ------------------------------------------------------------
-- 1. Tabela
-- ------------------------------------------------------------
-- Mesmo formato de services: id TEXT gerado pelo app, user_id é o SALÃO dono
-- do registro (ver docs/multi_login_por_salao.sql).
CREATE TABLE IF NOT EXISTS public.products (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    -- Livre de propósito: "Geladeira", "Cabelo", "Barba", "Estética".
    -- Vira o agrupamento da vitrine, e cada salão organiza do seu jeito.
    category    TEXT,
    price       NUMERIC NOT NULL DEFAULT 0,
    stock       INTEGER NOT NULL DEFAULT 0,
    -- Abaixo disto o painel avisa. 0 desliga o aviso para aquele item.
    "minStock"  INTEGER NOT NULL DEFAULT 0,
    "photoUrl"  TEXT,
    active      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Migração: quem já criou a tabela numa versão anterior ganha as colunas novas.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category   TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "minStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

CREATE INDEX IF NOT EXISTS idx_products_salao ON public.products (user_id, active);

-- ------------------------------------------------------------
-- 2. RLS: acesso por salão
-- ------------------------------------------------------------
-- Mesma regra de services: o profissional ('staff') lê — precisa para vender —
-- mas quem cadastra e ajusta estoque é o dono.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso por salao" ON public.products;
CREATE POLICY "Acesso por salao" ON public.products
    FOR ALL
    USING (user_id = public.salao_do_usuario())
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 3. A vitrine que o cliente vê
-- ------------------------------------------------------------
-- Devolve só o que está à venda AGORA: ativo e com estoque.
--
-- ⚠️ NÃO devolve a quantidade. Quanto tem em estoque é informação do negócio,
-- e a página é pública. O cliente precisa saber que existe e quanto custa —
-- o resto é conversa de balcão.
--
-- Produto esgotado simplesmente não aparece: anunciar o que acabou só gera
-- frustração na hora de pedir.
CREATE OR REPLACE FUNCTION get_public_products(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'name', p.name,
                   'category', p.category,
                   'price', p.price,
                   'photoUrl', p."photoUrl"
               ) ORDER BY p.category NULLS LAST, p.name)
        FROM products p
        WHERE p.user_id = v_user_id
          AND p.active
          AND p.stock > 0
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION get_public_products(text) FROM public;
GRANT EXECUTE ON FUNCTION get_public_products(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
-- Sem isso a tabela e a função novas só ficam visíveis para a API depois de
-- alguns minutos (ou de um restart do projeto).
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- A tabela existe com RLS ligada:
--
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'products';
--
-- A vitrine responde (troque pelo slug real do salão):
--
--   SELECT get_public_products('agendamento');
--
-- Tem que devolver [] num salão sem produto, e a lista sem o campo de
-- quantidade depois de cadastrar. Se aparecer `stock` no retorno, alguém
-- alterou a função — a quantidade não deve sair daqui.
