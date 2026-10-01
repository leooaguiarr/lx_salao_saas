-- ============================================================================
-- 11 — PLANO SOLO SEM COMISSÃO
-- ============================================================================
-- No plano Individual (Solo) o profissional é o próprio dono. O cadastro
-- criava o "Profissional Principal" com 50% de comissão, e o Financeiro
-- passava a mostrar metade do faturamento como comissão a pagar para ele
-- mesmo. O server.js já cria com 0% a partir de 30/09/2026; esta migração
-- corrige os salões Solo que já existiam.
--
-- Só mexe em salão com plan_id = 'individual'. Plano Equipe e Ilimitado
-- continuam com a comissão que o dono definiu.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

UPDATE public.professionals p
SET commission = 0
FROM public.business_info b
WHERE b.user_id = p.user_id
  AND b.plan_id = 'individual'
  AND COALESCE(p.commission, 0) <> 0;

-- Conferência: tem que devolver 0 (nenhum profissional de salão Solo com comissão).
SELECT count(*) AS solo_com_comissao
FROM public.professionals p
JOIN public.business_info b ON b.user_id = p.user_id
WHERE b.plan_id = 'individual'
  AND COALESCE(p.commission, 0) <> 0;
