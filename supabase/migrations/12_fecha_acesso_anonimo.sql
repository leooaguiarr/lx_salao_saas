-- ============================================================================
-- 12 — FECHA O ACESSO DIRETO DA CHAVE ANON ÀS TABELAS
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- A migração 01 criou seis políticas "Agendamento: ..." para a página pública
-- ler e gravar direto nas tabelas. Elas valem para TODOS os salões ao mesmo
-- tempo: com a chave anon (que está no config.js, à vista de qualquer um), dava
-- para ler o business_info de todos os salões, todos os agendamentos de todos
-- os salões, todas as folgas (com o motivo), e inserir agendamento em qualquer
-- salão sem passar por validação nenhuma. O Security Advisor do Supabase
-- apontou a de INSERT em 05/10/2026 ("RLS Policy Always True"); as de SELECT
-- ele ignora de propósito, mas o vazamento é o mesmo.
--
-- Desde a migração 06 a página pública não precisa de nenhuma delas: tudo
-- passa pelas funções SECURITY DEFINER (get_public_salon,
-- create_public_booking etc.), que devolvem só o necessário e não passam pela
-- RLS. O painel usa o papel `authenticated`, com as políticas de dono e de
-- membro, que este arquivo não toca.
--
-- De carona: o Advisor também apontou "Function Search Path Mutable" no
-- gatilho do limite de profissionais. Sem search_path fixo, quem cria um
-- objeto com o mesmo nome num schema que vem antes no caminho muda o que a
-- função chama. Fixar em public fecha isso, sem mudar o comportamento.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

DROP POLICY IF EXISTS "Agendamento: ler estabelecimento ativo" ON public.business_info;
DROP POLICY IF EXISTS "Agendamento: ler servicos ativos"       ON public.services;
DROP POLICY IF EXISTS "Agendamento: ler profissionais ativos"  ON public.professionals;
DROP POLICY IF EXISTS "Agendamento: criar agendamento anonimo" ON public.appointments;
DROP POLICY IF EXISTS "Agendamento: ler horarios ocupados"     ON public.appointments;
DROP POLICY IF EXISTS "Agendamento: ler bloqueios"             ON public.professional_blocks;

ALTER FUNCTION public.check_professional_limit_trigger() SET search_path = public;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA (rode depois; todas as linhas têm que vir com ok = true)
-- ============================================================================

SELECT 'nenhuma politica sobrou para anon' AS conferencia,
       NOT EXISTS (
           SELECT 1 FROM pg_policies
           WHERE schemaname = 'public' AND 'anon' = ANY (roles)
       ) AS ok
UNION ALL
SELECT 'gatilho com search_path fixo',
       EXISTS (
           SELECT 1 FROM pg_proc
           WHERE proname = 'check_professional_limit_trigger'
             AND proconfig @> ARRAY['search_path=public']
       )
UNION ALL
SELECT 'funcoes do link publico continuam la',
       (SELECT count(*) FROM pg_proc
        WHERE proname IN ('get_public_salon','create_public_booking','get_public_queue',
                          'get_public_products','check_client_exists','check_week_appointments')) = 6;
