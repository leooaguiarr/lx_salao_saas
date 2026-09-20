-- ============================================================
-- CORRECAO: `receber_crediario` gravava um `source` que a constraint recusa
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O BUG
--
-- `docs/sql/23_crediario.sql` criou `receber_crediario()`, que grava uma linha
-- em `transactions` com `source = 'receivable'`. Mas a constraint
-- `transactions_source_check` (criada em `docs/sql/14_vendas_base.sql`) só
-- aceita 'manual', 'appointment', 'stock', 'sale', 'credit' e 'legacy'.
--
-- Resultado: TODO recebimento de parcela falhava com
--   new row for relation "transactions" violates check constraint
--   "transactions_source_check"
-- Como a gravacao acontece dentro da mesma transacao do recebimento, nada
-- ficava parcialmente gravado — mas nenhuma parcela conseguia ser quitada.
-- Encontrado ao validar o checkpoint de tela da Fase E (08/09/2026), na
-- primeira tentativa real de receber uma parcela.
--
-- A CORRECAO
--
-- 'credit' ja era um valor aceito pela constraint desde a Fase A e nunca
-- tinha sido usado — reservado para exatamente este caso (ver o comentario de
-- `transactions.source` em `docs/sql/14_vendas_base.sql`). Recria a funcao
-- trocando o literal, sem tocar na constraint nem em nenhuma outra tabela.
-- Nenhum registro anterior usa 'receivable', porque nenhum recebimento chegou
-- a se gravar — não ha dado velho para migrar.
--
-- Esta correcao SUBSTITUI A FUNCAO INTEIRA a partir deste arquivo, e nao por
-- patch de texto sobre o que esta rodando: `receber_crediario` foi criada por
-- inteiro no script 23 (nao e um patch sobre `finalizar_venda`), entao
-- recria-la aqui e seguro e nao corre o risco descrito no script 17.

BEGIN;

