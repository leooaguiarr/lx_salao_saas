-- ============================================================
-- FIDELIDADE: PROGRAMA, ADESAO, PONTUACAO E RESGATE (Fase F)
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTA FASE CRIA
--
-- Um programa simples de visitas/pontos por salao: o cliente adere, cada
-- servico elegivel pago soma ponto, e ao atingir a meta aparece um beneficio
-- disponivel. Tudo auditavel — nunca um numero solto no cadastro do cliente.
--
--   PROGRAMA     — configuracao do clube: meta, beneficio, pontos por servico.
--                  Uma linha por salao. E CONFIGURACAO, o dono edita direto.
--   ADESAO       — o cliente participa ou nao. Fica em `clients`, ao lado dos
--                  outros campos dele (frequencia, ultima visita).
--   PONTUACAO    — um movimento por item de servico vendido a cliente aderido,
--                  gerado por GATILHO em `sale_items` — mesmo padrao da Fase D,
--                  para nao mexer em `finalizar_venda`.
--   RESGATE      — uma RPC que consome a meta em pontos e registra o
--                  movimento negativo. Chamada do checkout (quando o balcao
--                  aplica o beneficio numa venda) ou direto da aba.
--
-- POR QUE NAO E UM PATCH EM finalizar_venda
--
-- A pontuacao nasce de GATILHO em `sale_items`, exatamente como a comissao da
-- Fase D (docs/sql/21_comissoes.sql). `finalizar_venda` ja foi alterada duas
-- vezes (Fase E patcheou por substituicao de texto sobre a definicao viva no
-- banco) e cada alteracao carrega o risco que os scripts 10, 12, 13 e 17
-- alertam ja ter derrubado o link publico. O gatilho roda na mesma transacao
-- da venda: se falhar, a venda inteira volta atras — o comportamento certo.
--
-- O resgate tambem fica FORA de `finalizar_venda`. O desconto do beneficio e
-- so mais um desconto de checkout (a tela ja sabe fazer isso desde a Fase B);
-- a baixa dos pontos e uma chamada separada, feita pela tela depois que a
-- venda ja foi confirmada, amarrada ao id da venda para auditoria e protegida
-- por chave de idempotencia — o mesmo padrao de receber_crediario().

BEGIN;

-- ------------------------------------------------------------
-- 1. Adesao do cliente
-- ------------------------------------------------------------
-- Direto em `clients`, ao lado dos outros campos dele — mesma convencao de
-- "lastVisit" e "photoUrl": sao dados do cliente, nao um cadastro a parte.
--
-- DEFAULT true de proposito: a regra do negocio e "tem cadastro, ja faz
-- parte do clube" — adesao automatica, nao opt-in. O ADD COLUMN com esse
-- default preenche `true` em todos os clientes ja cadastrados no momento em
-- que a coluna nasce, e todo cliente novo cadastrado depois tambem comeca
-- aderido. O dono continua podendo desmarcar um cliente especifico na tela
-- (excecao pontual), mas a adesao em massa nao depende de ninguem marcar
-- nada.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "loyaltyEnrolled" boolean NOT NULL DEFAULT true;

-- O saldo de pontos fica em cache aqui, e nao e para calcular por soma toda
-- vez: e a MESMA razao de `receivables.open_amount` guardar o saldo pronto —
-- e mantido pelo gatilho e pela RPC, nunca recalculado na leitura.
--
-- ⚠️ NUNCA gravavel pelo upsert generico do navegador. `public/api.js` remove
-- este campo do payload antes de enviar (mesma tecnica ja usada para
-- `daysSinceLast`), senao um cliente com o cache desatualizado no aparelho de
-- alguem sobrescreveria um saldo que o gatilho acabou de somar em outro lugar.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "loyaltyPoints" integer NOT NULL DEFAULT 0
    CHECK ("loyaltyPoints" >= 0);

