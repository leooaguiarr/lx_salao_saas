-- 1. Tabela de Registros de Caixa
CREATE TABLE public.cash_registers (
    id TEXT PRIMARY KEY,
    "dateOpened" TEXT NOT NULL,
    "dateClosed" TEXT,
    "initialCash" NUMERIC DEFAULT 0,
    "finalCash" NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'open', -- 'open' ou 'closed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS (Row Level Security) na tabela cash_registers
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;

-- Adicionar política de acesso público (ajuste conforme a segurança do seu app)
CREATE POLICY "Public cash_registers access" ON public.cash_registers FOR ALL USING (true);

-- 2. Atualizar a Tabela de Transações
-- Como as transações agora precisam de um "status" para saber se estão pendentes (quando o caixa está fechado) ou completas.
ALTER TABLE public.transactions ADD COLUMN status TEXT DEFAULT 'completed';

-- Nota: Caso você use o LocalStorage primeiro, isso servirá para manter o Supabase compatível.
