-- ============================================================
-- NÍVEIS DE ACESSO + FILA DE ATENDIMENTO
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE FALTAVA
--
-- docs/multi_login_por_salao.sql já criava a coluna `role` ('owner' / 'staff'),
-- mas **nada era restringido**: qualquer login vinculado enxergava tudo,
-- inclusive o financeiro completo do salão.
--
-- E faltava a peça central: `salon_members` sabia que o login pertence ao
-- salão, mas **não sabia QUAL barbeiro ele é**. Sem isso, "a agenda dele" e
-- "a comissão dele" não têm como ser definidas.
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. Liga cada login a um profissional (`salon_members.professional_id`).
--   2. Restringe o que o 'staff' enxerga, **na RLS** — não só na tela.
--   3. Cria a fila pública que o cliente acompanha pelo WhatsApp dele.
--
-- ⚠️ A restrição precisa estar na RLS. Esconder botão na tela não protege
-- nada: o barbeiro tem o navegador dele e a mesma chave `anon` que vai para
-- todo mundo. Quem separa os dados é o banco.

-- ------------------------------------------------------------
-- 1. Qual profissional é cada login
-- ------------------------------------------------------------
ALTER TABLE public.salon_members
    ADD COLUMN IF NOT EXISTS professional_id TEXT;

COMMENT ON COLUMN public.salon_members.professional_id IS
    'id da linha em professionals. Obrigatório para role = staff; nulo para o dono.';

-- ------------------------------------------------------------
-- 2. Funções de contexto
-- ------------------------------------------------------------
-- SECURITY DEFINER pelo mesmo motivo de salao_do_usuario(): sem isso a
-- consulta a salon_members dispara a política da própria salon_members, que
-- chama esta função de novo — recursão infinita em toda consulta do sistema.

CREATE OR REPLACE FUNCTION public.meu_papel()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    -- Sem vínculo cadastrado o login é tratado como dono. É o que mantém
    -- funcionando quem já usava o sistema antes desta migração.
    SELECT COALESCE(
        (SELECT role FROM public.salon_members WHERE user_id = auth.uid()),
        'owner'
    );
$$;

CREATE OR REPLACE FUNCTION public.meu_profissional()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT professional_id FROM public.salon_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.meu_papel() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_profissional() TO authenticated;

-- ------------------------------------------------------------
-- 3. As políticas passam a olhar o PAPEL
-- ------------------------------------------------------------
-- Regra geral: o dono continua com acesso total, exatamente como hoje.
-- O staff é recortado tabela a tabela.
--
-- ⚠️ Um staff SEM professional_id preenchido não enxerga nada de agenda.
-- É proposital: melhor um barbeiro sem dados do que um barbeiro vendo os
-- dados de outro. O passo 6 mostra como conferir isso.

-- --- business_info: staff lê, não escreve ---------------------
DROP POLICY IF EXISTS "Acesso por salao" ON public.business_info;
CREATE POLICY "Acesso por salao" ON public.business_info
    FOR ALL
    USING (user_id = public.salao_do_usuario())
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- --- services: staff lê (precisa para agendar), não escreve ----
DROP POLICY IF EXISTS "Acesso por salao" ON public.services;
CREATE POLICY "Acesso por salao" ON public.services
    FOR ALL
    USING (user_id = public.salao_do_usuario())
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- --- professionals: staff vê só a PRÓPRIA linha ---------------
-- A comissão de cada um mora aqui. Um barbeiro não deve ver o percentual do
-- outro — é informação de contrato, não de operação.
DROP POLICY IF EXISTS "Acesso por salao" ON public.professionals;
CREATE POLICY "Acesso por salao" ON public.professionals
    FOR ALL
    USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR id = public.meu_profissional())
    )
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- --- appointments: staff vê e mexe só na própria agenda --------
DROP POLICY IF EXISTS "Acesso por salao" ON public.appointments;
CREATE POLICY "Acesso por salao" ON public.appointments
    FOR ALL
    USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    )
    WITH CHECK (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );

-- --- clients: staff vê quem ELE já atendeu ---------------------
-- Pode cadastrar cliente novo (encaixe que chegou sem hora) e editar os que
-- atende. A carteira inteira do salão continua sendo do dono.
DROP POLICY IF EXISTS "Acesso por salao" ON public.clients;
CREATE POLICY "Acesso por salao" ON public.clients
    FOR ALL
    USING (
        user_id = public.salao_do_usuario()
        AND (
            public.meu_papel() = 'owner'
            OR EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a."clientId" = clients.id
                  AND a."profId" = public.meu_profissional()
            )
        )
    )
    WITH CHECK (user_id = public.salao_do_usuario());

-- --- transactions: staff vê só o que é dele, e NÃO escreve -----
-- É daqui que sai a comissão dele. Escrita fica com o dono: o barbeiro não
-- confirma pagamento, então não lança dinheiro no caixa.
DROP POLICY IF EXISTS "Acesso por salao" ON public.transactions;
CREATE POLICY "Acesso por salao" ON public.transactions
    FOR ALL
    USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    )
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- --- cash_registers: só o dono --------------------------------
DROP POLICY IF EXISTS "Acesso por salao" ON public.cash_registers;
CREATE POLICY "Acesso por salao" ON public.cash_registers
    FOR ALL
    USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- --- leads: só o dono -----------------------------------------
