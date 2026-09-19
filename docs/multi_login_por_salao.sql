-- ============================================================
-- VÁRIOS LOGINS PARA A MESMA BARBEARIA
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O PROBLEMA
--
-- O setup original amarrou cada linha ao LOGIN que a criou:
--
--     CREATE POLICY "Tenant isolation" ON services
--       FOR ALL USING (auth.uid() = user_id);
--
-- Com isso, criar um segundo usuário no Authentication cria, na prática, uma
-- barbearia nova e vazia: o novo login não enxerga nada do que o dono cadastrou.
--
-- A SOLUÇÃO
--
-- A coluna user_id das tabelas passa a significar "o SALÃO dono do registro",
-- não "o login que criou". Uma tabela de vínculo diz a que salão cada login
-- pertence, e as políticas passam a comparar com o salão, não com o login.
--
-- O id do salão é o user_id do DONO. Assim nenhuma linha existente precisa ser
-- alterada — os dados que já estão lá continuam válidos como estão.

-- ------------------------------------------------------------
-- 1. Tabela de vínculo: qual login pertence a qual salão
-- ------------------------------------------------------------
-- user_id é PRIMARY KEY de propósito: um login pertence a exatamente um salão.
-- Cada barbearia tem a própria instância do sistema, então não existe caso de
-- uma pessoa atender dois salões no mesmo banco.
CREATE TABLE IF NOT EXISTS public.salon_members (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    salon_id   uuid NOT NULL,
    -- 'owner' vê tudo. 'staff' está reservado para os níveis de acesso que
    -- ainda serão implementados no app — hoje o app ainda não diferencia.
    role       text NOT NULL DEFAULT 'staff',
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salon_members_salon ON public.salon_members (salon_id);

-- ------------------------------------------------------------
-- 2. Função que resolve o salão do login atual
-- ------------------------------------------------------------
-- SECURITY DEFINER é obrigatório aqui. Sem isso, a consulta a salon_members
-- dispararia a política da própria salon_members, que por sua vez chamaria
-- esta função: recursão infinita e erro em toda consulta do sistema.
--
-- O COALESCE mantém o comportamento antigo para quem ainda não tem vínculo:
-- o login vira dono do próprio salão. É o que permite rodar esta migração sem
-- quebrar nada antes de cadastrar os vínculos.
CREATE OR REPLACE FUNCTION public.salao_do_usuario()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT salon_id FROM public.salon_members WHERE user_id = auth.uid()),
        auth.uid()
    );
$$;

GRANT EXECUTE ON FUNCTION public.salao_do_usuario() TO authenticated;

-- ------------------------------------------------------------
-- 3. Quem já usa o sistema vira dono do próprio salão
-- ------------------------------------------------------------
-- Roda antes de trocar as políticas, para ninguém ficar sem acesso no meio.
INSERT INTO public.salon_members (user_id, salon_id, role)
SELECT DISTINCT b.user_id, b.user_id, 'owner'
FROM public.business_info b
WHERE b.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. RLS da própria tabela de vínculo
-- ------------------------------------------------------------
-- O login só enxerga a própria linha. Cadastro e alteração de vínculo ficam
-- fora do alcance do app de propósito: só pelo SQL Editor (ou service_role),
-- para que ninguém consiga se mover para outro salão pelo navegador.
ALTER TABLE public.salon_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver o proprio vinculo" ON public.salon_members;
CREATE POLICY "Ver o proprio vinculo" ON public.salon_members
    FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 5. As políticas passam a comparar com o SALÃO
