-- ============================================================
-- APLICAÇÃO REAL — patch da Fase E (script 23, seção 8) em finalizar_venda
-- Só colar isto depois do ensaio (docs/23_crediario_2_patch_ENSAIO.sql) ter
-- dado 100% certo. Este patch NÃO é re-executável: uma vez aplicado com
-- sucesso, os textos-âncora somem e uma segunda tentativa lança
-- "RAISE EXCEPTION 'Patch (...) nao encontrou...'" — sinal de que já rodou,
-- não de erro.
-- ============================================================

-- ============================================================
-- 8. A ALTERAÇÃO EM finalizar_venda (texto idêntico ao de docs/23_crediario.sql)
-- ============================================================
--
-- Feita FORA da transação acima, e por substituição sobre a definição que está
-- rodando — nunca a partir de uma cópia deste arquivo. Três mudanças:
--
--   a) a trava que recusava saldo a prazo vira a criação do crediário;
--   b) o status da venda deixa de ser sempre 'paid';
--   c) o retorno passa a informar o id da conta a receber.
--
-- Cada substituição confere se casou. Se o texto vigente não bater com o
-- esperado — porque alguém alterou a função por fora —, o bloco levanta erro e
-- NÃO grava nada, em vez de aplicar meia alteração.
-- ⚠️ O corpo da função no banco usa CRLF, não LF. Por isso NENHUMA âncora
-- abaixo atravessa uma quebra de linha: todas são trechos de uma linha só. Um
-- bloco multi-linha escrito com LF simplesmente não casaria, o patch não
-- encontraria nada e o script morreria no primeiro RAISE — que é o
-- comportamento seguro, mas não entregaria a fase. Foi verificado antes de
-- escrever isto:
--
--     SELECT position(chr(13) in pg_get_functiondef(
--         'public.finalizar_venda(jsonb)'::regprocedure)) > 0;   -- true
--
-- Cada âncora também foi conferida como ÚNICA no corpo. `replace` troca todas
-- as ocorrências; com duas, o patch estragaria a segunda em silêncio.
DO $patch$
DECLARE
    v_def   text;
    v_antes text;
BEGIN
    v_def := pg_get_functiondef('public.finalizar_venda(jsonb)'::regprocedure);

    -- --- (a) a trava vira a regra do crediário --------------------------
    -- Duas trocas de uma linha cada, em vez de remover o bloco: a condição
    -- deixa de recusar QUALQUER saldo e passa a recusar só o saldo sem cliente
    -- — não há de quem cobrar uma dívida anônima.
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

    -- --- (b) o status --------------------------------------------------
    -- 'paid' quando não sobrou nada; 'partial' quando entrou alguma coisa e
    -- sobrou saldo; 'on_credit' quando não entrou nada. São os três status que
    -- a aba Vendas já sabia filtrar desde a Fase A.
    v_antes := v_def;
    v_def := replace(v_def,
        'v_origem, ''paid'', v_sub_serv, v_sub_prod, v_subtotal,',
        'v_origem, CASE WHEN v_receber <= 0 THEN ''paid'' WHEN v_recebido > 0 THEN ''partial'' ELSE ''on_credit'' END, v_sub_serv, v_sub_prod, v_subtotal,');
    IF v_def = v_antes THEN
        RAISE EXCEPTION 'Patch (b) nao encontrou o status fixo da venda. Nada foi alterado.';
    END IF;

    -- --- (c) criar a dívida antes de devolver ---------------------------
    -- Ancorado no RETURN final. A dívida é criada DEPOIS de a venda existir,
    -- porque ela aponta para a venda — e dentro da mesma transação, para que
    -- uma falha aqui desfaça a venda inteira em vez de deixar um saldo a prazo
    -- sem parcela nenhuma.
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

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- 1. A função continua única e com um argumento — a conferência que o script
--    17 pede sempre que se mexe numa RPC:
--
--      SELECT p.oid::regprocedure, p.pronargs FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'finalizar_venda';
--
--    Esperado: uma linha, `pronargs = 1`.
--
-- 2. Os três patches entraram:
--
--      SELECT pg_get_functiondef(p.oid) LIKE '%gerar_crediario%'        AS tem_crediario,
--             pg_get_functiondef(p.oid) LIKE '%on_credit%'              AS tem_status,
--             pg_get_functiondef(p.oid) LIKE '%chega na Fase E%'        AS trava_saiu_nao
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'finalizar_venda';
--
--    ⚠️ `p.` em TUDO que sai de pg_proc. Sem o prefixo, `oid` e ambiguo — ele
--    existe em pg_proc E em pg_namespace — e a consulta morre com
--    "42702: column reference \"oid\" is ambiguous" sem conferir nada.
--
--    Esperado: true, true, **false**.
--
-- 3. **A venda à vista não pode ter regredido.** É a conferência que importa:
--    conclua uma venda normal, à vista, pelo checkout. Se ela falhar, o patch
--    quebrou a função e o caminho de volta é reexecutar `15_finalizacao_venda.sql`.
--
-- 4. Uma venda a prazo gera dívida com parcelas que somam o saldo:
--
--      SELECT r.total_amount, r.open_amount, count(i.*) AS parcelas,
--             sum(i.amount) AS soma_parcelas
--      FROM receivables r JOIN receivable_installments i ON i.receivable_id = r.id
--      GROUP BY r.id, r.total_amount, r.open_amount;
--
--    `soma_parcelas` tem que ser igual a `total_amount`, sempre.
--
-- 5. E ela NÃO entra no faturamento no dia da venda:
--
--      SELECT s.sale_number, s.total, s.amount_received, s.amount_receivable,
--             (SELECT COALESCE(sum(t.amount), 0) FROM transactions t WHERE t.sale_id = s.id) AS lancado
--      FROM sales s WHERE s.amount_receivable > 0;
--
--    `lancado` tem que ser igual a `amount_received`, e não ao total.
--
-- 6. As três tabelas com RLS e só política de leitura:
--
--      SELECT tablename, cmd, policyname FROM pg_policies
--      WHERE tablename IN ('receivables','receivable_installments','receivable_payments');
--
-- 7. As permissões, conferidas no BANCO (lição do script 22):
--
--      SELECT p.proname,
--             has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname IN ('gerar_crediario', 'receber_crediario');
--
--    Esperado:
--      gerar_crediario    -> anon false, autenticado false
--      receber_crediario  -> anon false, autenticado true
