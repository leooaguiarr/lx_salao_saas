-- ============================================================
-- CARIMBO DE HORÁRIO DOS LANÇAMENTOS FINANCEIROS
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- POR QUE ISTO EXISTE
--
-- A coluna "date" da tabela transactions guarda o dia do ATENDIMENTO
-- (competência). Quando o barbeiro confirma hoje o pagamento de um corte de
-- ontem, o lançamento nasce com date = ontem — mas o dinheiro entrou na gaveta
-- HOJE. Sem um segundo carimbo, esse pagamento não aparecia no extrato do dia
-- nem entrava no saldo em gaveta do caixa aberto.
--
-- "registradoEm" guarda o instante em que o lançamento foi feito. As duas
-- datas coexistem de propósito:
--   date         -> extrato do período, faturamento por competência
--   registradoEm -> extrato do dia, saldo em gaveta, fechamento de caixa
--
-- ATENÇÃO ÀS ASPAS: sem elas o Postgres cria a coluna em minúsculas
-- (registradoem) e o PostgREST não a encontra — o mesmo problema que já
-- aconteceu com "avatarUrl".

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS "registradoEm" TEXT;

-- Se uma execução anterior criou a coluna sem aspas, corrige o nome.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'transactions'
          AND column_name = 'registradoem'
    ) THEN
        ALTER TABLE public.transactions RENAME COLUMN registradoem TO "registradoEm";
    END IF;
END $$;

-- Lançamentos antigos ficam com "registradoEm" nulo de propósito: o app cai
-- para a regra por data nesses casos, para não mudar saldo de caixa que o dono
-- já conferiu e fechou.

-- Recarrega o cache de schema do PostgREST, senão a coluna nova só aparece
-- para a API depois de alguns minutos.
NOTIFY pgrst, 'reload schema';
