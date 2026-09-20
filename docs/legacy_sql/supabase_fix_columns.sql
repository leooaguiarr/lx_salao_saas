-- 1. Adicionar coluna 'commission' na tabela professionals
ALTER TABLE public.professionals ADD COLUMN commission NUMERIC DEFAULT 0;

-- 2. Adicionar coluna 'user_id' na tabela cash_registers (necessária para o RLS e sincronização)
ALTER TABLE public.cash_registers ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- 3. Atualizar a política de acesso do cash_registers para filtrar por user_id
DROP POLICY IF EXISTS "Public cash_registers access" ON public.cash_registers;
CREATE POLICY "User cash_registers access" ON public.cash_registers FOR ALL USING (auth.uid() = user_id);
