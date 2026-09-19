-- ============================================================
-- ENSAIO — script 27 (níveis de acesso) inteiro, com staff simulado
-- Cole e execute no SQL Editor do Supabase da Alabama.
-- ============================================================
--
-- PRÉ-REQUISITO: scripts 14 a 26 já aplicados de verdade (finalizar_venda
-- vem do 15 + patch do 23; resgatar_fidelidade vem do 25). Rodar
-- docs/diagnostico_vendas.sql antes para confirmar.
--
-- Tudo aqui roda dentro de UMA transação e termina em ROLLBACK: as políticas,
-- o patch nas duas RPCs e o vínculo de staff temporário são todos desfeitos.
-- Reproduz o roteiro já validado no clone (AUDITORIA_FASE_H.md, seção 6). Se
-- bater com o esperado em cada teste, a aplicação real é colar
-- docs/27_niveis_de_acesso.sql sem alterar nada.
--
-- ⚠️ ANTES DESTE ARQUIVO, RODE ISTO SOZINHO, NUMA EXECUÇÃO SEPARADA:
--
--     CREATE TABLE IF NOT EXISTS public._backup_funcoes (
--         id serial PRIMARY KEY, nome text, def text, quando timestamptz DEFAULT now()
--     );
--
-- O SQL Editor do Supabase ANALISA TODOS OS COMANDOS DO SCRIPT ANTES DE
-- EXECUTAR O PRIMEIRO. Uma tabela criada aqui dentro ainda não existe no
-- momento dessa análise, então o `INSERT INTO public._backup_funcoes` mais
-- abaixo falha com
--
--     42P01: relation "public._backup_funcoes" does not exist
--
-- mesmo com o CREATE TABLE algumas linhas acima dele. O CREATE continua no
-- corpo do script (é idempotente, e o script 27 real também o traz) — rodá-lo
-- antes só garante que a tabela já exista quando a análise acontecer.
--
-- A mesma armadilha vale para o script 27 real e para QUALQUER script destes
-- que crie uma tabela e a use em seguida.

BEGIN;

-- ------------------------------------------------------------
-- 0. Texto original de docs/27_niveis_de_acesso.sql, seções 1 a 6
-- ------------------------------------------------------------

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS sold_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sales.sold_by IS
    'Login que concluiu a venda. professional_id e quem atende; este e quem operou.';

DROP POLICY IF EXISTS "Vendas: proprietario le" ON public.sales;
DROP POLICY IF EXISTS "Vendas: equipe le" ON public.sales;
CREATE POLICY "Vendas: equipe le" ON public.sales
    FOR SELECT USING (user_id = public.salao_do_usuario());

DROP POLICY IF EXISTS "Itens de venda: proprietario le" ON public.sale_items;
DROP POLICY IF EXISTS "Itens de venda: equipe le" ON public.sale_items;
CREATE POLICY "Itens de venda: equipe le" ON public.sale_items
    FOR SELECT USING (user_id = public.salao_do_usuario());

DROP POLICY IF EXISTS "Pagamentos de venda: proprietario le" ON public.sale_payments;
DROP POLICY IF EXISTS "Pagamentos de venda: equipe le" ON public.sale_payments;
CREATE POLICY "Pagamentos de venda: equipe le" ON public.sale_payments
    FOR SELECT USING (user_id = public.salao_do_usuario());

DROP POLICY IF EXISTS "Fidelidade: acesso do dono" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: equipe le o programa" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: dono cria o programa" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: dono altera o programa" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: dono apaga o programa" ON public.loyalty_programs;

CREATE POLICY "Fidelidade: equipe le o programa" ON public.loyalty_programs
    FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Fidelidade: dono cria o programa" ON public.loyalty_programs
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Fidelidade: dono altera o programa" ON public.loyalty_programs
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
             WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Fidelidade: dono apaga o programa" ON public.loyalty_programs
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

