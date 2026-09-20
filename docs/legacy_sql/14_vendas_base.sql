-- ============================================================
-- FASE A — NUCLEO DE VENDAS
-- Execute depois de 13_movimentacao_de_estoque.sql.
-- Pode rodar mais de uma vez sem apagar ou regravar dados.
-- ============================================================
--
-- Esta migration cria apenas a fundacao e a leitura. A escrita direta fica
-- fechada: a Fase B criara uma RPC SECURITY DEFINER que valida e grava venda,
-- itens, pagamentos, financeiro, estoque e atendimento numa transacao unica.

BEGIN;

-- ------------------------------------------------------------
-- 1. Cabecalho da venda
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales (
    id                  TEXT PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_number         BIGINT NOT NULL,
    appointment_id      TEXT REFERENCES public.appointments(id) ON DELETE RESTRICT,
    client_id           TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
    client_name         TEXT,
    professional_id     TEXT REFERENCES public.professionals(id) ON DELETE SET NULL,
    professional_name   TEXT,
    origin              TEXT NOT NULL DEFAULT 'counter'
                        CHECK (origin IN ('appointment', 'counter', 'credit', 'legacy')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'partial', 'on_credit',
                                          'cancelled', 'refunded')),
    currency            CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
    subtotal_services   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal_services >= 0),
    subtotal_products   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal_products >= 0),
    subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_type       TEXT CHECK (discount_type IS NULL OR discount_type IN ('amount', 'percent')),
    discount_value      NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
    discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    surcharge_type      TEXT CHECK (surcharge_type IS NULL OR surcharge_type IN ('amount', 'percent')),
    surcharge_value     NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (surcharge_value >= 0),
    surcharge_amount    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (surcharge_amount >= 0),
    total               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    amount_received     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
    amount_receivable   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_receivable >= 0),
    change_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    notes               TEXT,
    idempotency_key     TEXT NOT NULL,
    created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    sold_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sales_id_with_salon UNIQUE (user_id, id),
    CONSTRAINT sales_number_per_salon UNIQUE (user_id, sale_number),
    CONSTRAINT sales_idempotency_per_salon UNIQUE (user_id, idempotency_key),
    CONSTRAINT sales_subtotal_parts CHECK (subtotal = subtotal_services + subtotal_products),
    CONSTRAINT sales_discount_limit CHECK (discount_amount <= subtotal),
    CONSTRAINT sales_total_equation CHECK (total = subtotal - discount_amount + surcharge_amount),
    CONSTRAINT sales_settlement_equation CHECK (amount_received + amount_receivable = total)
);

COMMENT ON TABLE public.sales IS
    'Evento principal da venda. Escrita somente pelas RPCs transacionais da arquitetura de Vendas.';
COMMENT ON COLUMN public.sales.sale_number IS
    'Numero sequencial por salao, alocado sob lock pela RPC de finalizacao.';
COMMENT ON COLUMN public.sales.idempotency_key IS
    'Chave unica por salao para repetir requisicoes sem duplicar a venda.';

-- Um atendimento pode ter no maximo uma venda que ainda seja valida.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_valid_appointment
    ON public.sales (user_id, appointment_id)
    WHERE appointment_id IS NOT NULL
      AND status NOT IN ('cancelled', 'refunded');

