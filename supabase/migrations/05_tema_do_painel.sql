-- ============================================================================
-- 05 — TEMA DO PAINEL (claro / escuro)
-- ============================================================================
-- O salão escolhe o tema em Configurações → Dados do Estabelecimento. A escolha
-- é do ESTABELECIMENTO, não de quem está logado: a equipe inteira vê o mesmo
-- painel, em qualquer aparelho.
--
-- Salões que já existem continuam no tema escuro, que era o único até aqui —
-- por isso o DEFAULT 'escuro' e o NOT NULL.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

ALTER TABLE public.business_info
    ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'escuro';

-- Um tema fora da lista deixaria o painel sem paleta: o data-theme não casaria
-- com nenhum bloco do CSS e a tela ficaria com as cores do :root pela metade.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'business_info_theme_check'
    ) THEN
        ALTER TABLE public.business_info
            ADD CONSTRAINT business_info_theme_check
            CHECK (theme IN ('escuro', 'claro'));
    END IF;
END $$;

COMMENT ON COLUMN public.business_info.theme IS
    'Tema visual do painel: escuro (padrão) ou claro. Não afeta a página pública de agendamento.';

-- ----------------------------------------------------------------------------
-- A página pública de agendamento NÃO usa este campo: ela tem visual próprio e
-- é a mesma para o cliente final de qualquer salão. Se um dia o tema precisar
-- chegar até ela, a coluna terá de ser incluída no retorno de get_public_salon,
-- que hoje devolve apenas o necessário para agendar.
-- ----------------------------------------------------------------------------