DROP POLICY IF EXISTS "Fidelidade: dono le o razao" ON public.loyalty_movements;
DROP POLICY IF EXISTS "Fidelidade: equipe le o razao" ON public.loyalty_movements;
CREATE POLICY "Fidelidade: equipe le o razao" ON public.loyalty_movements
    FOR SELECT USING (user_id = public.salao_do_usuario());

CREATE TABLE IF NOT EXISTS public._backup_funcoes (
    id serial PRIMARY KEY, nome text, def text, quando timestamptz DEFAULT now()
);

INSERT INTO public._backup_funcoes (nome, def)
SELECT 'finalizar_venda_antes_niveis_de_acesso', pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'finalizar_venda';

INSERT INTO public._backup_funcoes (nome, def)
SELECT 'resgatar_fidelidade_antes_niveis_de_acesso', pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'resgatar_fidelidade';

DO $patch$
DECLARE
    d text;
    a text;
    b text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO d
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'finalizar_venda';

    IF d IS NULL THEN
        RAISE EXCEPTION 'finalizar_venda nao existe: rode antes o script 15.';
    END IF;

    IF position('Fase I (niveis de acesso)' in d) > 0 THEN
        RAISE NOTICE 'finalizar_venda ja tem a regra de niveis de acesso. Nada a fazer.';
        RETURN;
    END IF;

    a := '    IF public.meu_papel() <> ''owner'' THEN' || chr(13) || chr(10) ||
         '        RAISE EXCEPTION ''Somente o proprietario pode concluir vendas nesta versao.''' || chr(13) || chr(10) ||
         '            USING ERRCODE = ''42501'';' || chr(13) || chr(10) ||
         '    END IF;';

    IF position(a in d) = 0 THEN
        RAISE EXCEPTION 'Ancora do papel nao encontrada. Nada foi alterado.';
    END IF;

    b := '    -- Fase I (niveis de acesso): o profissional TAMBEM conclui venda.' || chr(13) || chr(10) ||
         '    -- O que ele nao pode e fechar o atendimento de OUTRO: venda de balcao' || chr(13) || chr(10) ||
         '    -- e livre, mas a que nasce de um agendamento so sai pelo dono ou por' || chr(13) || chr(10) ||
         '    -- quem vai fazer o corte.' || chr(13) || chr(10) ||
         '    IF public.meu_papel() <> ''owner''' || chr(13) || chr(10) ||
         '       AND NULLIF(TRIM(COALESCE(p_venda->>''appointmentId'', '''')), '''') IS NOT NULL' || chr(13) || chr(10) ||
         '       AND NOT EXISTS (' || chr(13) || chr(10) ||
         '           SELECT 1 FROM appointments a' || chr(13) || chr(10) ||
         '            WHERE a.id = NULLIF(TRIM(p_venda->>''appointmentId''), '''')' || chr(13) || chr(10) ||
         '              AND a.user_id = v_salao' || chr(13) || chr(10) ||
         '              AND a."profId" = public.meu_profissional()' || chr(13) || chr(10) ||
         '       ) THEN' || chr(13) || chr(10) ||
         '        RAISE EXCEPTION ''Este atendimento e de outro profissional.''' || chr(13) || chr(10) ||
         '            USING ERRCODE = ''42501'';' || chr(13) || chr(10) ||
         '    END IF;';

    d := replace(d, a, b);

    a := '        notes, idempotency_key, sold_at';
    IF position(a in d) = 0 THEN
        RAISE EXCEPTION 'Ancora das colunas de sales nao encontrada. Nada foi alterado.';
    END IF;
    d := replace(d, a, '        notes, idempotency_key, sold_at, sold_by');

    a := '        NULLIF(TRIM(COALESCE(p_venda->>''notes'', '''')), ''''), v_chave, v_agora';
    IF position(a in d) = 0 THEN
        RAISE EXCEPTION 'Ancora dos valores de sales nao encontrada. Nada foi alterado.';
    END IF;
    d := replace(d, a, '        NULLIF(TRIM(COALESCE(p_venda->>''notes'', '''')), ''''), v_chave, v_agora, auth.uid()');

    EXECUTE d;
