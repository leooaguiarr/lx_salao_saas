-- ============================================================
-- MASTER SCHEMA: LEXION SALÃO SAAS (COOLIFY SUPABASE)
-- Execute este arquivo no SQL Editor do Supabase no Coolify
-- ============================================================


-- >>> INICIO: supabase\migrations\01_saas_multi_tenant_base.sql <<<

-- ============================================================
-- 01_SAAS_MULTI_TENANT_BASE.SQL
-- Fundação Multi-Tenant & SaaS para Supabase Self-Hosted (Coolify)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 1. Tabela de Planos do SaaS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    price               NUMERIC(10, 2) NOT NULL,
    max_professionals   INTEGER NOT NULL DEFAULT 1,
    has_inventory       BOOLEAN NOT NULL DEFAULT false,
    has_loyalty         BOOLEAN NOT NULL DEFAULT false,
    has_credit          BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- Popula os 3 planos padrão do sistema
INSERT INTO public.plans (id, name, price, max_professionals, has_inventory, has_loyalty, has_credit)
VALUES
    ('individual', 'Plano Solo / Individual', 59.90, 1, false, false, false),
    ('equipe_4',   'Plano Equipe (Até 4)',   119.90, 4, true, false, false),
    ('ilimitado',  'Plano Ilimitado',        199.90, 9999, true, true, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    max_professionals = EXCLUDED.max_professionals,
    has_inventory = EXCLUDED.has_inventory,
    has_loyalty = EXCLUDED.has_loyalty,
    has_credit = EXCLUDED.has_credit;

-- ------------------------------------------------------------
-- 2. Tabela business_info (Estabelecimentos / Salões)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_info (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    slug                    TEXT NOT NULL UNIQUE,
    phone                   TEXT,
    instagram               TEXT,
    address                 TEXT,
    hours                   JSONB,
    "avatarUrl"             TEXT,
    "bannerUrl"             TEXT,
    -- Multi-Nicho & Customização Visual
    business_type           TEXT NOT NULL DEFAULT 'barbearia' CHECK (business_type IN ('barbearia', 'salao', 'estetica')),
    primary_color           TEXT NOT NULL DEFAULT '#d4af37',
    secondary_color         TEXT NOT NULL DEFAULT '#18181b',
    -- Assinatura e Planos
    plan_id                 TEXT NOT NULL DEFAULT 'individual' REFERENCES public.plans(id),
    status                  TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'canceled')),
    trial_ends_at           TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
    asaas_customer_id       TEXT,
    asaas_subscription_id   TEXT,
    -- Mensagens Customizadas
    "whatsappRecallMessage"   TEXT,
    "whatsappBookingMessage"  TEXT,
    "whatsappBirthdayMessage" TEXT,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_info_slug ON public.business_info (slug);
CREATE INDEX IF NOT EXISTS idx_business_info_user_id ON public.business_info (user_id);

-- ------------------------------------------------------------
-- 3. Tabela salon_members (Membros e Permissões do Estabelecimento)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.salon_members (
    user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    salon_id         UUID NOT NULL,
    role             TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff', 'admin')),
    professional_id  TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salon_members_salon ON public.salon_members (salon_id);

-- ------------------------------------------------------------
-- 4. Funções de Contexto e RLS (Security Definer)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salao_do_usuario()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT salon_id FROM public.salon_members WHERE user_id = auth.uid()),
        auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION public.salao_do_usuario() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.meu_papel()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT role FROM public.salon_members WHERE user_id = auth.uid()),
        'owner'
    );
$$;

GRANT EXECUTE ON FUNCTION public.meu_papel() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.meu_profissional()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT professional_id FROM public.salon_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.meu_profissional() TO authenticated, anon;

-- ------------------------------------------------------------
-- 5. Tabelas Operacionais do Salão
-- ------------------------------------------------------------

