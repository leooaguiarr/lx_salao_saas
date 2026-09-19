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