END $patch$;

DO $patch$
DECLARE d text; a text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO d
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'resgatar_fidelidade';

    IF d IS NULL THEN
        RAISE EXCEPTION 'resgatar_fidelidade nao existe: rode antes o script 25.';
    END IF;

    a := '    IF public.meu_papel() <> ''owner'' THEN' || chr(13) || chr(10) ||
         '        RAISE EXCEPTION ''Somente o proprietario pode resgatar beneficio de fidelidade.'';' || chr(13) || chr(10) ||
         '    END IF;';

    IF position(a in d) = 0 THEN
        RAISE NOTICE 'A trava de dono ja saiu de resgatar_fidelidade. Nada a fazer.';
        RETURN;
    END IF;

    d := replace(d, a,
         '    -- Fase I (niveis de acesso): a equipe tambem resgata. O recorte de' || chr(13) || chr(10) ||
         '    -- salao acima continua sendo a trava real.');

    EXECUTE d;
END $patch$;

-- ------------------------------------------------------------
-- 1. Conferência de catálogo (igual à seção CONFERENCIA do script 27)
-- ------------------------------------------------------------
SELECT
  (SELECT position('Fase I (niveis de acesso)' in pg_get_functiondef(p.oid)) > 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='finalizar_venda') AS venda_liberada,
  (SELECT position('Somente o proprietario pode resgatar' in pg_get_functiondef(p.oid)) = 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='resgatar_fidelidade') AS resgate_liberado;
-- Esperado: true, true

-- ------------------------------------------------------------
-- 2. Vínculo de staff TEMPORÁRIO — usa o mesmo login do dono, mas com o
--    papel trocado para 'staff' dentro desta transação (desfeito no ROLLBACK)
-- ------------------------------------------------------------
DO $$
DECLARE
    v_user_dono uuid;
    v_prof_id   text;
BEGIN
    SELECT user_id INTO v_user_dono FROM business_info ORDER BY created_at LIMIT 1;
    SELECT id INTO v_prof_id FROM professionals WHERE user_id = v_user_dono ORDER BY name LIMIT 1;

    IF v_prof_id IS NULL THEN
        RAISE EXCEPTION 'ENSAIO: nao ha profissional cadastrado no salao para simular o staff.';
    END IF;

    INSERT INTO salon_members (user_id, salon_id, role, professional_id)
    VALUES (v_user_dono, v_user_dono, 'staff', v_prof_id)
    ON CONFLICT (user_id) DO UPDATE
        SET role = 'staff', professional_id = EXCLUDED.professional_id;
END $$;

-- Assume esse login (agora staff) para o resto do ensaio
SELECT set_config(
    'request.jwt.claims',
    json_build_object('sub', (SELECT user_id::text FROM business_info ORDER BY created_at LIMIT 1), 'role', 'authenticated')::text,
    true
);
SET LOCAL ROLE authenticated;

SELECT public.meu_papel() AS papel_atual, public.meu_profissional() AS profissional_atual;
-- Esperado: 'staff', com o id do profissional escolhido acima

-- ------------------------------------------------------------
-- 3. O que o staff DEVE ver
-- ------------------------------------------------------------
SELECT count(*) AS vendas_visiveis FROM sales;         -- esperado: todas as vendas do salão
SELECT count(*) AS fidelidade_visivel FROM loyalty_programs;  -- esperado: 1 (se o programa existir)

-- ------------------------------------------------------------
-- 4. O que o staff NÃO deve ver
-- ------------------------------------------------------------
SELECT count(*) AS caixa_visivel FROM cash_registers;   -- esperado: 0
SELECT count(*) AS crediario_visivel FROM receivables;  -- esperado: 0