-- Serviços
CREATE TABLE IF NOT EXISTS public.services (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    price           NUMERIC(10, 2) NOT NULL,
    duration        INTEGER NOT NULL,
    active          BOOLEAN DEFAULT TRUE,
    category        TEXT,
    "packageCredits" INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_services_user ON public.services (user_id);

-- Profissionais / Equipe
CREATE TABLE IF NOT EXISTS public.professionals (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    active          BOOLEAN DEFAULT TRUE,
    "photoUrl"      TEXT,
    commission      NUMERIC(5, 2) DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_professionals_user ON public.professionals (user_id);

-- Clientes
CREATE TABLE IF NOT EXISTS public.clients (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phone           TEXT,
    instagram       TEXT,
    birth           TEXT,
    frequency       INTEGER,
    "lastVisit"     TEXT,
    notes           TEXT,
    status          TEXT,
    active          BOOLEAN DEFAULT TRUE,
    "photoUrl"      TEXT,
    "loyaltyEnrolled" BOOLEAN DEFAULT TRUE,
    "loyaltyPoints"   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_user ON public.clients (user_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients (user_id, phone);

-- Agendamentos
CREATE TABLE IF NOT EXISTS public.appointments (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "clientId"      TEXT,
    "serviceId"     TEXT,
    "profId"        TEXT,
    date            TEXT NOT NULL,
    time            TEXT NOT NULL,
    status          TEXT,
    "paymentStatus" TEXT,
    "paymentMethod" TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON public.appointments (user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments (user_id, date);

-- Bloqueios de Agenda dos Profissionais
CREATE TABLE IF NOT EXISTS public.professional_blocks (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "profId"        TEXT NOT NULL,
    date            TEXT NOT NULL,
    "startTime"     TEXT NOT NULL,
    "endTime"       TEXT NOT NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blocks_user ON public.professional_blocks (user_id);

-- Leads (Kanban)
CREATE TABLE IF NOT EXISTS public.leads (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phone           TEXT,
    source          TEXT,
    stage           TEXT,
    notes           TEXT,
    date            TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_user ON public.leads (user_id);

-- Transações Financeiras (Livro Caixa Rápido)
CREATE TABLE IF NOT EXISTS public.transactions (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount          NUMERIC(14, 2) NOT NULL,
    date            TEXT NOT NULL,
    description     TEXT,
    category        TEXT,
    "paymentMethod" TEXT,
    "productId"     TEXT,
    "clientId"      TEXT,
    professional_id TEXT,
    appointment_id  TEXT,
    sale_id         TEXT,
    sale_payment_id TEXT,
    cash_register_id TEXT,
    source          TEXT DEFAULT 'manual',
    status          TEXT DEFAULT 'completed',
    "registradoEm"  TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_sale ON public.transactions (user_id, sale_id);

-- Abertura e Fechamento de Caixa
CREATE TABLE IF NOT EXISTS public.cash_registers (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "dateOpened"    TEXT NOT NULL,
    "dateClosed"    TEXT,
    "initialCash"   NUMERIC(14, 2) DEFAULT 0,
    "finalCash"     NUMERIC(14, 2) DEFAULT 0,
    "expectedCash"  NUMERIC(14, 2),
    "countedCash"   NUMERIC(14, 2),
    "cashDifference" NUMERIC(14, 2),
    "closingNote"   TEXT,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_registers_user ON public.cash_registers (user_id);

-- Produtos e Estoque
CREATE TABLE IF NOT EXISTS public.products (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    price           NUMERIC(10, 2) NOT NULL,
    cost            NUMERIC(10, 2) DEFAULT 0,
    stock           INTEGER NOT NULL DEFAULT 0,
    "minStock"      INTEGER NOT NULL DEFAULT 0,
    active          BOOLEAN DEFAULT TRUE,
    category        TEXT,
    "photoUrl"      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_user ON public.products (user_id);

-- Movimentações de Estoque
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "productId"     TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjustment')),
    quantity        INTEGER NOT NULL,
    reason          TEXT,
    date            TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user ON public.stock_movements (user_id);

-- ------------------------------------------------------------
-- 6. Habilitação de Row Level Security (RLS)
-- ------------------------------------------------------------
ALTER TABLE public.business_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Políticas de Isolamento por Salão
DO $$
DECLARE
    t text;
    tabelas text[] := ARRAY[
        'business_info', 'services', 'professionals', 'clients',
        'appointments', 'professional_blocks', 'leads', 'transactions',
        'cash_registers', 'products', 'stock_movements'
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Isolamento por salao" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Isolamento por salao" ON public.%I FOR ALL USING (user_id = public.salao_do_usuario())', t);
    END LOOP;
END $$;

-- salon_members: Usuário só vê o próprio vínculo
DROP POLICY IF EXISTS "Ver proprio vinculo" ON public.salon_members;
CREATE POLICY "Ver proprio vinculo" ON public.salon_members FOR SELECT USING (user_id = auth.uid());

-- Leitura pública para agendamento (anon)
DROP POLICY IF EXISTS "Agendamento: ler estabelecimento ativo" ON public.business_info;
CREATE POLICY "Agendamento: ler estabelecimento ativo" ON public.business_info FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Agendamento: ler servicos ativos" ON public.services;
CREATE POLICY "Agendamento: ler servicos ativos" ON public.services FOR SELECT TO anon USING (active = true);

DROP POLICY IF EXISTS "Agendamento: ler profissionais ativos" ON public.professionals;
CREATE POLICY "Agendamento: ler profissionais ativos" ON public.professionals FOR SELECT TO anon USING (active = true);

DROP POLICY IF EXISTS "Agendamento: criar agendamento anonimo" ON public.appointments;
CREATE POLICY "Agendamento: criar agendamento anonimo" ON public.appointments FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Agendamento: ler horarios ocupados" ON public.appointments;
CREATE POLICY "Agendamento: ler horarios ocupados" ON public.appointments FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Agendamento: ler bloqueios" ON public.professional_blocks;
CREATE POLICY "Agendamento: ler bloqueios" ON public.professional_blocks FOR SELECT TO anon USING (true);


-- >>> FIM: supabase\migrations\01_saas_multi_tenant_base.sql <<<


-- >>> INICIO: supabase\migrations\02_sales_commissions_loyalty.sql <<<

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


-- >>> FIM: supabase\migrations\02_sales_commissions_loyalty.sql <<<


-- >>> INICIO: supabase\migrations\03_saas_subscriptions_asaas.sql <<<

-- ============================================================
-- 03_SAAS_SUBSCRIPTIONS_ASAAS.SQL
-- Gestão de Assinaturas, Faturas, Webhooks do Asaas & Limites de Planos
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela de Assinaturas do Asaas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id                 TEXT NOT NULL REFERENCES public.plans(id),
    asaas_subscription_id   TEXT UNIQUE,
    asaas_customer_id       TEXT,
    status                  TEXT NOT NULL DEFAULT 'TRIAL'
                            CHECK (status IN ('TRIAL', 'ACTIVE', 'OVERDUE', 'CANCELLED', 'EXPIRED')),
    cycle                   TEXT NOT NULL DEFAULT 'MONTHLY'
                            CHECK (cycle IN ('MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY')),
    value                   NUMERIC(10, 2) NOT NULL,
    next_due_date           DATE,
    current_period_end      TIMESTAMPTZ,
    canceled_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_salon ON public.subscriptions (salon_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_asaas ON public.subscriptions (asaas_subscription_id);

-- ------------------------------------------------------------
-- 2. Tabela de Faturas / Cobranças do Asaas (Invoices)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asaas_invoices (
    id                  TEXT PRIMARY KEY, -- ID da cobrança no Asaas (ex: pay_123456)
    salon_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_id     UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    status              TEXT NOT NULL
                        CHECK (status IN ('PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'DELETED')),
    value               NUMERIC(10, 2) NOT NULL,
    net_value           NUMERIC(10, 2),
    billing_type        TEXT CHECK (billing_type IN ('PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED')),
    invoice_url         TEXT,
    bank_slip_url       TEXT,
    pix_qr_code         TEXT,
    pix_copy_paste      TEXT,
    due_date            DATE NOT NULL,
    payment_date        DATE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_salon ON public.asaas_invoices (salon_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.asaas_invoices (status);

-- ------------------------------------------------------------
-- 3. Log de Webhooks Recebidos do Asaas (Auditoria & Resiliência)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asaas_webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event       TEXT NOT NULL,
    payment_id  TEXT,
    payload     JSONB NOT NULL,
    processed   BOOLEAN NOT NULL DEFAULT false,
    error_msg   TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_processed ON public.asaas_webhooks (processed, created_at);

-- ------------------------------------------------------------
-- 4. Função: Verificar se o salão pode adicionar mais profissionais
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_add_professional(p_salon_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    v_plan_id TEXT;
    v_max_prof INTEGER;
    v_current_count INTEGER;
BEGIN
    -- Busca o plano ativo do salão
    SELECT plan_id INTO v_plan_id
    FROM public.business_info
    WHERE user_id = p_salon_id;

    IF v_plan_id IS NULL THEN
        v_plan_id := 'individual';
    END IF;

    -- Busca o limite de profissionais do plano
    SELECT max_professionals INTO v_max_prof
    FROM public.plans
    WHERE id = v_plan_id;

    IF v_max_prof IS NULL THEN
        v_max_prof := 1;
    END IF;

    -- Conta os profissionais ativos
    SELECT count(*) INTO v_current_count
    FROM public.professionals
    WHERE user_id = p_salon_id AND active = true;

    RETURN v_current_count < v_max_prof;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_add_professional(UUID) TO authenticated, anon;

-- ------------------------------------------------------------
-- 5. Trigger: Proteger limite de profissionais no banco
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_professional_limit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND NEW.active = true AND OLD.active = false) THEN
        IF NOT public.can_add_professional(NEW.user_id) THEN
            RAISE EXCEPTION 'Limite de profissionais do seu plano atingido. Faça upgrade para adicionar mais profissionais.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_professional_limit ON public.professionals;
CREATE TRIGGER trg_check_professional_limit
BEFORE INSERT OR UPDATE ON public.professionals
FOR EACH ROW
EXECUTE FUNCTION public.check_professional_limit_trigger();

-- ------------------------------------------------------------
-- 6. RPC: Processar Webhook do Asaas (Security Definer)
-- ------------------------------------------------------------
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

    -- Localiza o salão pelo asaas_customer_id ou subscription
    SELECT user_id INTO v_salon_id
    FROM public.business_info
    WHERE asaas_customer_id = v_customer_id
    LIMIT 1;

    -- Se não encontrar por business_info, tenta por subscriptions
    IF v_salon_id IS NULL AND v_subscription_id IS NOT NULL THEN
        SELECT salon_id INTO v_salon_id
        FROM public.subscriptions
        WHERE asaas_subscription_id = v_subscription_id
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
    IF p_event IN ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') THEN
        UPDATE public.business_info
        SET status = 'active'
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

GRANT EXECUTE ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 7. RLS para Assinaturas e Faturas
-- ------------------------------------------------------------
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asaas_webhooks ENABLE ROW LEVEL SECURITY;

-- Planos são públicos para leitura
DROP POLICY IF EXISTS "Planos sao publicos" ON public.plans;
CREATE POLICY "Planos sao publicos" ON public.plans FOR SELECT USING (true);

-- Subscriptions: Dono do salão lê a própria
DROP POLICY IF EXISTS "Dono le assinatura" ON public.subscriptions;
CREATE POLICY "Dono le assinatura" ON public.subscriptions FOR SELECT USING (salon_id = public.salao_do_usuario());

-- Invoices: Dono do salão lê as próprias faturas
DROP POLICY IF EXISTS "Dono le faturas" ON public.asaas_invoices;
CREATE POLICY "Dono le faturas" ON public.asaas_invoices FOR SELECT USING (salon_id = public.salao_do_usuario());


-- >>> FIM: supabase\migrations\03_saas_subscriptions_asaas.sql <<<


-- >>> INICIO: supabase\migrations\04_rpcs_finalizar_venda_e_fidelidade.sql <<<

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


-- >>> FIM: supabase\migrations\04_rpcs_finalizar_venda_e_fidelidade.sql <<<

