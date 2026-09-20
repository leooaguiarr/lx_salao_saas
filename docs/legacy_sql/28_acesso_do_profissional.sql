-- ============================================================
-- ACESSO DO PROFISSIONAL: e-mail no cadastro e quadro da equipe
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O script 27 abriu as abas para o USUARIO. Este aqui prepara o banco para o
-- lado de CADASTRO: e-mail no profissional, e a leitura do quadro de quem tem
-- login. Sao duas coisas pequenas, e as duas sao pre-requisito da tela.
--
-- Quem CRIA e APAGA login continua fora daqui: e a Edge Function
-- `acesso-profissional`, que usa a chave de servico. Nenhum login de salao,
-- nem o do dono, pode criar conta de ninguem pela API do navegador.

-- ------------------------------------------------------------
-- 1. O e-mail que vira login
-- ------------------------------------------------------------
-- Nullable de proposito, e nao e so preguica: profissional SEM acesso ao
-- sistema e o caso normal — o barbeiro que so aparece na agenda e nao entra
-- em tela nenhuma. Um NOT NULL aqui obrigaria a inventar e-mail para quem nao
-- precisa de um.
--
-- ⚠️ A licao do `loyaltyEnrolled` (ver a auditoria da Fase H): `ADD COLUMN IF
-- NOT EXISTS` NAO altera coluna que ja existe. Se um dia esta coluna precisar
-- mudar, sera com ALTER COLUMN, em script novo — editar esta linha nao muda
-- nada em banco nenhum que ja rodou este arquivo.
ALTER TABLE public.professionals
    ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.professionals.email IS
    'E-mail do login deste profissional. Vazio = profissional sem acesso ao sistema.';

-- ------------------------------------------------------------
-- 2. Ler o quadro da equipe (e nao so o proprio vinculo)
-- ------------------------------------------------------------
-- A politica antiga era `user_id = auth.uid()`: cada login enxergava UMA linha,
-- a dele. Isso basta para o sistema saber quem voce e, mas nao para duas coisas
-- que a tela passou a precisar:
--
--   a) O cartao do profissional dizer "tem acesso ao sistema". Sem ler o
--      quadro, o dono nao tem como saber quem ja tem login — ele criaria conta
--      duplicada sem perceber.
--   b) O historico de vendas mostrar QUEM VENDEU. `sales.sold_by` guarda o id
--      do login (script 27); traduzir esse id para um nome exige cruzar com o
--      quadro. Sem isso a coluna mostraria um uuid, que nao diz nada a ninguem.
--
-- O que se abre e o RECORTE DO PROPRIO SALAO, e o conteudo e magro de
-- proposito: id do login, papel e a qual profissional ele pertence. Nao ha
-- e-mail nem senha nesta tabela — quem guarda isso e o `auth.users`, que
-- continua inalcancavel pela API do navegador.
DROP POLICY IF EXISTS "Ver o proprio vinculo" ON public.salon_members;
DROP POLICY IF EXISTS "Ver o quadro do salao" ON public.salon_members;
CREATE POLICY "Ver o quadro do salao" ON public.salon_members
    FOR SELECT USING (salon_id = public.salao_do_usuario());

-- A ESCRITA continua sem politica nenhuma: quem cria e apaga vinculo e a Edge
-- Function pela chave de servico, que passa por cima da RLS. Nao ha politica de
-- INSERT, UPDATE nem DELETE nesta tabela, e nao passa a haver.

-- ============================================================
-- CONFERENCIA — rode depois e confira o resultado
-- ============================================================
-- 1) A coluna nova existe e aceita nulo (espera-se text / YES):
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='professionals' AND column_name='email';

-- 2) A politica do quadro (espera-se UMA linha, SELECT, por salao):
SELECT policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname='public' AND tablename='salon_members';

-- 3) A tabela continua SEM escrita pela API (espera-se 0):
SELECT count(*) AS politicas_de_escrita
  FROM pg_policies
 WHERE schemaname='public' AND tablename='salon_members' AND cmd <> 'SELECT';

-- ============================================================
-- COMO VOLTAR ATRAS
-- ============================================================
--   DROP POLICY IF EXISTS "Ver o quadro do salao" ON public.salon_members;
--   CREATE POLICY "Ver o proprio vinculo" ON public.salon_members
--       FOR SELECT USING (user_id = auth.uid());
--
-- A coluna `email` pode ficar: ela nao muda comportamento nenhum sozinha.
