-- ============================================================
-- POLÍTICAS POR COMANDO (fecha o DELETE do profissional)
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTAVA ABERTO
--
-- docs/sql/11_niveis_de_acesso_e_fila.sql recortou o acesso do 'staff' escrevendo
-- políticas assim:
--
--     CREATE POLICY "Acesso por salao" ON public.services
--         FOR ALL
--         USING (user_id = public.salao_do_usuario())
--         WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
--
-- A intenção estava certa — "o staff lê, só o dono escreve" — mas **WITH CHECK
-- não vale para DELETE**. No Postgres:
--
--     SELECT  -> avalia USING
--     INSERT  -> avalia WITH CHECK
--     UPDATE  -> avalia USING (linha atual) e WITH CHECK (linha nova)
--     DELETE  -> avalia SOMENTE o USING
--
-- Ou seja: onde o USING deixava o profissional VER a linha, ele também podia
-- APAGAR. Com o login dele e a chave `anon` que vai para todo navegador:
--
--     await supabase.from('services').delete().neq('id', '')
--
-- apagava o catálogo inteiro do salão. O mesmo valia para os lançamentos
-- financeiros dele (o rastro da própria comissão), para o cadastro do
-- estabelecimento, para os produtos e para os clientes que ele atendeu.
--
-- Nenhuma das 13 migrações anteriores tem uma única política FOR DELETE.
--
-- O QUE ESTE SCRIPT FAZ
--
-- Troca todo FOR ALL por políticas separadas por comando, de modo que apagar
-- passe a ser uma decisão explícita em vez de um efeito colateral do "pode
-- ver". As regras de leitura e de escrita ficam EXATAMENTE como o script 11 já
-- definia — a única mudança de comportamento é o DELETE.
--
-- ⚠️ Se você rodar o 11 ou o 12 de novo depois deste, rode o 14 outra vez:
-- eles recriam o "Acesso por salao" com FOR ALL e o buraco volta. Políticas
-- permissivas se SOMAM (OR), então basta uma antiga sobrar para liberar tudo.

-- ------------------------------------------------------------
-- 0. Este script depende do 11
-- ------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'meu_papel')
       OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'salao_do_usuario') THEN
        RAISE EXCEPTION
            'Rode docs/sql/08_multi_login_por_salao.sql e docs/sql/11_niveis_de_acesso_e_fila.sql antes deste script.';
    END IF;
END $$;

-- ------------------------------------------------------------
-- 1. Limpa as políticas antigas
-- ------------------------------------------------------------
-- Pelo catálogo, e não por nome: as migrações usaram quatro nomes diferentes ao
-- longo do tempo ("Tenant isolation", "Public cash_registers access",
-- "User cash_registers access", "Acesso por salao") e uma sobrevivente basta
-- para reabrir o DELETE.
--
-- stock_movements e salon_members ficam FORA da lista de propósito: já nasceram
-- com políticas por comando (scripts 13 e 08) e estão corretas.
DO $$
DECLARE
    t text;
    p record;
    tabelas text[] := ARRAY[
        'business_info', 'services', 'professionals', 'clients',
        'appointments', 'leads', 'transactions', 'cash_registers',
        'professional_blocks', 'products'
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            FOR p IN
                SELECT policyname FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t
            LOOP
                EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. business_info — staff lê, só o dono mexe
-- ------------------------------------------------------------
CREATE POLICY "Leitura por salao" ON public.business_info
    FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Insercao do dono" ON public.business_info
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Alteracao do dono" ON public.business_info
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
           WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Exclusao do dono" ON public.business_info
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 3. services — staff lê (precisa para agendar), só o dono mexe
-- ------------------------------------------------------------
CREATE POLICY "Leitura por salao" ON public.services
    FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Insercao do dono" ON public.services
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Alteracao do dono" ON public.services
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
           WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Exclusao do dono" ON public.services
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 4. professionals — staff vê só a própria linha (a comissão mora aqui)
-- ------------------------------------------------------------
CREATE POLICY "Leitura por salao" ON public.professionals
    FOR SELECT USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR id = public.meu_profissional())
    );
CREATE POLICY "Insercao do dono" ON public.professionals
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Alteracao do dono" ON public.professionals
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
           WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Exclusao do dono" ON public.professionals
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 5. appointments — staff vê e mexe só na própria agenda
-- ------------------------------------------------------------
-- Aqui o DELETE continua liberado para o staff DENTRO da agenda dele: apagar o
-- próprio horário é a mesma operação que ele já podia fazer por UPDATE, e é
-- rotina de balcão (cliente desmarcou na porta).
CREATE POLICY "Leitura da propria agenda" ON public.appointments
    FOR SELECT USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );
CREATE POLICY "Insercao na propria agenda" ON public.appointments
    FOR INSERT WITH CHECK (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );
CREATE POLICY "Alteracao da propria agenda" ON public.appointments
    FOR UPDATE USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    ) WITH CHECK (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );
CREATE POLICY "Exclusao da propria agenda" ON public.appointments
    FOR DELETE USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );

