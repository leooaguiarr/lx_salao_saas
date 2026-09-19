-- ============================================================
-- MIGRAÇÃO: Logo/foto do estabelecimento (business_info."avatarUrl")
--
-- POR QUE ESTE ARQUIVO EXISTE:
-- O supabase_setup.sql cria business_info SEM a coluna "avatarUrl",
-- mas duas partes do sistema dependem dela:
--   1. public/api.js envia "avatarUrl" no upsert de business_info
--      -> salvar os dados com foto falha com:
--         "Could not find the 'avatarUrl' column of 'business_info'"
--   2. a função get_public_salon (em public_booking_setup.sql e em
--      update_professionals_photo.sql) lê v_biz."avatarUrl"
--      -> a página pública de agendamento quebra em tempo de execução,
--         porque plpgsql só resolve a coluna na hora da chamada.
--
-- Ou seja: sem esta migração o link público NUNCA funciona.
-- Rodar no SQL Editor do Supabase. É idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Adiciona a coluna (se ainda não existir)
--    Aspas são obrigatórias: sem elas o Postgres cria "avatarurl"
--    em minúsculas e o PostgREST não casa com o nome do JS.
-- ------------------------------------------------------------
ALTER TABLE public.business_info ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;

-- ------------------------------------------------------------
-- 2. Corrige o nome caso alguma tentativa anterior tenha criado
--    a coluna sem aspas (avatarurl -> "avatarUrl")
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'business_info'
          AND column_name  = 'avatarurl'
    ) THEN
        ALTER TABLE public.business_info RENAME COLUMN avatarurl TO "avatarUrl";
    END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Força o PostgREST a recarregar o cache de schema.
--    Sem isso o erro "schema cache" pode persistir por alguns minutos.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 4. Conferência: deve retornar uma linha com "avatarUrl" / text
-- ------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'business_info'
  AND column_name  = 'avatarUrl';