CREATE OR REPLACE FUNCTION public.receber_crediario(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao       uuid;
    v_parcela     record;
    v_conta       record;
    v_pag         jsonb;
    v_metodo      text;
    v_valor       numeric(14,2);
    v_entregue    numeric(14,2);
    v_troco       numeric(14,2);
    v_total       numeric(14,2) := 0;
    v_chave       text;
    v_caixa       text;
    v_competencia date;
    v_agora       timestamptz := now();
    v_seq         integer := 0;
    v_sufixo      text;
    v_tr_id       text;
    v_ja          record;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.';
    END IF;

    -- Mesma regra da venda: so o dono recebe. Cobrar divida mexe no caixa.
    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietario pode receber crediario.';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_payload->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Recebimento sem chave de idempotencia.';
    END IF;

    -- Repetiu a chave (F5, clique duplo, rede instavel): devolve o que ja
    -- aconteceu, sem receber de novo.
    SELECT receivable_id INTO v_ja FROM receivable_payments
    WHERE user_id = v_salao AND idempotency_key = v_chave LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'repetida', true,
                                  'receivableId', v_ja.receivable_id);
    END IF;

    SELECT * INTO v_parcela FROM receivable_installments
    WHERE id = p_payload->>'installmentId' AND user_id = v_salao
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parcela nao encontrada neste salao.';
    END IF;
    IF v_parcela.status <> 'open' THEN
        RAISE EXCEPTION 'Esta parcela ja esta %.', v_parcela.status;
    END IF;

    SELECT * INTO v_conta FROM receivables
    WHERE id = v_parcela.receivable_id AND user_id = v_salao
    FOR UPDATE;

    v_competencia := COALESCE((p_payload->>'competenceDate')::date, CURRENT_DATE);
    v_sufixo := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

    IF jsonb_typeof(p_payload->'payments') <> 'array'
       OR jsonb_array_length(p_payload->'payments') = 0 THEN
        RAISE EXCEPTION 'Informe ao menos uma forma de pagamento.';
    END IF;

    SELECT id INTO v_caixa FROM cash_registers
    WHERE user_id = v_salao AND status = 'open'
    ORDER BY "dateOpened" DESC LIMIT 1;

    FOR v_pag IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
        v_seq    := v_seq + 1;
        v_metodo := v_pag->>'paymentMethod';
        v_valor  := ROUND(COALESCE((v_pag->>'amount')::numeric, 0), 2);

        IF v_metodo IS NULL
           OR v_metodo NOT IN ('pix', 'cash', 'debit_card', 'credit_card', 'other') THEN
            RAISE EXCEPTION 'Forma de pagamento invalida: %', COALESCE(v_metodo, 'nula');
        END IF;
        IF v_valor <= 0 THEN
            RAISE EXCEPTION 'Valor do recebimento precisa ser maior que zero.';
        END IF;

        IF v_metodo = 'cash' THEN
            v_entregue := ROUND(COALESCE((v_pag->>'cashReceived')::numeric, v_valor), 2);
            IF v_entregue < v_valor THEN
                RAISE EXCEPTION 'Valor entregue em dinheiro e menor que o recebimento.';
            END IF;
            v_troco := v_entregue - v_valor;
        ELSE
            v_entregue := NULL;
            v_troco := 0;
        END IF;

        v_total := v_total + v_valor;
        v_tr_id := 'tr-' || v_sufixo || '-' || v_seq;

        INSERT INTO receivable_payments (
            id, user_id, receivable_id, installment_id, sale_id,
            payment_method, amount, cash_received, change_amount,
            cash_register_id, transaction_id, idempotency_key,
            received_at, competence_date, created_by
        ) VALUES (
            'rp-' || v_sufixo || '-' || v_seq, v_salao, v_conta.id, v_parcela.id, v_conta.sale_id,
            v_metodo, v_valor, v_entregue, v_troco,
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, v_tr_id,
            -- A chave marca o recebimento inteiro, entao so a primeira linha a
            -- carrega: o UNIQUE e o que impede a segunda tentativa de entrar.
            CASE WHEN v_seq = 1 THEN v_chave END,
            v_agora, v_competencia, auth.uid()
        );

        -- O dinheiro entra no Financeiro AGORA, na data de hoje — nao na data
        -- da venda. A competencia da venda ja foi registrada la atras; o que se
        -- registra aqui e o caixa recebendo.
        --
        -- CORRECAO: era 'receivable', que `transactions_source_check` recusa.
        -- 'credit' e o valor que a constraint reserva para isto desde a Fase A.
        INSERT INTO transactions (
            id, user_id, type, amount, date, "registradoEm", description,
            category, "paymentMethod", "profId", status,
            "clientId", sale_id, cash_register_id, source
        ) VALUES (
            v_tr_id, v_salao, 'income', v_valor,
            to_char(v_competencia, 'YYYY-MM-DD'),
            to_char(v_agora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'Crediario - parcela ' || v_parcela.number || COALESCE(' - ' || v_conta.client_name, ''),
            'Crediário', v_metodo, NULL,
            CASE WHEN v_metodo = 'cash' AND v_caixa IS NULL THEN 'pending' ELSE 'completed' END,
            v_conta.client_id, v_conta.sale_id,
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, 'credit'
        );
    END LOOP;

    v_total := ROUND(v_total, 2);

    -- Criterio de aceite: nao da para receber acima do saldo. Sem isto, o
    -- troco de um pagamento a maior sairia da gaveta sem nunca ter entrado.
    IF v_total > v_parcela.open_amount THEN
        RAISE EXCEPTION 'O recebimento (%) passa do saldo da parcela (%).',
            v_total, v_parcela.open_amount;
    END IF;

    UPDATE receivable_installments
    SET paid_amount = paid_amount + v_total,
        open_amount = open_amount - v_total,
        status  = CASE WHEN open_amount - v_total <= 0 THEN 'paid' ELSE 'open' END,
        paid_at = CASE WHEN open_amount - v_total <= 0 THEN v_agora ELSE paid_at END
    WHERE id = v_parcela.id;

    UPDATE receivables
    SET paid_amount = paid_amount + v_total,
        open_amount = open_amount - v_total,
        status     = CASE WHEN open_amount - v_total <= 0 THEN 'settled' ELSE 'open' END,
        settled_at = CASE WHEN open_amount - v_total <= 0 THEN v_agora ELSE settled_at END
    WHERE id = v_conta.id;

    -- A venda deixa de ser "a prazo" quando a divida fecha.
    UPDATE sales
    SET status = CASE WHEN (SELECT open_amount FROM receivables WHERE id = v_conta.id) <= 0
                      THEN 'paid' ELSE status END
    WHERE id = v_conta.sale_id AND user_id = v_salao;

    RETURN jsonb_build_object(
        'ok', true,
        'repetida', false,
        'receivableId', v_conta.id,
        'installmentId', v_parcela.id,
        'recebido', v_total,
        'saldoDaParcela', (SELECT open_amount FROM receivable_installments WHERE id = v_parcela.id),
        'saldoDaConta',   (SELECT open_amount FROM receivables WHERE id = v_conta.id)
    );
END;
$$;

-- Grants inalterados em relacao ao script 23 — repetidos aqui porque
-- CREATE OR REPLACE nao apaga permissoes existentes, mas reafirmar custa
-- nada e evita depender de memoria de qual script rodou por ultimo.
REVOKE EXECUTE ON FUNCTION public.receber_crediario(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.receber_crediario(jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA
-- ============================================================
--
-- A funcao nao grava mais 'receivable'. A conferencia tem que olhar o que a
-- funcao GRAVA, e nao se a palavra aparece em algum lugar do corpo:
--
--   SELECT (p.prosrc LIKE '%v_caixa END, ''credit''%')     AS grava_credit_ok,
--          (p.prosrc LIKE '%v_caixa END, ''receivable''%') AS ainda_grava_receivable
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'receber_crediario';
--
-- Tem que devolver true e false. A ancora `v_caixa END, ` e o ultimo argumento
-- antes do `source` no INSERT em `transactions` — e o proprio valor gravado.
--
-- ⚠️ DUAS CONFERENCIAS ANTERIORES DAVAM FALSO POSITIVO, as duas por procurarem
-- a palavra solta em `prosrc`:
--
--   `prosrc ~ 'receivable'`        — casa com `receivable_payments`,
--                                    `receivables`, `receivable_id` e
--                                    `receivable_installments`, que sao nomes
--                                    de tabela e coluna, nao o bug.
--   `prosrc LIKE '%''receivable''%'` — mesmo com as aspas, casa com o
--                                    comentario "CORRECAO: era 'receivable'"
--                                    algumas linhas acima do INSERT: `prosrc`
--                                    guarda o corpo COM os comentarios, entao
--                                    a explicacao da correcao e lida como se
--                                    fosse o bug.
--
-- Nos dois casos o resultado e TRUE numa funcao corrigida, e quem rodasse
-- concluiria que a correcao falhou — indo consertar o que ja estava certo.
--
-- So authenticated executa, nem PUBLIC nem anon:
--
--   SELECT has_function_privilege('anon', 'public.receber_crediario(jsonb)', 'EXECUTE') AS anon_pode,
--          has_function_privilege('authenticated', 'public.receber_crediario(jsonb)', 'EXECUTE') AS dono_pode;
--
-- Tem que devolver false e true.
--
-- Depois de aplicar, teste na tela: receba uma parcela de verdade. Deve
-- aparecer "Confirmar recebimento" com sucesso, sem o erro de
-- transactions_source_check.
