-- ============================================================
-- ENSAIO — patch da Fase E (script 23, seção 8) em finalizar_venda
-- Cole e execute no SQL Editor do Supabase.
-- ============================================================
--
-- PRÉ-REQUISITO: docs/23_crediario_1_tabelas_e_rpcs.sql e
-- docs/24_corrige_source_crediario.sql já aplicados de verdade (o 24 corrige
-- o bug do `source = 'receivable'` — sem ele, o recebimento de parcela testado
-- aqui embaixo falha com "violates check constraint transactions_source_check",
-- exatamente como aconteceu no clone).
--
-- Tudo aqui roda dentro de UMA transação e termina em ROLLBACK: nada fica
-- gravado, nem o patch em finalizar_venda, nem as vendas de teste. Se o
-- resultado bater com o esperado em cada passo, a aplicação real é colar
-- docs/23_crediario_2_patch_real.sql (mesmo texto do patch, sem o
-- BEGIN/ROLLBACK do ensaio).

BEGIN;

-- Assume a identidade do dono do salão — finalizar_venda e receber_crediario
-- exigem meu_papel() = 'owner'.
--
-- ⚠️ O set_config vem AQUI, mas o SET LOCAL ROLE só DEPOIS do patch, mais
-- abaixo. Aplicar o patch é um CREATE OR REPLACE FUNCTION, e `authenticated`
-- não tem CREATE no schema `public` — só o dono do banco tem. Trocar de role
-- antes do patch faz o ensaio morrer com
--
--     42501: permission denied for schema public
--
-- no EXECUTE, sem chegar a testar nada. Os dois comandos estavam juntos aqui
-- na primeira versão deste arquivo.
SELECT set_config(
    'request.jwt.claims',
    json_build_object(
        'sub', (SELECT user_id::text FROM business_info ORDER BY created_at LIMIT 1),
        'role', 'authenticated'
    )::text,
    true
);

-- ------------------------------------------------------------
-- O patch, texto idêntico à seção 8 de docs/23_crediario.sql
-- ------------------------------------------------------------
DO $patch$
DECLARE
    v_def   text;
    v_antes text;
BEGIN
    v_def := pg_get_functiondef('public.finalizar_venda(jsonb)'::regprocedure);

    v_antes := v_def;
    v_def := replace(v_def,
        'IF v_receber <> 0 THEN',
        'IF v_receber > 0 AND v_cliente_id IS NULL THEN');
    IF v_def = v_antes THEN
        RAISE EXCEPTION 'Patch (a1) nao encontrou "IF v_receber <> 0 THEN". Nada foi alterado.';
    END IF;

    v_antes := v_def;
    v_def := replace(v_def,
        'RAISE EXCEPTION ''Faltam % para fechar a venda. O crediario chega na Fase E.'', v_receber;',
        'RAISE EXCEPTION ''Venda a prazo precisa de cliente identificado: nao ha de quem cobrar.'';');
    IF v_def = v_antes THEN
        RAISE EXCEPTION 'Patch (a2) nao encontrou a mensagem da trava. Nada foi alterado.';
    END IF;

    v_antes := v_def;
    v_def := replace(v_def,
        'v_origem, ''paid'', v_sub_serv, v_sub_prod, v_subtotal,',
        'v_origem, CASE WHEN v_receber <= 0 THEN ''paid'' WHEN v_recebido > 0 THEN ''partial'' ELSE ''on_credit'' END, v_sub_serv, v_sub_prod, v_subtotal,');
    IF v_def = v_antes THEN
        RAISE EXCEPTION 'Patch (b) nao encontrou o status fixo da venda. Nada foi alterado.';
    END IF;

    v_antes := v_def;
    v_def := replace(v_def,
        'RETURN public.venda_em_json(v_salao, v_sale_id, false);',
        'IF v_receber > 0 THEN PERFORM public.gerar_crediario(v_sale_id, p_venda->''creditPlan''); END IF; RETURN public.venda_em_json(v_salao, v_sale_id, false);');
    IF v_def = v_antes THEN
        RAISE EXCEPTION 'Patch (c) nao encontrou o RETURN final. Nada foi alterado.';
    END IF;

    EXECUTE v_def;
END;
$patch$;

-- Só agora vira o dono: o patch já foi aplicado com o role que pode criar
-- função, e os testes abaixo precisam da identidade que as RPCs exigem.
SET LOCAL ROLE authenticated;

-- Confirma que o patch entrou (esperado: true, true, false)
-- ⚠️ `p.` obrigatório em tudo que sai de pg_proc: `oid` existe em pg_proc E em
-- pg_namespace, e sem o prefixo a consulta morre com
-- "42702: column reference \"oid\" is ambiguous" antes de conferir coisa
-- alguma. Estava sem o prefixo na primeira versão deste arquivo.
SELECT pg_get_functiondef(p.oid) LIKE '%gerar_crediario%' AS tem_crediario,
       pg_get_functiondef(p.oid) LIKE '%on_credit%'       AS tem_status,
       pg_get_functiondef(p.oid) LIKE '%chega na Fase E%' AS trava_velha_ainda_presente
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'finalizar_venda';

