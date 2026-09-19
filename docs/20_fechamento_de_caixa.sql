-- ============================================================
-- FECHAMENTO DE CAIXA: ESPERADO, CONTADO E DIFERENÇA (Fase C)
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- POR QUE
--
-- Até aqui o fechamento gravava um número só, `finalCash`, e ele era o valor
-- que o SISTEMA calculou. O que estava na gaveta de verdade não era perguntado
-- nem guardado. Na prática isso significa que a conferência do fim do dia — a
-- razão de existir o fechamento — não acontecia: se faltavam R$ 20, o sistema
-- registrava o mesmo número de sempre e a falta nunca aparecia em lugar nenhum.
--
-- A Fase C separa as duas coisas:
--
--   expectedCash   — o que o sistema calculou (fundo + entradas − saídas)
--   countedCash    — o que a pessoa contou na gaveta
--   cashDifference — contado − esperado, gravado pronto para não depender de
--                    quem faz a conta depois
--   closingNote    — a explicação, quando as duas não batem
--
-- `finalCash` CONTINUA existindo e continua recebendo o esperado. É o que os
-- caixas já fechados têm gravado e o que o extrato em PDF lê hoje; trocar o
-- significado dele mudaria número de caixa que o dono já conferiu e assinou.
--
-- Colunas novas nascem NULAS de propósito. Caixa fechado antes desta migration
-- não tem valor contado, e preencher com o esperado seria inventar uma
-- conferência que ninguém fez — a tela mostra "não informado" nesses casos.

-- ------------------------------------------------------------
-- 1. As colunas
-- ------------------------------------------------------------
-- Nomes em camelCase entre aspas para acompanhar as colunas que já existem
-- nesta tabela (`dateOpened`, `initialCash`, `finalCash`). O PostgREST devolve
-- exatamente o nome gravado, e o front lê essas chaves direto.
ALTER TABLE public.cash_registers ADD COLUMN IF NOT EXISTS "expectedCash"   numeric;
ALTER TABLE public.cash_registers ADD COLUMN IF NOT EXISTS "countedCash"    numeric;
ALTER TABLE public.cash_registers ADD COLUMN IF NOT EXISTS "cashDifference" numeric;
ALTER TABLE public.cash_registers ADD COLUMN IF NOT EXISTS "closingNote"    text;

-- ------------------------------------------------------------
-- 2. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
-- Sem isto o upsert do fechamento falha com "Could not find the 'countedCash'
-- column" — o erro de schema cache que este projeto já pegou antes.
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- 1. As quatro colunas existem:
--
--      SELECT column_name, data_type FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'cash_registers'
--      ORDER BY ordinal_position;
--
--    Esperado: as de sempre mais expectedCash, countedCash, cashDifference e
--    closingNote.
--
-- 2. Os caixas já fechados continuam intactos, com as colunas novas nulas:
--
--      SELECT id, "initialCash", "finalCash", "countedCash", "cashDifference"
--      FROM cash_registers ORDER BY "dateOpened" DESC LIMIT 5;
--
-- 3. Feche um caixa pela tela informando um valor contado diferente do
--    esperado. A diferença tem que aparecer gravada, com o sinal certo:
--    contado MAIOR que o esperado é diferença positiva (sobra).
