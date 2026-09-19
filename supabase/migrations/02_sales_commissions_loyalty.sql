-- ============================================================
-- 02_SALES_COMMISSIONS_LOYALTY.SQL
-- Núcleo de Vendas, Comissões, Crediário e Fidelidade
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Cabecalho da Venda (sales)
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
    sold_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    origin              TEXT NOT NULL DEFAULT 'counter'
                        CHECK (origin IN ('appointment', 'counter', 'credit', 'legacy')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'partial', 'on_credit', 'cancelled', 'refunded')),
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
    CONSTRAINT sales_idempotency_per_salon UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sales_user ON public.sales (user_id);
CREATE INDEX IF NOT EXISTS idx_sales_sold_at ON public.sales (user_id, sold_at);

-- ------------------------------------------------------------
-- 2. Itens da Venda (sale_items)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_items (
    id                  TEXT PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_id             TEXT NOT NULL,
    item_type           TEXT NOT NULL CHECK (item_type IN ('service', 'product')),
    reference_id        TEXT NOT NULL,
    name                TEXT NOT NULL,
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    unit_price          NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    gross_total         NUMERIC(14,2) NOT NULL CHECK (gross_total >= 0),
    discount_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    surcharge_amount    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (surcharge_amount >= 0),
    net_total           NUMERIC(14,2) NOT NULL CHECK (net_total >= 0),
    professional_id     TEXT REFERENCES public.professionals(id) ON DELETE SET NULL,
    professional_name   TEXT,
    commission_rate     NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0),
    commission_base     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_base >= 0),
    commission_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (commission_amount >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sale_items_fk_sale FOREIGN KEY (user_id, sale_id)
        REFERENCES public.sales(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items (user_id, sale_id);

-- ------------------------------------------------------------
-- 3. Pagamentos da Venda (sale_payments)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_payments (
    id                  TEXT PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_id             TEXT NOT NULL,
    payment_method      TEXT NOT NULL,
    amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    cash_received       NUMERIC(14,2) CHECK (cash_received >= amount),
    change_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    installment_count   INTEGER NOT NULL DEFAULT 1 CHECK (installment_count > 0),
    transaction_id      TEXT,
    status              TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'refunded')),
    paid_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sale_payments_fk_sale FOREIGN KEY (user_id, sale_id)
        REFERENCES public.sales(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON public.sale_payments (user_id, sale_id);

-- ------------------------------------------------------------
-- 4. Comissões (sale_commissions)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_commissions (
    id                TEXT PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_id           TEXT NOT NULL,
    sale_item_id      TEXT NOT NULL UNIQUE,
    professional_id   TEXT NOT NULL,
    professional_name TEXT,
    service_id        TEXT,
    service_name      TEXT,
    gross_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    commission_base   NUMERIC(12,2) NOT NULL DEFAULT 0,
    rate              NUMERIC(7,4) NOT NULL DEFAULT 0,
    amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    paid_at           TIMESTAMPTZ,
    paid_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    payment_notes     TEXT,
    sold_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sale_commissions_fk_sale FOREIGN KEY (user_id, sale_id)
        REFERENCES public.sales(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commissions_user ON public.sale_commissions (user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_prof ON public.sale_commissions (user_id, professional_id);

-- Gatilho para gerar comissões a partir dos itens de serviço
CREATE OR REPLACE FUNCTION public.fn_gerar_comissao_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.item_type = 'service' AND NEW.professional_id IS NOT NULL AND NEW.commission_amount > 0 THEN
        INSERT INTO public.sale_commissions (
            id, user_id, sale_id, sale_item_id, professional_id, professional_name,
            service_id, service_name, gross_amount, discount_amount,
            commission_base, rate, amount, status, sold_at
        )
        VALUES (
            'com-' || NEW.id, NEW.user_id, NEW.sale_id, NEW.id, NEW.professional_id, NEW.professional_name,
            NEW.reference_id, NEW.name, NEW.gross_total, NEW.discount_amount,
            NEW.commission_base, NEW.commission_rate, NEW.commission_amount, 'pending', now()
        )
        ON CONFLICT (sale_item_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_comissao_item ON public.sale_items;
CREATE TRIGGER trg_gerar_comissao_item
AFTER INSERT ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_gerar_comissao_item();

-- ------------------------------------------------------------
-- 5. Crediário (receivables, installments, payments)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receivables (
    id            TEXT PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sale_id       TEXT NOT NULL UNIQUE,
    client_id     TEXT,
    client_name   TEXT,
    total_amount  NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
    paid_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    open_amount   NUMERIC(14,2) NOT NULL CHECK (open_amount >= 0),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
    opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.receivable_installments (
    id            TEXT PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receivable_id TEXT NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
    sale_id       TEXT NOT NULL,
    number        INTEGER NOT NULL CHECK (number > 0),
    due_date      DATE NOT NULL,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    paid_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    open_amount   NUMERIC(14,2) NOT NULL CHECK (open_amount >= 0),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
    settled_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_rec_inst_num UNIQUE (receivable_id, number)
);

CREATE TABLE IF NOT EXISTS public.receivable_payments (
    id             TEXT PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    receivable_id  TEXT NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
    installment_id TEXT NOT NULL REFERENCES public.receivable_installments(id) ON DELETE CASCADE,
    payment_method TEXT NOT NULL,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    cash_received  NUMERIC(14,2),
    change_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
    transaction_id TEXT,
    idempotency_key TEXT NOT NULL,
    paid_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_rec_pay_idemp UNIQUE (user_id, idempotency_key)
);

-- ------------------------------------------------------------
-- 6. Fidelidade (loyalty_programs, loyalty_movements)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_programs (
    id                      TEXT PRIMARY KEY,
    user_id                 UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    goal                    INTEGER NOT NULL DEFAULT 10,
    benefit_description     TEXT NOT NULL DEFAULT '1 serviço grátis',
    benefit_type            TEXT NOT NULL DEFAULT 'amount',
    benefit_value           NUMERIC(10, 2) DEFAULT 0,
    points_per_service      INTEGER NOT NULL DEFAULT 1,
    reward_message          TEXT,
    active                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.loyalty_movements (
    id                  TEXT PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id           TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'adjustment')),
    points              INTEGER NOT NULL,
    balance_after       INTEGER NOT NULL,
    sale_id             TEXT,
    sale_item_id        TEXT,
    reason              TEXT,
    idempotency_key     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_loyalty_idemp UNIQUE (user_id, idempotency_key)
);

-- ------------------------------------------------------------
-- 7. RLS para Vendas, Comissões, Crediário e Fidelidade
-- ------------------------------------------------------------
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_movements ENABLE ROW LEVEL SECURITY;

-- Equipe inteira pode ler vendas do salão
CREATE POLICY "Vendas: equipe le" ON public.sales FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Itens: equipe le" ON public.sale_items FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Pagamentos: equipe le" ON public.sale_payments FOR SELECT USING (user_id = public.salao_do_usuario());

-- Comissões: dono lê tudo, profissional lê as suas
CREATE POLICY "Comissoes: proprietario ou profissional" ON public.sale_commissions
    FOR SELECT USING (
        user_id = public.salao_do_usuario() AND (
            public.meu_papel() = 'owner' OR professional_id = public.meu_profissional()
        )
    );

-- Crediário: exclusivo do dono
CREATE POLICY "Crediario: proprietario le" ON public.receivables FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Parcelas: proprietario le" ON public.receivable_installments FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Rec_pagamentos: proprietario le" ON public.receivable_payments FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- Fidelidade: equipe lê, apenas dono altera programa
CREATE POLICY "Fidelidade: equipe le" ON public.loyalty_programs FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Fidelidade: dono edita" ON public.loyalty_programs FOR ALL USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Fidelidade_mov: equipe le" ON public.loyalty_movements FOR SELECT USING (user_id = public.salao_do_usuario());

COMMIT;