-- ------------------------------------------------------------
-- 5. Staff completa uma venda de balcão
-- ------------------------------------------------------------
SELECT public.finalizar_venda(jsonb_build_object(
    'idempotencyKey', 'ensaio-staff-balcao-' || gen_random_uuid()::text,
    'competenceDate', to_char(current_date, 'YYYY-MM-DD'),
    'subtotalServices', 40, 'subtotalProducts', 0, 'subtotal', 40,
    'discountAmount', 0, 'surchargeAmount', 0, 'total', 40,
    'amountReceived', 40, 'changeAmount', 0,
    'items', jsonb_build_array(jsonb_build_object(
        'itemType', 'service', 'serviceId', null, 'itemName', 'Ensaio - venda do staff',
        'quantity', 1, 'unitPrice', 40, 'grossAmount', 40,
        'discountAmount', 0, 'surchargeAmount', 0, 'netAmount', 40)),
    'payments', jsonb_build_array(jsonb_build_object('paymentMethod', 'pix', 'amount', 40))
)) AS venda_do_staff;

SELECT sale_number, sold_by FROM sales WHERE idempotency_key LIKE 'ensaio-staff-balcao-%';
-- Esperado: sold_by = o uid simulado acima (o mesmo do dono, agora agindo como staff)

-- ------------------------------------------------------------
-- 6. Staff tenta fechar o atendimento DE OUTRO profissional — precisa barrar
-- ------------------------------------------------------------
DO $$
DECLARE
    v_salao        uuid;
    v_prof_atual   text;
    v_outro_prof   text;
    v_appt_teste   text;
BEGIN
    SELECT user_id INTO v_salao FROM business_info ORDER BY created_at LIMIT 1;
    v_prof_atual := public.meu_profissional();

    SELECT id INTO v_outro_prof FROM professionals
    WHERE user_id = v_salao AND id <> v_prof_atual LIMIT 1;

    IF v_outro_prof IS NULL THEN
        RAISE NOTICE 'ENSAIO: so ha um profissional cadastrado - teste do bloqueio entre profissionais pulado.';
        RETURN;
    END IF;

    SELECT id INTO v_appt_teste FROM appointments
    WHERE user_id = v_salao AND "profId" = v_outro_prof
      AND status NOT IN ('cancelled', 'done')
    LIMIT 1;

    IF v_appt_teste IS NULL THEN
        RAISE NOTICE 'ENSAIO: sem atendimento em aberto de outro profissional - teste pulado.';
        RETURN;
    END IF;

    BEGIN
        PERFORM public.finalizar_venda(jsonb_build_object(
            'idempotencyKey', 'ensaio-staff-outro-' || gen_random_uuid()::text,
            'appointmentId', v_appt_teste,
            'competenceDate', to_char(current_date, 'YYYY-MM-DD'),
            'subtotalServices', 40, 'subtotalProducts', 0, 'subtotal', 40,
            'discountAmount', 0, 'surchargeAmount', 0, 'total', 40,
            'amountReceived', 40, 'changeAmount', 0,
            'items', jsonb_build_array(jsonb_build_object(
                'itemType', 'service', 'serviceId', null, 'itemName', 'Ensaio - atendimento de outro',
                'quantity', 1, 'unitPrice', 40, 'grossAmount', 40,
                'discountAmount', 0, 'surchargeAmount', 0, 'netAmount', 40)),
            'payments', jsonb_build_array(jsonb_build_object('paymentMethod', 'pix', 'amount', 40))
        ));
        RAISE EXCEPTION 'ENSAIO FALHOU: o staff conseguiu fechar o atendimento de outro profissional!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Este atendimento e de outro profissional%' THEN
            RAISE NOTICE 'ENSAIO OK: bloqueado como esperado (%).', SQLERRM;
        ELSE
            RAISE;
        END IF;
    END;
END $$;

-- ------------------------------------------------------------
-- Nada disto fica gravado — inclusive o vínculo de staff temporário:
-- ------------------------------------------------------------
ROLLBACK;
