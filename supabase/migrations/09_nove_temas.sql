-- ============================================================================
-- 09 — OS NOVE TEMAS DO PAINEL
-- ============================================================================
-- A coluna business_info.theme (migração 05) só aceitava 'escuro' e 'claro'.
-- Em 26/09/2026 o painel ganhou nove temas, três por nicho
-- (instrucoes-ia/DESIGN_E_TEMAS.md), e passa a gravar o id de um deles.
--
-- 'escuro' e 'claro' continuam valendo: são o DEFAULT e o que os salões já
-- têm gravado. O painel os traduz para o tema do nicho com a mesma base
-- (ThemeManager.LEGADO, no theme.js) — nenhuma linha precisa ser alterada.
--
-- Sem esta migração o painel continua funcionando: o api.js grava 'escuro' ou
-- 'claro' no lugar do tema recusado, e a escolha só não chega aos outros
-- aparelhos.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

ALTER TABLE public.business_info
    DROP CONSTRAINT IF EXISTS business_info_theme_check;

ALTER TABLE public.business_info
    ADD CONSTRAINT business_info_theme_check
    CHECK (theme IN (
        'escuro', 'claro',                       -- valores antigos (migração 05)
        'oldschool', 'aco', 'navalha',           -- barbearia
        'rose', 'botanico', 'noir',              -- salão de beleza
        'sereno', 'areia', 'clinico'             -- estética e spa
    ));

COMMENT ON COLUMN public.business_info.theme IS
    'Tema visual do painel: um dos nove de instrucoes-ia/DESIGN_E_TEMAS.md, ou escuro/claro (valores antigos, traduzidos pelo painel conforme o nicho). Não afeta a página pública de agendamento.';

-- Conferência: tem que devolver uma linha com ok = true.
SELECT pg_get_constraintdef(oid) LIKE '%clinico%' AS ok
FROM pg_constraint
WHERE conname = 'business_info_theme_check';