-- ------------------------------------------------------------
DO $$
DECLARE
    t text;
    tabelas text[] := ARRAY[
        'business_info', 'services', 'professionals', 'clients',
        'appointments', 'leads', 'transactions', 'cash_registers'
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        -- Só mexe no que existe: cash_registers vem de outro script e pode
        -- ainda não ter sido criada.
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

            -- Remove as políticas antigas pelo nome que cada script usou.
            EXECUTE format('DROP POLICY IF EXISTS "Tenant isolation" ON public.%I', t);
            EXECUTE format('DROP POLICY IF EXISTS "User cash_registers access" ON public.%I', t);
            EXECUTE format('DROP POLICY IF EXISTS "Public cash_registers access" ON public.%I', t);
            EXECUTE format('DROP POLICY IF EXISTS "Acesso por salao" ON public.%I', t);

            EXECUTE format(
                'CREATE POLICY "Acesso por salao" ON public.%I FOR ALL '
                'USING (user_id = public.salao_do_usuario()) '
                'WITH CHECK (user_id = public.salao_do_usuario())', t);
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- COMO ADICIONAR UM LOGIN NOVO À BARBEARIA
-- ============================================================
--
-- 1. Criar o usuário em Authentication > Users > Add user (com Auto Confirm).
--
-- 2. Rodar o bloco abaixo. Ele NÃO pede e-mail: o dono é descoberto sozinho,
--    como sendo quem tem os dados do estabelecimento cadastrados. Digitar
--    e-mail à mão é a parte que mais dá errado — placeholder que fica sem
--    trocar vira NULL e estoura em "null value in column user_id".
--
--    Como cada barbearia tem a própria instância, TODOS os logins do projeto
--    pertencem a este salão. É isso que o bloco assume.
--
--     WITH dono AS (
--         SELECT user_id AS salon_id
--         FROM public.business_info
--         WHERE user_id IS NOT NULL
--         ORDER BY created_at
--         LIMIT 1
--     )
--     INSERT INTO public.salon_members (user_id, salon_id, role)
--     SELECT u.id,
--            d.salon_id,
--            CASE WHEN u.id = d.salon_id THEN 'owner' ELSE 'staff' END
--     FROM auth.users u
--     CROSS JOIN dono d
--     ON CONFLICT (user_id) DO UPDATE
--         SET salon_id = EXCLUDED.salon_id, role = EXCLUDED.role;
--
-- 3. O funcionário sai e entra de novo no sistema.
--
-- PARA DESCOBRIR quem é o dono (quem tem os dados da barbearia):
--
--     SELECT u.email, u.id,
--            (SELECT count(*) FROM public.business_info b WHERE b.user_id = u.id) AS estabelecimento,
--            (SELECT count(*) FROM public.services     s WHERE s.user_id = u.id) AS servicos,
--            (SELECT count(*) FROM public.appointments a WHERE a.user_id = u.id) AS agendamentos
--     FROM auth.users u
--     ORDER BY u.created_at;
--
-- PARA CONFERIR quem está vinculado a quê:
--
--     SELECT u.email, m.role,
--            (SELECT email FROM auth.users WHERE id = m.salon_id) AS salao_de
--     FROM public.salon_members m
--     JOIN auth.users u ON u.id = m.user_id
--     ORDER BY m.salon_id, m.role;
--
-- ============================================================
-- TRANSFERIR OS DADOS DE UM LOGIN PARA OUTRO
-- (ex: o salão foi cadastrado num usuário de teste e precisa passar
--  para o login definitivo do dono)
-- ============================================================
--
-- ⚠️⚠️ NUNCA excluir o usuário antigo antes de transferir. As tabelas usam
--
--     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
--
-- Excluir o login em Authentication apaga EM CASCATA todos os registros dele:
-- estabelecimento, serviços, profissionais, clientes, agendamentos, leads e
-- transações. Sem confirmação e sem possibilidade de desfazer.
--
-- A ordem segura é: transferir -> conferir -> só então excluir.
--
--     DO $BLOCO$
--     DECLARE
--         v_antigo uuid := '<id do login que TEM os dados>';
--         v_novo   uuid := '<id do login que VAI FICAR com eles>';
--         t text;
--         tabelas text[] := ARRAY[
--             'business_info', 'services', 'professionals', 'clients',
--             'appointments', 'leads', 'transactions', 'cash_registers'
--         ];
--     BEGIN
--         FOREACH t IN ARRAY tabelas LOOP
--             IF EXISTS (
--                 SELECT 1 FROM information_schema.tables
--                 WHERE table_schema = 'public' AND table_name = t
--             ) THEN
--                 EXECUTE format('UPDATE public.%I SET user_id = %L WHERE user_id = %L',
--                                t, v_novo, v_antigo);
--             END IF;
--         END LOOP;
--     END $BLOCO$;
--
-- business_info tem UNIQUE (user_id): se o login de destino JÁ tiver um
-- estabelecimento cadastrado, o UPDATE falha. Nesse caso, apagar antes a linha
-- vazia do destino.
--
-- Depois de transferir, refazer os vínculos e conferir que a contagem bateu
-- ANTES de excluir o login antigo no painel.
--
-- ⚠️ ATENÇÃO: enquanto os níveis de acesso não estiverem implementados no app,
-- QUALQUER login vinculado enxerga tudo, inclusive o financeiro completo. O
-- campo `role` já existe para quando essa parte for feita, mas hoje ele não
-- restringe nada.