-- ------------------------------------------------------------
-- 6. clients — staff vê e edita quem ELE atendeu; apagar é do dono
-- ------------------------------------------------------------
-- Cadastrar cliente novo continua liberado (encaixe que chegou sem hora).
-- Apagar não: a ficha do cliente é do salão e carrega o histórico inteiro.
CREATE POLICY "Leitura dos proprios clientes" ON public.clients
    FOR SELECT USING (
        user_id = public.salao_do_usuario()
        AND (
            public.meu_papel() = 'owner'
            OR EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a."clientId" = clients.id
                  AND a."profId" = public.meu_profissional()
            )
        )
    );
CREATE POLICY "Insercao por salao" ON public.clients
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario());
CREATE POLICY "Alteracao dos proprios clientes" ON public.clients
    FOR UPDATE USING (
        user_id = public.salao_do_usuario()
        AND (
            public.meu_papel() = 'owner'
            OR EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a."clientId" = clients.id
                  AND a."profId" = public.meu_profissional()
            )
        )
    ) WITH CHECK (user_id = public.salao_do_usuario());
CREATE POLICY "Exclusao do dono" ON public.clients
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 7. transactions — staff vê só o que é dele, e não escreve
-- ------------------------------------------------------------
-- O DELETE era o pior dos casos: o profissional podia apagar os próprios
-- lançamentos, ou seja, o registro da comissão que ele recebeu.
CREATE POLICY "Leitura do proprio financeiro" ON public.transactions
    FOR SELECT USING (
        user_id = public.salao_do_usuario()
        AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
    );
CREATE POLICY "Insercao do dono" ON public.transactions
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Alteracao do dono" ON public.transactions
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
           WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Exclusao do dono" ON public.transactions
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 8. leads — só o dono, em tudo
-- ------------------------------------------------------------
-- O link público grava lead por create_public_booking, que é SECURITY DEFINER
-- e não passa por aqui.
CREATE POLICY "Leitura do dono" ON public.leads
    FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Insercao do dono" ON public.leads
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Alteracao do dono" ON public.leads
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
           WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Exclusao do dono" ON public.leads
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 9. cash_registers — só o dono, em tudo (se a tabela existir)
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'cash_registers'
    ) THEN
        CREATE POLICY "Leitura do dono" ON public.cash_registers
            FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
        CREATE POLICY "Insercao do dono" ON public.cash_registers
            FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
        CREATE POLICY "Alteracao do dono" ON public.cash_registers
            FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
                   WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
        CREATE POLICY "Exclusao do dono" ON public.cash_registers
            FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
    END IF;
END $$;

-- ------------------------------------------------------------
-- 10. professional_blocks — staff mexe na própria folga
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'professional_blocks'
    ) THEN
        CREATE POLICY "Leitura das proprias folgas" ON public.professional_blocks
            FOR SELECT USING (
                user_id = public.salao_do_usuario()
                AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
            );
        CREATE POLICY "Insercao das proprias folgas" ON public.professional_blocks
            FOR INSERT WITH CHECK (
                user_id = public.salao_do_usuario()
                AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
            );
        CREATE POLICY "Alteracao das proprias folgas" ON public.professional_blocks
            FOR UPDATE USING (
                user_id = public.salao_do_usuario()
                AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
            ) WITH CHECK (
                user_id = public.salao_do_usuario()
                AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
            );
        CREATE POLICY "Exclusao das proprias folgas" ON public.professional_blocks
            FOR DELETE USING (
                user_id = public.salao_do_usuario()
                AND (public.meu_papel() = 'owner' OR "profId" = public.meu_profissional())
            );
    END IF;
END $$;

-- ------------------------------------------------------------
-- 11. products — staff lê (precisa para vender), só o dono mexe
-- ------------------------------------------------------------
-- A quantidade em estoque continua mudando por registrar_movimento_estoque()
-- (docs/sql/13), que é SECURITY DEFINER e confere o salão por conta própria —
-- é assim que o profissional vende sem ter escrita em products.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'products'
    ) THEN
        CREATE POLICY "Leitura por salao" ON public.products
            FOR SELECT USING (user_id = public.salao_do_usuario());
        CREATE POLICY "Insercao do dono" ON public.products
            FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
        CREATE POLICY "Alteracao do dono" ON public.products
            FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
                   WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
        CREATE POLICY "Exclusao do dono" ON public.products
            FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
    END IF;
END $$;

-- ------------------------------------------------------------
-- 12. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- 1. Não pode sobrar NENHUMA política FOR ALL nas tabelas do salão.
--    Tem que devolver zero linhas:
--
--      SELECT tablename, policyname
--      FROM pg_policies
--      WHERE schemaname = 'public' AND cmd = 'ALL'
--        AND tablename IN ('business_info','services','professionals','clients',
--                          'appointments','leads','transactions','cash_registers',
--                          'professional_blocks','products');
--
-- 2. Toda política de DELETE tem que citar o papel, menos as duas que são do
--    profissional por desenho (a própria agenda e a própria folga):
--
--      SELECT tablename, policyname, qual
--      FROM pg_policies
--      WHERE schemaname = 'public' AND cmd = 'DELETE'
--      ORDER BY tablename;
--
--    Esperado: appointments e professional_blocks com meu_profissional(); todas
--    as outras com meu_papel() = 'owner'.
--
-- 3. Teste de verdade, com o login de um profissional ('staff'), no console do
--    navegador dele. Antes deste script a primeira linha apagava o catálogo;
--    agora as duas têm que devolver zero linhas afetadas:
--
--      await supabase.from('services').delete().neq('id', '')
--      await supabase.from('transactions').delete().neq('id', '')
