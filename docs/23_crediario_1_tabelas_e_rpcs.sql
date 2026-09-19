-- ============================================================
-- CREDIÁRIO: CONTA A RECEBER, PARCELAS E RECEBIMENTOS (Fase E)
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTA FASE SEPARA
--
-- Até aqui o sistema só sabia de dinheiro que ENTROU. Fiado era combinado no
-- balcão e cobrado de memória — ou virava uma venda marcada como paga que
-- nunca foi paga, inflando faturamento e caixa de um dinheiro que não existe.
--
-- A Fase E separa três coisas que estavam misturadas:
--
--   VENDA        — o que foi vendido, quando, por quanto. Já existia.
--   DÍVIDA       — quanto o cliente ficou devendo, em quantas parcelas e para
--                  quando. É o que nasce aqui.
--   RECEBIMENTO  — o dinheiro entrando, na data e na forma em que entrou.
--                  Só ele alimenta o Financeiro e o caixa.
--
-- A consequência mais importante: uma venda a prazo NÃO entra no faturamento
-- nem na gaveta no dia da venda. Ela entra quando o cliente paga, e no dia em
-- que paga. `sales.amount_received` e `sales.amount_receivable` já separavam
-- isso desde a Fase A — faltava a dívida ter existência própria.
--
-- ⚠️ ESTE SCRIPT ALTERA `finalizar_venda`, e é o único que faz isso desde que
-- ela nasceu. Não havia alternativa: a trava que recusa venda a prazo mora
-- dentro dela. Mas a alteração NÃO reescreve a função a partir deste arquivo —
-- ela é aplicada por substituição de texto sobre a definição que está RODANDO
-- no banco (`pg_get_functiondef`), na seção 6. É a diferença entre editar o que
-- existe e sobrescrever com o que se imagina que existe; foi a segunda coisa
-- que derrubou o link público uma vez, e o script 17 alerta sobre ela.

BEGIN;

-- ------------------------------------------------------------
-- 1. A conta a receber
-- ------------------------------------------------------------
-- Uma por venda que deixou saldo. `sale_id` é UNIQUE: a mesma venda não gera
-- duas dívidas, nem quando a chave de idempotência é repetida.
CREATE TABLE IF NOT EXISTS public.receivables (
    id            text        PRIMARY KEY,
    user_id       uuid        NOT NULL,
    sale_id       text        NOT NULL UNIQUE,
    client_id     text,
    client_name   text,

    -- total_amount nunca muda: é a dívida como ela nasceu. paid_amount e
    -- open_amount são mantidos pelas RPCs. Guardar o saldo pronto evita que
    -- cada tela refaça a subtração e chegue a um número diferente.
    total_amount  numeric(14,2) NOT NULL CHECK (total_amount > 0),
    paid_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    open_amount   numeric(14,2) NOT NULL CHECK (open_amount >= 0),

    status        text        NOT NULL DEFAULT 'open',
    opened_at     timestamptz NOT NULL DEFAULT now(),
    settled_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT receivables_status_check CHECK (status IN ('open', 'settled', 'cancelled')),
    -- O que foi pago mais o que falta tem que dar a dívida. Sempre.
    CONSTRAINT receivables_equacao CHECK (paid_amount + open_amount = total_amount)
);

-- ------------------------------------------------------------
-- 2. As parcelas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receivable_installments (
    id            text        PRIMARY KEY,
    user_id       uuid        NOT NULL,
    receivable_id text        NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
    sale_id       text        NOT NULL,

    number        integer     NOT NULL CHECK (number > 0),
    due_date      date        NOT NULL,
    amount        numeric(14,2) NOT NULL CHECK (amount > 0),
    paid_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    open_amount   numeric(14,2) NOT NULL CHECK (open_amount >= 0),

    status        text        NOT NULL DEFAULT 'open',
    paid_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT parcela_status_check CHECK (status IN ('open', 'paid', 'cancelled')),
    CONSTRAINT parcela_equacao CHECK (paid_amount + open_amount = amount),
    CONSTRAINT parcela_unica_por_conta UNIQUE (receivable_id, number)
);

