-- ==========================================
-- MIGRAÇÃO: Apaga tabelas antigas e recria com multi-tenant
-- Cole e execute no SQL Editor do mesmo projeto Supabase
-- ==========================================

-- 1. Apagar tabelas antigas (na ordem certa por causa das foreign keys)
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS professionals CASCADE;
DROP TABLE IF EXISTS business_info CASCADE;

-- 2. Recriar com user_id (multi-tenant)

CREATE TABLE business_info (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    phone TEXT,
    instagram TEXT,
    address TEXT,
    hours JSONB,
    "whatsappRecallMessage" TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE services (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    duration INTEGER NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE professionals (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    active BOOLEAN DEFAULT TRUE,
    "photoUrl" TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    instagram TEXT,
    birth TEXT,
    frequency INTEGER,
    "lastVisit" TEXT,
    notes TEXT,
    status TEXT,
    active BOOLEAN DEFAULT TRUE,
    "photoUrl" TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE appointments (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "clientId" TEXT,
    "serviceId" TEXT,
    "profId" TEXT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT,
    "paymentStatus" TEXT,
    "paymentMethod" TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE leads (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    source TEXT,
    stage TEXT,
    notes TEXT,
    date TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    -- date = dia do atendimento (competência, usada no extrato do período).
    -- "registradoEm" = instante em que o dinheiro mexeu no caixa. São
    -- diferentes quando se confirma hoje o pagamento de um atendimento de
    -- ontem, e é o segundo que manda no saldo em gaveta.
    date TEXT,
    "registradoEm" TEXT,
    description TEXT,
    category TEXT,
    "paymentMethod" TEXT,
    "profId" TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Row Level Security (cada salão só vê seus dados)

ALTER TABLE business_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON business_info FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Tenant isolation" ON services FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Tenant isolation" ON professionals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Tenant isolation" ON clients FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Tenant isolation" ON appointments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Tenant isolation" ON leads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Tenant isolation" ON transactions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. IMPORTANTE: depois deste script, rode também o
--    public_booking_setup.sql (funções do link público de agendamento)
