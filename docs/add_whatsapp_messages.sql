-- ============================================================
-- MENSAGENS DE WHATSAPP QUE FALTAVAM NA NUVEM
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O PROBLEMA
--
-- O supabase_setup.sql criou business_info com apenas uma das mensagens
-- ("whatsappRecallMessage"). As outras duas ficavam só no localStorage do
-- navegador — ou seja:
--
--   - o dono editava a mensagem no celular dele e o login da Lexion continuava
--     vendo o texto antigo;
--   - limpar os dados do navegador apagava o que o cliente havia escrito.
--
-- Com o compartilhamento de logins (docs/multi_login_por_salao.sql) isso passou
-- a incomodar de verdade: são vários acessos para a mesma barbearia, e cada um
-- via uma mensagem diferente.
--
-- ⚠️ Colunas em camelCase EXIGEM aspas duplas no Postgres. Sem as aspas ele
-- cria "whatsappbookingmessage" em minúsculas e o app nunca acha a coluna.

ALTER TABLE public.business_info
    ADD COLUMN IF NOT EXISTS "whatsappBookingMessage"  TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappBirthdayMessage" TEXT;

-- Recarrega o cache de schema do PostgREST. Sem isto o app continua recebendo
-- "Could not find the 'whatsappBirthdayMessage' column" até o cache expirar.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- CONFERÊNCIA — tem que listar as três mensagens
-- ------------------------------------------------------------
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'business_info'
  AND column_name ILIKE 'whatsapp%'
ORDER BY column_name;

-- Esperado:
--   whatsappBirthdayMessage
--   whatsappBookingMessage
--   whatsappRecallMessage
--
-- Se algum nome vier todo em minúsculas, foi criado sem aspas em algum momento.
-- Nesse caso, renomeie:
--
--   ALTER TABLE public.business_info
--       RENAME COLUMN whatsappbirthdaymessage TO "whatsappBirthdayMessage";