CREATE INDEX IF NOT EXISTS idx_sales_salon_date
    ON public.sales (user_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_salon_client
    ON public.sales (user_id, client_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_salon_professional
    ON public.sales (user_id, professional_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_salon_status
    ON public.sales (user_id, status, sold_at DESC);

-- ------------------------------------------------------------
-- 2. Itens imutaveis da venda
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_items (
    id                  TEXT PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_id             TEXT NOT NULL,
    item_type           TEXT NOT NULL CHECK (item_type IN ('service', 'product')),
    service_id          TEXT REFERENCES public.services(id) ON DELETE SET NULL,
    product_id          TEXT REFERENCES public.products(id) ON DELETE SET NULL,
    item_name           TEXT NOT NULL,
    professional_id     TEXT REFERENCES public.professionals(id) ON DELETE SET NULL,
    professional_name   TEXT,
    quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    gross_amount        NUMERIC(14,2) NOT NULL CHECK (gross_amount >= 0),
    discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    surcharge_amount    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (surcharge_amount >= 0),
    net_amount          NUMERIC(14,2) NOT NULL CHECK (net_amount >= 0),
    commission_rate     NUMERIC(7,4) NOT NULL DEFAULT 0
                        CHECK (commission_rate >= 0 AND commission_rate <= 100),
    commission_base     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_base >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sale_items_sale_same_salon
        FOREIGN KEY (user_id, sale_id) REFERENCES public.sales(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT sale_items_catalog_kind CHECK (
        (item_type = 'service' AND product_id IS NULL)
        OR (item_type = 'product' AND service_id IS NULL)
    ),
    CONSTRAINT sale_items_gross_equation CHECK (gross_amount = unit_price * quantity),
    CONSTRAINT sale_items_net_equation CHECK (
        net_amount = gross_amount - discount_amount + surcharge_amount
    ),
    CONSTRAINT sale_items_discount_limit CHECK (discount_amount <= gross_amount),
    CONSTRAINT sale_items_commission_limit CHECK (commission_base <= net_amount),
    CONSTRAINT sale_items_product_without_commission CHECK (
        item_type = 'service' OR (commission_rate = 0 AND commission_base = 0)
    )
);

COMMENT ON TABLE public.sale_items IS
    'Snapshots dos servicos e produtos vendidos. Nao dependem do preco atual do cadastro.';

CREATE INDEX IF NOT EXISTS idx_sale_items_sale
    ON public.sale_items (user_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_professional
    ON public.sale_items (user_id, professional_id, created_at DESC);

-- ------------------------------------------------------------
-- 3. Pagamentos efetivamente recebidos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_payments (
    id                  TEXT PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_id             TEXT NOT NULL,
    payment_method      TEXT NOT NULL
                        CHECK (payment_method IN ('pix', 'cash', 'debit_card',
                                                  'credit_card', 'other')),
    amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    cash_received       NUMERIC(14,2) CHECK (cash_received IS NULL OR cash_received >= amount),
    change_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    status              TEXT NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('pending', 'completed', 'cancelled', 'refunded')),
    cash_register_id    TEXT REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
    note                TEXT,
    paid_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sale_payments_id_with_salon UNIQUE (user_id, id),
    CONSTRAINT sale_payments_sale_same_salon
        FOREIGN KEY (user_id, sale_id) REFERENCES public.sales(user_id, id) ON DELETE RESTRICT,
    CONSTRAINT sale_payments_cash_fields CHECK (
        payment_method = 'cash'
        OR (cash_received IS NULL AND change_amount = 0)
    )
);

COMMENT ON TABLE public.sale_payments IS
    'Valores realmente recebidos. Crediario so entra aqui quando uma parcela for paga.';

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale
    ON public.sale_payments (user_id, sale_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_sale_payments_method
    ON public.sale_payments (user_id, payment_method, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_payments_cash_register
    ON public.sale_payments (user_id, cash_register_id)
    WHERE cash_register_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Vinculos opcionais no razao financeiro existente
-- ------------------------------------------------------------
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sale_id          TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sale_payment_id  TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cash_register_id TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source           TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_sale_id_fkey') THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_sale_id_fkey
            FOREIGN KEY (user_id, sale_id)
            REFERENCES public.sales(user_id, id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_sale_payment_id_fkey') THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_sale_payment_id_fkey
            FOREIGN KEY (user_id, sale_payment_id)
            REFERENCES public.sale_payments(user_id, id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_cash_register_id_fkey') THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_cash_register_id_fkey
            FOREIGN KEY (cash_register_id) REFERENCES public.cash_registers(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_source_check') THEN
        ALTER TABLE public.transactions
            ADD CONSTRAINT transactions_source_check
            CHECK (source IS NULL OR source IN (
                'manual', 'appointment', 'stock', 'sale', 'credit', 'legacy'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_sale
    ON public.transactions (user_id, sale_id)
    WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_cash_register
    ON public.transactions (user_id, cash_register_id)
    WHERE cash_register_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_sale_payment
    ON public.transactions (user_id, sale_payment_id)
    WHERE sale_payment_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. updated_at automatico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atualizar_venda_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_updated_at ON public.sales;
CREATE TRIGGER trg_sales_updated_at
    BEFORE UPDATE ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.atualizar_venda_updated_at();

-- ------------------------------------------------------------
-- 6. RLS: Fase A e somente leitura para o proprietario
-- ------------------------------------------------------------
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendas: proprietario le" ON public.sales;
DROP POLICY IF EXISTS "Itens de venda: proprietario le" ON public.sale_items;
DROP POLICY IF EXISTS "Pagamentos de venda: proprietario le" ON public.sale_payments;

CREATE POLICY "Vendas: proprietario le" ON public.sales
    FOR SELECT
    USING (
        user_id = public.salao_do_usuario()
        AND public.meu_papel() = 'owner'
    );

CREATE POLICY "Itens de venda: proprietario le" ON public.sale_items
    FOR SELECT
    USING (
        user_id = public.salao_do_usuario()
        AND public.meu_papel() = 'owner'
    );

CREATE POLICY "Pagamentos de venda: proprietario le" ON public.sale_payments
    FOR SELECT
    USING (
        user_id = public.salao_do_usuario()
        AND public.meu_papel() = 'owner'
    );

-- Nenhuma tabela nova aceita escrita direta do navegador. A Fase B fara a
-- escrita exclusivamente pela RPC, que repetira todas as validacoes.
REVOKE ALL ON TABLE public.sales, public.sale_items, public.sale_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.sales, public.sale_items, public.sale_payments
    FROM authenticated;
GRANT SELECT ON TABLE public.sales, public.sale_items, public.sale_payments
    TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA (deve devolver tres tabelas, RLS ligada e 3 policies)
-- ============================================================
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relname IN ('sales', 'sale_items', 'sale_payments')
-- ORDER BY relname;
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE tablename IN ('sales', 'sale_items', 'sale_payments')
-- ORDER BY tablename, policyname;
--
-- SELECT indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--       'uq_sales_valid_appointment',
--       'uq_transactions_sale_payment'
--   );