-- "Atrasada" NÃO é uma coluna. É a parcela em aberto cuja data já passou, e
-- passa a ser verdade sozinha à meia-noite. Uma coluna precisaria de alguém
-- rodando um UPDATE todo dia — e no dia em que esquecesse, a tela mentiria.
CREATE INDEX IF NOT EXISTS idx_parcela_vencimento
    ON public.receivable_installments (user_id, due_date)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_parcela_conta ON public.receivable_installments (user_id, receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_cliente ON public.receivables (user_id, client_id, status);

-- ------------------------------------------------------------
-- 3. Os recebimentos
-- ------------------------------------------------------------
-- Uma linha por dinheiro que entrou. É o extrato da dívida: sem ele, "pagou
-- R$ 30" não diz quando, como, nem em qual caixa entrou.
CREATE TABLE IF NOT EXISTS public.receivable_payments (
    id              text        PRIMARY KEY,
    user_id         uuid        NOT NULL,
    receivable_id   text        NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
    installment_id  text        REFERENCES public.receivable_installments(id) ON DELETE SET NULL,
    sale_id         text        NOT NULL,

    payment_method  text        NOT NULL,
    amount          numeric(14,2) NOT NULL CHECK (amount > 0),
    cash_received   numeric(14,2),
    change_amount   numeric(14,2) NOT NULL DEFAULT 0,

    cash_register_id text,
    transaction_id   text,
    idempotency_key  text UNIQUE,

    received_at     timestamptz NOT NULL DEFAULT now(),
    competence_date date        NOT NULL DEFAULT CURRENT_DATE,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recebimento_metodo_check
        CHECK (payment_method IN ('pix', 'cash', 'debit_card', 'credit_card', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_recebimento_conta ON public.receivable_payments (user_id, receivable_id);

-- ------------------------------------------------------------
-- 4. Quem vê o quê
-- ------------------------------------------------------------
-- Crediário é do dono. O profissional não cobra dívida de cliente e não precisa
-- saber quem deve — é informação sensível do salão, não da agenda dele.
ALTER TABLE public.receivables              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_installments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_payments      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Crediario: dono le" ON public.receivables;
CREATE POLICY "Crediario: dono le" ON public.receivables
    FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

DROP POLICY IF EXISTS "Parcelas: dono le" ON public.receivable_installments;
CREATE POLICY "Parcelas: dono le" ON public.receivable_installments
    FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

DROP POLICY IF EXISTS "Recebimentos: dono le" ON public.receivable_payments;
CREATE POLICY "Recebimentos: dono le" ON public.receivable_payments
    FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- Nenhuma política de escrita nas três, de propósito: no Postgres isso é "nega
-- tudo". Quem escreve são as RPCs abaixo, SECURITY DEFINER. Dívida que se
-- edita pela API não é dívida, é rascunho.

-- ------------------------------------------------------------
-- 5. Gerar o crediário de uma venda
-- ------------------------------------------------------------
-- Chamada de DENTRO de finalizar_venda, na mesma transação: se ela falhar, a
-- venda inteira volta atrás e o balcão vê o motivo, em vez de uma venda a prazo
-- sem parcela nenhuma.
--
-- Idempotente pelo UNIQUE em `sale_id`: chamar de novo para a mesma venda
-- devolve o que já existe, sem duplicar.
--
-- p_plano esperado (opcional):
--   { "installments": [ {"dueDate":"2026-10-07","amount":50.00}, ... ] }
--
-- Sem plano, vira parcela única com vencimento em 30 dias. É o combinado mais
-- comum do balcão ("me paga mês que vem") e evita que a falta do campo derrube
-- a venda.
CREATE OR REPLACE FUNCTION public.gerar_crediario(
    p_sale_id text,
    p_plano   jsonb DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_venda      record;
    v_id         text;
    v_existente  text;
    v_parcela    jsonb;
    v_soma       numeric(14,2) := 0;
    v_valor      numeric(14,2);
    v_vence      date;
    v_seq        integer := 0;
    v_qtd        integer;
BEGIN
    SELECT * INTO v_venda FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venda % nao encontrada.', p_sale_id;
    END IF;

    IF COALESCE(v_venda.amount_receivable, 0) <= 0 THEN
        RETURN NULL;   -- venda à vista: não há dívida a criar
    END IF;

    SELECT id INTO v_existente FROM receivables WHERE sale_id = p_sale_id;
    IF v_existente IS NOT NULL THEN
        RETURN v_existente;
    END IF;

    IF v_venda.client_id IS NULL THEN
        RAISE EXCEPTION 'Venda a prazo precisa de cliente identificado: nao ha de quem cobrar.';
    END IF;

    v_id := 'rec-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);

    INSERT INTO receivables (
        id, user_id, sale_id, client_id, client_name,
        total_amount, paid_amount, open_amount, status, opened_at
    ) VALUES (
        v_id, v_venda.user_id, p_sale_id, v_venda.client_id, v_venda.client_name,
        v_venda.amount_receivable, 0, v_venda.amount_receivable, 'open',
        COALESCE(v_venda.sold_at, now())
    );

    IF p_plano IS NOT NULL AND jsonb_typeof(p_plano->'installments') = 'array'
       AND jsonb_array_length(p_plano->'installments') > 0 THEN

        v_qtd := jsonb_array_length(p_plano->'installments');
        IF v_qtd > 36 THEN
            RAISE EXCEPTION 'Crediario com % parcelas. O maximo e 36.', v_qtd;
        END IF;

        FOR v_parcela IN SELECT * FROM jsonb_array_elements(p_plano->'installments') LOOP
            v_seq   := v_seq + 1;
            v_valor := ROUND(COALESCE((v_parcela->>'amount')::numeric, 0), 2);
            v_vence := COALESCE((v_parcela->>'dueDate')::date,
                                (COALESCE(v_venda.sold_at, now()))::date + (30 * v_seq));

            IF v_valor <= 0 THEN
                RAISE EXCEPTION 'Parcela % com valor invalido.', v_seq;
            END IF;

            INSERT INTO receivable_installments (
                id, user_id, receivable_id, sale_id,
                number, due_date, amount, paid_amount, open_amount, status
            ) VALUES (
                v_id || '-p' || v_seq, v_venda.user_id, v_id, p_sale_id,
                v_seq, v_vence, v_valor, 0, v_valor, 'open'
            );

            v_soma := v_soma + v_valor;
        END LOOP;

        -- Criterio de aceite da fase: a soma das parcelas SEMPRE corresponde ao
        -- saldo a prazo. Um centavo de diferenca aqui vira uma divida que nunca
        -- fecha, ou um cliente cobrado a mais.
        IF v_soma <> v_venda.amount_receivable THEN
            RAISE EXCEPTION 'As parcelas somam % e o saldo a prazo e %.',
                v_soma, v_venda.amount_receivable;
        END IF;
    ELSE
        INSERT INTO receivable_installments (
            id, user_id, receivable_id, sale_id,
            number, due_date, amount, paid_amount, open_amount, status
        ) VALUES (
            v_id || '-p1', v_venda.user_id, v_id, p_sale_id,
            1, (COALESCE(v_venda.sold_at, now()))::date + 30,
            v_venda.amount_receivable, 0, v_venda.amount_receivable, 'open'
        );
    END IF;

    RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- 6. Receber
-- ------------------------------------------------------------
-- Uma transação: baixa a parcela, atualiza o saldo da conta, grava o
-- recebimento, lança no Financeiro e amarra ao caixa aberto.
--
-- p_payload:
--   {
--     "installmentId": "rec-xxx-p1",
--     "idempotencyKey": "receb-<algo unico>",
--     "competenceDate": "2026-10-07",              opcional, padrao hoje
--     "payments": [ {"paymentMethod":"cash","amount":50,"cashReceived":50} ]
--   }
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
            CASE WHEN v_metodo = 'cash' THEN v_caixa END, 'receivable'
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

-- ------------------------------------------------------------
-- 7. Permissões
-- ------------------------------------------------------------
-- Os DOIS revokes, pela lição do script 22: uma função nova chega a `anon` por
-- PUBLIC e por grant nominal, e fechar um não fecha o outro.
REVOKE EXECUTE ON FUNCTION public.gerar_crediario(text, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.receber_crediario(jsonb)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.receber_crediario(jsonb)       TO authenticated;
-- `gerar_crediario` não recebe grant: ela é chamada de dentro de
-- finalizar_venda, que roda como o dono. Ninguém a chama de fora.

COMMIT;
