-- ============================================================================
-- 07 — PROTEÇÃO DA COBRANÇA (webhook do Asaas e colunas de assinatura)
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Havia três jeitos de um salão ficar "ativo" ou mudar de plano sem pagar:
--
-- 1. O webhook /api/asaas/webhook aceitava qualquer requisição. Resolvido no
--    server.js, que agora exige o token do Asaas (ASAAS_WEBHOOK_TOKEN).
--
-- 2. A função process_asaas_webhook tinha GRANT para `anon` (03, linha 248).
--    A chave anon é pública — está no config.js do navegador —, então dava
--    para chamar a função direto na API do Supabase, sem passar pelo
--    servidor, e o token do item 1 não adiantaria nada. Quem chama a função
--    é só o servidor, com a service_role.
--
-- 3. A política "Isolamento por salao" de business_info é FOR ALL: quem está
--    logado pode atualizar a própria linha INTEIRA, inclusive status,
--    plan_id e trial_ends_at. Bastava um PATCH pela API para virar
--    "Ilimitado" ou esticar o teste grátis. O gatilho abaixo congela essas
--    colunas para os papéis de navegador (anon e authenticated).
--
-- QUEM CONTINUA PODENDO MEXER NA COBRANÇA
--
--   - o servidor (service_role): cadastro de salão e webhook;
--   - a própria process_asaas_webhook, que é SECURITY DEFINER e roda como a
--     dona da função (postgres);
--   - o SQL Editor do Studio (postgres), para ajuste manual.
--
-- O gatilho descarta a mudança em silêncio, sem erro: o painel nunca envia
-- essas colunas (api.js, allowedCols), então nenhuma tela é afetada, e um
-- erro aqui derrubaria o upsert inteiro do estabelecimento.
--
-- ANTES DE RODAR: confira que o servidor usa a service_role. Em
-- https://salao.lexionconsultoria.tech/api/health o campo "chaveSupabase"
-- tem que ser "service_role". Se for "anon", o webhook para de funcionar
-- depois deste script (a anon perde o acesso à função) — configure a
-- SUPABASE_SERVICE_ROLE_KEY no Coolify primeiro.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PARTE 1 — process_asaas_webhook só para o servidor
-- ----------------------------------------------------------------------------
-- Funções nascem com EXECUTE para PUBLIC no Postgres; tirar só de `anon`
-- deixaria o acesso vindo por PUBLIC.
REVOKE ALL ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_asaas_webhook(TEXT, JSONB) TO service_role;


-- ----------------------------------------------------------------------------
-- PARTE 2 — Colunas de cobrança congeladas para o navegador
-- ----------------------------------------------------------------------------
-- Sem SECURITY DEFINER de propósito: é o `current_user` de quem fez a
-- requisição que decide. O PostgREST troca o papel da conexão para anon,
-- authenticated ou service_role conforme a chave; o SQL Editor e as funções
-- SECURITY DEFINER rodam como postgres.
CREATE OR REPLACE FUNCTION public.protege_colunas_de_cobranca()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Linha criada pelo próprio navegador (upsert de uma conta antiga sem
        -- cadastro): nasce como qualquer salão novo, no teste grátis do plano
        -- de entrada. O cadastro normal passa pelo servidor e não cai aqui.
        NEW.plan_id := 'individual';
        NEW.status := 'trial';
        NEW.trial_ends_at := now() + interval '7 days';
        NEW.asaas_customer_id := NULL;
        NEW.asaas_subscription_id := NULL;
    ELSE
        NEW.plan_id := OLD.plan_id;
        NEW.status := OLD.status;
        NEW.trial_ends_at := OLD.trial_ends_at;
        NEW.asaas_customer_id := OLD.asaas_customer_id;
        NEW.asaas_subscription_id := OLD.asaas_subscription_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protege_colunas_de_cobranca ON public.business_info;
CREATE TRIGGER trg_protege_colunas_de_cobranca
BEFORE INSERT OR UPDATE ON public.business_info
FOR EACH ROW
EXECUTE FUNCTION public.protege_colunas_de_cobranca();


NOTIFY pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- CONFERÊNCIA — o SQL Editor mostra só o último resultado, por isso é um
-- SELECT único. As quatro linhas têm que vir com ok = true.
-- ----------------------------------------------------------------------------
SELECT 'anon NÃO executa process_asaas_webhook' AS verificacao,
       NOT has_function_privilege('anon', 'public.process_asaas_webhook(text, jsonb)', 'EXECUTE') AS ok
UNION ALL
SELECT 'authenticated NÃO executa process_asaas_webhook',
       NOT has_function_privilege('authenticated', 'public.process_asaas_webhook(text, jsonb)', 'EXECUTE')
UNION ALL
SELECT 'service_role executa process_asaas_webhook',
       has_function_privilege('service_role', 'public.process_asaas_webhook(text, jsonb)', 'EXECUTE')
UNION ALL
SELECT 'gatilho de cobrança ativo em business_info',
       EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_protege_colunas_de_cobranca' AND NOT tgisinternal);