-- ------------------------------------------------------------
-- 2. Configuracao do programa — uma linha por salao
-- ------------------------------------------------------------
-- E CATALOGO/CONFIGURACAO, nao razao financeiro: o dono edita direto, como em
-- `products` e `business_info`. Quem muda o saldo de pontos e outra tabela.
CREATE TABLE IF NOT EXISTS public.loyalty_programs (
    user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    active              boolean NOT NULL DEFAULT true,
    name                text NOT NULL DEFAULT 'Clube de Fidelidade',
    points_per_service  integer NOT NULL DEFAULT 1 CHECK (points_per_service > 0),
    goal                integer NOT NULL DEFAULT 10 CHECK (goal > 0),
    benefit_description text NOT NULL DEFAULT '1 serviço grátis',
    -- O beneficio vira um desconto no checkout: em reais ou em percentual,
    -- reaproveitando o mesmo ajuste que a venda ja sabe aplicar desde a Fase B.
    benefit_type        text NOT NULL DEFAULT 'amount' CHECK (benefit_type IN ('amount', 'percent')),
    benefit_value       numeric(14,2) NOT NULL DEFAULT 0 CHECK (benefit_value >= 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.atualizar_programa_fidelidade_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_programs_updated_at ON public.loyalty_programs;
CREATE TRIGGER trg_loyalty_programs_updated_at
    BEFORE UPDATE ON public.loyalty_programs
    FOR EACH ROW EXECUTE FUNCTION public.atualizar_programa_fidelidade_updated_at();

ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fidelidade: acesso do dono" ON public.loyalty_programs;
CREATE POLICY "Fidelidade: acesso do dono" ON public.loyalty_programs
    FOR ALL
    USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
    WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- ------------------------------------------------------------
-- 3. O razao de pontos — auditavel, nunca um numero solto
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_movements (
    id               text        PRIMARY KEY,
    user_id          uuid        NOT NULL,
    client_id        text        NOT NULL,

    -- Ganho aponta para o item que gerou o ponto; resgate nao tem item, so a
    -- venda em que foi aplicado (ou nenhuma, se resgatado direto na aba).
    sale_id          text,
    sale_item_id     text UNIQUE,

    -- Positivo = ganho, negativo = resgate. Nunca zero: um movimento de zero
    -- pontos nao aconteceu, e registra-lo so confundiria a auditoria.
    points           integer     NOT NULL CHECK (points <> 0),
    reason           text        NOT NULL,

    -- So o resgate usa: protege contra duplo clique na tela e contra a mesma
    -- venda gerando dois resgates se a chamada for repetida.
    idempotency_key  text UNIQUE,

    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid
);

CREATE INDEX IF NOT EXISTS idx_loyalty_mov_cliente
    ON public.loyalty_movements (user_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_mov_venda
    ON public.loyalty_movements (user_id, sale_id)
    WHERE sale_id IS NOT NULL;

ALTER TABLE public.loyalty_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Fidelidade: dono le o razao" ON public.loyalty_movements;
CREATE POLICY "Fidelidade: dono le o razao" ON public.loyalty_movements
    FOR SELECT USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- Nenhuma politica de INSERT, UPDATE ou DELETE, de proposito: no Postgres isso
-- e "nega tudo". Quem escreve e o gatilho e a RPC abaixo, os dois SECURITY
-- DEFINER — pontuacao que se edita pela API nao e auditoria, e rascunho.

-- ------------------------------------------------------------
-- 4. O gatilho que pontua a venda
-- ------------------------------------------------------------
-- Roda uma vez por item inserido, dentro da transacao da venda. So pontua
-- servico (nunca produto), de cliente identificado e aderido, com o programa
-- ativo. `finalizar_venda` so insere sale_items depois de gravar o cabecalho
-- da venda (passo 6 antes do passo 7 da RPC), entao o JOIN abaixo sempre acha
-- a venda.
CREATE OR REPLACE FUNCTION public.gerar_pontuacao_fidelidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Variaveis escalares, e nao um `record`: um `record` que nunca casou
    -- linha nenhuma fica sem-atribuir, e ler campo dele estoura
    -- "record is not assigned yet" em vez de devolver NULL de forma segura.
    -- Mesma cautela do gatilho de comissao (docs/sql/21), que usa escalar
    -- pelo mesmo motivo.
    v_cliente_id     text;
    v_sale_number    bigint;
    v_enrolled       boolean;
    v_programa_ativo boolean;
    v_pontos         integer;
    v_id             text;
BEGIN
    IF NEW.item_type IS DISTINCT FROM 'service' THEN
        RETURN NEW;
    END IF;

    SELECT client_id, sale_number INTO v_cliente_id, v_sale_number
    FROM sales WHERE id = NEW.sale_id AND user_id = NEW.user_id;

    IF v_cliente_id IS NULL THEN
        RETURN NEW;   -- venda de balcao sem cliente identificado: nao ha quem pontuar
    END IF;

    SELECT "loyaltyEnrolled" INTO v_enrolled
    FROM clients WHERE id = v_cliente_id AND user_id = NEW.user_id;

    IF NOT FOUND OR v_enrolled IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    SELECT active, points_per_service INTO v_programa_ativo, v_pontos
    FROM loyalty_programs WHERE user_id = NEW.user_id;

    IF NOT FOUND OR v_programa_ativo IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    v_id := 'lm-' || NEW.id;

    INSERT INTO loyalty_movements (
        id, user_id, client_id, sale_id, sale_item_id, points, reason, created_at
    ) VALUES (
        v_id, NEW.user_id, v_cliente_id, NEW.sale_id, NEW.id,
        v_pontos,
        'Venda #' || lpad(COALESCE(v_sale_number, 0)::text, 6, '0'),
        now()
    )
    -- Mesma protecao da comissao: reprocessar a venda pela chave de
    -- idempotencia nao reinsere itens, e o ON CONFLICT e o cinto extra.
    ON CONFLICT (sale_item_id) DO NOTHING;

    -- FOUND so fica true quando o INSERT realmente gravou uma linha (uma
    -- colisao no ON CONFLICT DO NOTHING zera FOUND). E o que impede a mesma
    -- venda repetida pela chave de idempotencia somar ponto duas vezes.
    IF FOUND THEN
        UPDATE clients
        SET "loyaltyPoints" = "loyaltyPoints" + v_pontos
        WHERE id = v_cliente_id AND user_id = NEW.user_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pontuacao_fidelidade ON public.sale_items;
CREATE TRIGGER trg_pontuacao_fidelidade
    AFTER INSERT ON public.sale_items
    FOR EACH ROW
    EXECUTE FUNCTION public.gerar_pontuacao_fidelidade();

-- Nao ha backfill de pontuacao: a adesao passou a valer no momento em que
-- esta coluna nasceu (item 1 acima), entao nenhuma venda ANTERIOR a este
-- script gera ponto retroativo — so o gatilho, dai para frente, pontua.

-- ------------------------------------------------------------
-- 5. Resgatar o beneficio
-- ------------------------------------------------------------
-- Consome exatamente `goal` pontos (o saldo que passar continua acumulado
-- para o proximo ciclo) e registra o movimento negativo.
--
-- p_payload:
--   {
--     "clientId": "cli-123",
--     "saleId": "sale-abc" | null,      venda em que foi aplicado, se houver
--     "idempotencyKey": "resgate-..."
--   }
CREATE OR REPLACE FUNCTION public.resgatar_fidelidade(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao    uuid;
    v_chave    text;
    v_cliente  record;
    v_programa record;
    v_id       text;
    v_ja       record;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.';
    END IF;

    -- Mesma regra da venda e do crediario: resgate mexe no valor da venda
    -- (via desconto) e no saldo do cliente, entao so o dono confirma.
    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietario pode resgatar beneficio de fidelidade.';
    END IF;

    v_chave := NULLIF(TRIM(COALESCE(p_payload->>'idempotencyKey', '')), '');
    IF v_chave IS NULL THEN
        RAISE EXCEPTION 'Resgate sem chave de idempotencia.';
    END IF;

    SELECT client_id INTO v_ja FROM loyalty_movements
    WHERE user_id = v_salao AND idempotency_key = v_chave LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'repetida', true, 'clientId', v_ja.client_id);
    END IF;

    SELECT id, name, "loyaltyEnrolled", "loyaltyPoints" INTO v_cliente
    FROM clients
    WHERE id = p_payload->>'clientId' AND user_id = v_salao
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente nao encontrado neste salao.';
    END IF;
    IF v_cliente."loyaltyEnrolled" IS NOT TRUE THEN
        RAISE EXCEPTION 'Este cliente nao participa do clube de fidelidade.';
    END IF;

    SELECT active, goal, benefit_description INTO v_programa
    FROM loyalty_programs WHERE user_id = v_salao
    FOR UPDATE;
    -- Duas verificacoes separadas, e nao uma so com OR: a primeira garante
    -- que o registro existe antes de qualquer leitura de campo. Mesmo padrao
    -- de receber_crediario() para v_parcela/v_conta (docs/sql/23).
    IF NOT FOUND THEN
        RAISE EXCEPTION 'O programa de fidelidade ainda nao foi configurado.';
    END IF;
    IF v_programa.active IS NOT TRUE THEN
        RAISE EXCEPTION 'O programa de fidelidade nao esta ativo.';
    END IF;

    IF v_cliente."loyaltyPoints" < v_programa.goal THEN
        RAISE EXCEPTION 'Saldo insuficiente: % tem % de % pontos.',
            v_cliente.name, v_cliente."loyaltyPoints", v_programa.goal;
    END IF;

    UPDATE clients
    SET "loyaltyPoints" = "loyaltyPoints" - v_programa.goal
    WHERE id = v_cliente.id AND user_id = v_salao;

    v_id := 'lm-resgate-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);

    INSERT INTO loyalty_movements (
        id, user_id, client_id, sale_id, sale_item_id, points, reason,
        idempotency_key, created_by
    ) VALUES (
        v_id, v_salao, v_cliente.id, NULLIF(p_payload->>'saleId', ''), NULL,
        -v_programa.goal, 'Resgate: ' || v_programa.benefit_description,
        v_chave, auth.uid()
    );

    RETURN jsonb_build_object(
        'ok', true,
        'repetida', false,
        'clientId', v_cliente.id,
        'saldoRestante', v_cliente."loyaltyPoints" - v_programa.goal
    );
END;
$$;

-- ------------------------------------------------------------
-- 6. Permissoes — os DOIS revokes, e nao um deles
-- ------------------------------------------------------------
-- Licao repetida desde o script 19: uma funcao nova em `public` chega a
-- `anon` por PUBLIC (todo papel e membro) e pelo grant nominal do Supabase.
-- Fechar so um deixa a porta aberta — conferir no banco, nao no arquivo.
REVOKE EXECUTE ON FUNCTION public.resgatar_fidelidade(jsonb)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gerar_pontuacao_fidelidade()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atualizar_programa_fidelidade_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resgatar_fidelidade(jsonb) TO authenticated;
-- `gerar_pontuacao_fidelidade` e `atualizar_programa_fidelidade_updated_at`
-- nao recebem grant nenhum: corpo de gatilho roda como o dono da funcao, sem
-- passar pelo privilegio de quem disparou o INSERT/UPDATE. Ninguem os chama.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA
-- ============================================================
--
-- 1. As colunas novas em clients existem:
--
--      SELECT column_name, column_default FROM information_schema.columns
--      WHERE table_name = 'clients' AND column_name IN ('loyaltyEnrolled', 'loyaltyPoints');
--
-- 2. As duas tabelas existem, com RLS ligada:
--
--      SELECT relname, relrowsecurity FROM pg_class
--      WHERE relname IN ('loyalty_programs', 'loyalty_movements');
--
--    Esperado: `true` nas duas.
--
-- 3. `loyalty_programs` tem UMA politica, de escrita e leitura do dono:
--
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'loyalty_programs';
--
-- 4. `loyalty_movements` tem UMA politica, so de leitura:
--
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'loyalty_movements';
--
-- 5. O gatilho esta no lugar:
--
--      SELECT tgname, tgenabled FROM pg_trigger
--      WHERE tgrelid = 'public.sale_items'::regclass AND NOT tgisinternal;
--
--    Esperado: `trg_comissao_do_item` (Fase D) e `trg_pontuacao_fidelidade`,
--    os dois com tgenabled = 'O'.
--
-- 6. As permissoes, conferidas no BANCO — nao no arquivo:
--
--      SELECT p.proname,
--             has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.proname IN ('resgatar_fidelidade', 'gerar_pontuacao_fidelidade');
--
--    ⚠️ `p.` em tudo que sai de pg_proc: sem o prefixo, `oid` e ambiguo entre
--    pg_proc e pg_namespace e a consulta morre com "42702 ... ambiguous".
--
--    Esperado:
--      resgatar_fidelidade        -> anon false, autenticado true
--      gerar_pontuacao_fidelidade -> anon false, autenticado false
--
-- 7. **Teste na tela.** Ative o programa na aba Fidelidade, marque um cliente
--    como participante, conclua uma venda de servico dele pelo checkout e
--    confira que o saldo de pontos subiu. Repita ate bater a meta e resgate.
--    Repetir a venda pela mesma chave de idempotencia NAO pode dobrar o ponto:
--
--      SELECT client_id, count(*) FROM loyalty_movements
--      WHERE points > 0 GROUP BY client_id, sale_item_id HAVING count(*) > 1;
--
--    Tem que devolver zero linhas.