-- O funil de captação é do negócio. O link público grava lead por
-- create_public_booking, que é SECURITY DEFINER e não passa por aqui.
DROP POLICY IF EXISTS "Acesso por salao" ON public.leads;
CREATE POLICY "Acesso por salao" ON public.leads
    FOR ALL
    USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- --- professional_blocks: staff marca a própria folga ----------
DROP POLICY IF EXISTS "Acesso por salao" ON public.professional_blocks;
CREATE POLICY "Acesso por salao" ON public.professional_blocks
    FOR ALL
    USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    )
    WITH CHECK (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );

-- ------------------------------------------------------------
-- 4. FILA: o cliente acompanha a própria vez
-- ------------------------------------------------------------
-- Recebe o WhatsApp que o cliente usou para agendar e devolve a fila do dia
-- DO PROFISSIONAL DELE.
--
-- ⚠️ NÃO devolve nome nem telefone de ninguém. Só horário e situação, mais um
-- marcador dizendo qual da lista é o solicitante. Quem tem horário hoje não
-- tem por que saber quem mais está na barbearia — e a página é pública.
CREATE OR REPLACE FUNCTION get_public_queue(p_slug text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_client_id text;
    v_hoje text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
    v_meu record;
    v_fila jsonb;
    v_posicao int;
BEGIN
    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('encontrado', false);
    END IF;

    SELECT id INTO v_client_id FROM clients
    WHERE user_id = v_user_id AND phone = p_phone LIMIT 1;
    IF v_client_id IS NULL THEN
        RETURN jsonb_build_object('encontrado', false);
    END IF;

    -- O agendamento de hoje do cliente que ainda não terminou
    SELECT a.id, a.time, a."profId", a.status
    INTO v_meu
    FROM appointments a
    WHERE a.user_id = v_user_id
      AND a."clientId" = v_client_id
      AND a.date = v_hoje
      AND a.status NOT IN ('cancelled', 'no_show', 'done')
    ORDER BY a.time
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('encontrado', false);
    END IF;

    -- A fila é a do profissional dele: é ela que determina a vez.
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'time'), '[]'::jsonb)
    INTO v_fila
    FROM (
        SELECT jsonb_build_object(
                   'time', a.time,
                   'status', a.status,
                   'sou_eu', a.id = v_meu.id
               ) AS x
        FROM appointments a
        WHERE a.user_id = v_user_id
          AND a."profId" = v_meu."profId"
          AND a.date = v_hoje
          AND a.status NOT IN ('cancelled', 'no_show', 'done')
    ) sub;

    -- Quantos estão na frente: mesma fila, horário menor.
    SELECT count(*) INTO v_posicao
    FROM appointments a
    WHERE a.user_id = v_user_id
      AND a."profId" = v_meu."profId"
      AND a.date = v_hoje
      AND a.status NOT IN ('cancelled', 'no_show', 'done')
      AND a.time < v_meu.time;

    RETURN jsonb_build_object(
        'encontrado', true,
        'meuHorario', v_meu.time,
        'meuStatus', v_meu.status,
        'pessoasNaFrente', v_posicao,
        'profissional', (SELECT name FROM professionals WHERE id = v_meu."profId"),
        'fila', v_fila
    );
END;
$$;

REVOKE ALL ON FUNCTION get_public_queue(text, text) FROM public;
GRANT EXECUTE ON FUNCTION get_public_queue(text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 6. COMO CADASTRAR UM BARBEIRO
-- ============================================================
--
-- 1. Criar o profissional normalmente pelo sistema (Configurações →
--    Profissionais) e anotar o id dele:
--
--      SELECT id, name FROM public.professionals ORDER BY name;
--
-- 2. Criar o usuário em Authentication → Users → Add user (com Auto Confirm).
--
-- 3. Vincular o login ao salão E ao profissional:
--
--      WITH dono AS (
--          SELECT user_id AS salon_id FROM public.business_info
--          WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1
--      )
--      INSERT INTO public.salon_members (user_id, salon_id, role, professional_id)
--      SELECT u.id, d.salon_id, 'staff', '<id do profissional>'
--      FROM auth.users u CROSS JOIN dono d
--      WHERE u.email = '<email do barbeiro>'
--      ON CONFLICT (user_id) DO UPDATE
--          SET salon_id = EXCLUDED.salon_id,
--              role = EXCLUDED.role,
--              professional_id = EXCLUDED.professional_id;
--
-- 4. O barbeiro sai e entra de novo.
--
-- CONFERIR quem é quem (staff sem professional_id não enxerga a agenda):
--
--      SELECT u.email, m.role, m.professional_id, p.name AS profissional,
--             CASE WHEN m.role = 'staff' AND m.professional_id IS NULL
--                  THEN '⚠️ FALTA VINCULAR O PROFISSIONAL' ELSE 'ok' END AS situacao
--      FROM public.salon_members m
--      JOIN auth.users u ON u.id = m.user_id
--      LEFT JOIN public.professionals p ON p.id = m.professional_id
--      ORDER BY m.role, u.email;
--
-- ⚠️ NÃO transformar o dono em 'staff' sem antes ter OUTRO login 'owner'
-- ativo: as políticas de cash_registers e leads passam a recusar tudo, e o
-- salão fica sem ninguém que consiga fechar o caixa.