-- ------------------------------------------------------------
-- Teste 1 — venda à vista NÃO pode ter regredido
-- ------------------------------------------------------------
SELECT public.finalizar_venda(jsonb_build_object(
    'idempotencyKey', 'ensaio-avista-' || gen_random_uuid()::text,
    'competenceDate', to_char(current_date, 'YYYY-MM-DD'),
    'subtotalServices', 50, 'subtotalProducts', 0, 'subtotal', 50,
    'discountAmount', 0, 'surchargeAmount', 0, 'total', 50,
    'amountReceived', 50, 'changeAmount', 0,
    'items', jsonb_build_array(jsonb_build_object(
        'itemType', 'service', 'serviceId', null, 'itemName', 'Ensaio - corte avista',
        'quantity', 1, 'unitPrice', 50, 'grossAmount', 50,
        'discountAmount', 0, 'surchargeAmount', 0, 'netAmount', 50)),
    'payments', jsonb_build_array(jsonb_build_object('paymentMethod', 'pix', 'amount', 50))
)) AS venda_a_vista;

-- ------------------------------------------------------------
-- Teste 2 — venda a prazo: precisa de um cliente real cadastrado no salão
-- ------------------------------------------------------------
DO $$
DECLARE
    v_salao     uuid;
    v_cliente   text;
    v_resultado jsonb;
BEGIN
    SELECT user_id INTO v_salao FROM business_info ORDER BY created_at LIMIT 1;
    SELECT id INTO v_cliente FROM clients WHERE user_id = v_salao LIMIT 1;

    IF v_cliente IS NULL THEN
        RAISE NOTICE 'ENSAIO: sem cliente cadastrado no salao - teste de venda a prazo pulado.';
        RETURN;
    END IF;

    v_resultado := public.finalizar_venda(jsonb_build_object(
        'idempotencyKey', 'ensaio-prazo-' || gen_random_uuid()::text,
        'clientId', v_cliente,
        'competenceDate', to_char(current_date, 'YYYY-MM-DD'),
        'subtotalServices', 30, 'subtotalProducts', 0, 'subtotal', 30,
        'discountAmount', 0, 'surchargeAmount', 0, 'total', 30,
        'amountReceived', 0, 'changeAmount', 0,
        'items', jsonb_build_array(jsonb_build_object(
            'itemType', 'service', 'serviceId', null, 'itemName', 'Ensaio - a prazo',
            'quantity', 1, 'unitPrice', 30, 'grossAmount', 30,
            'discountAmount', 0, 'surchargeAmount', 0, 'netAmount', 30)),
        'payments', jsonb_build_array()
    ));
    RAISE NOTICE 'ENSAIO venda a prazo: %', v_resultado;
END $$;

-- A dívida nasceu com o valor certo, e AINDA NÃO entrou no financeiro
SELECT s.sale_number, s.status, s.amount_receivable,
       r.total_amount, r.open_amount,
       (SELECT count(*) FROM receivable_installments i WHERE i.receivable_id = r.id) AS parcelas,
       (SELECT COALESCE(sum(t.amount), 0) FROM transactions t WHERE t.sale_id = s.id) AS ja_lancado_no_financeiro
FROM sales s
JOIN receivables r ON r.sale_id = s.id
WHERE s.idempotency_key LIKE 'ensaio-prazo-%';
-- Esperado: status = 'on_credit', open_amount = 30, parcelas = 1,
-- ja_lancado_no_financeiro = 0 (a dívida NÃO entra no caixa no dia da venda).

-- ------------------------------------------------------------
-- Teste 3 — recebe a parcela e confere o "source" gravado
-- ------------------------------------------------------------
-- ⚠️ Isto é o teste que faltou no clone e deixou passar o bug do script 23
-- (source = 'receivable', rejeitado pelo constraint). Se docs/24 não tiver
-- sido aplicado de verdade antes deste ensaio, este passo falha aqui.
DO $$
DECLARE
    v_salao     uuid;
    v_parcela   text;
    v_resultado jsonb;
BEGIN
    SELECT user_id INTO v_salao FROM business_info ORDER BY created_at LIMIT 1;

    SELECT i.id INTO v_parcela
    FROM receivable_installments i
    JOIN receivables r ON r.id = i.receivable_id
    JOIN sales s ON s.id = r.sale_id
    WHERE s.idempotency_key LIKE 'ensaio-prazo-%'
    LIMIT 1;

    IF v_parcela IS NULL THEN
        RAISE NOTICE 'ENSAIO: sem parcela de teste (Teste 2 deve ter sido pulado) - Teste 3 pulado.';
        RETURN;
    END IF;

    v_resultado := public.receber_crediario(jsonb_build_object(
        'installmentId', v_parcela,
        'idempotencyKey', 'ensaio-receb-' || gen_random_uuid()::text,
        'payments', jsonb_build_array(jsonb_build_object('paymentMethod', 'pix', 'amount', 30))
    ));
    RAISE NOTICE 'ENSAIO recebimento: %', v_resultado;
END $$;

SELECT source, amount, description
FROM transactions
WHERE description LIKE 'Crediario%'
ORDER BY "registradoEm" DESC
LIMIT 1;
-- ⚠️ ESPERADO: source = 'credit'. Se aparecer 'receivable', o 24 não foi
-- aplicado antes deste ensaio (ou a transação teria simplesmente falhado
-- antes de chegar aqui, com "violates check constraint").

-- ------------------------------------------------------------
-- Nada disto fica gravado:
-- ------------------------------------------------------------
ROLLBACK;
