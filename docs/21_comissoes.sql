-- ============================================================
-- RAZÃO DE COMISSÕES (Fase D)
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE EXISTE HOJE
--
-- A comissão do sistema é uma CONTA REFEITA toda vez que alguém abre a tela:
-- pega o atendimento pago, procura o serviço, procura o profissional, aplica o
-- percentual que está no cadastro AGORA. Três consequências:
--
--   1. Mudar o percentual de um profissional muda a comissão do mês passado.
--   2. Mudar o preço de um serviço muda a comissão de quem já foi pago.
--   3. Não existe "comissão paga": não há onde marcar, então o dono controla
--      por fora — no caderno, no WhatsApp, na memória.
--
-- A Fase B já resolveu a parte difícil. `sale_items` guarda, congelados no
-- instante da venda, `commission_rate` (o percentual que valia) e
-- `commission_base` (o bruto menos o desconto proporcional, com produto sempre
-- em zero e acréscimo fora da base). Esses números não mudam mais.
--
-- O QUE FALTA, E É O QUE ESTE SCRIPT FAZ
--
-- Falta o que MUDA depois: o status. Uma comissão nasce a pagar e vira paga, e
-- isso não cabe em `sale_items`, que é imutável por decisão da Fase A. Daí uma
-- tabela própria, uma linha por item de serviço com comissão.
--
-- ⚠️ ESTE SCRIPT NÃO RECRIA finalizar_venda. A geração é feita por um GATILHO em
-- `sale_items`, e não por uma linha nova dentro da função. Recriar a RPC a
-- partir de outro arquivo é exatamente o que os scripts 10, 12, 13 e 17 alertam
-- já ter derrubado o link público uma vez, e `finalizar_venda` é a função mais
-- longa do projeto. O gatilho roda dentro da mesma transação da venda: se ele
-- falhar, a venda inteira volta atrás — que é o comportamento certo.

BEGIN;

-- ------------------------------------------------------------
-- 1. A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_commissions (
    id                text        PRIMARY KEY,
    user_id           uuid        NOT NULL,
    sale_id           text        NOT NULL,

    -- Um item de serviço gera no máximo UMA comissão. É esta restrição que
    -- garante a entrega "gerar comissão uma única vez": a venda repetida pela
    -- chave de idempotência não reinsere itens, e mesmo que reinserisse, o
    -- ON CONFLICT do gatilho não deixaria duplicar.
    sale_item_id      text        NOT NULL UNIQUE,

    professional_id   text        NOT NULL,
    professional_name text,
    service_id        text,
    service_name      text,

    -- Os quatro números que explicam a conta, na ordem em que ela acontece.
    -- Guardados prontos, e não calculados na leitura: é o que faz a comissão de
    -- ontem continuar sendo a de ontem.
    gross_amount      numeric(12,2) NOT NULL DEFAULT 0,  -- bruto do item
    discount_amount   numeric(12,2) NOT NULL DEFAULT 0,  -- desconto proporcional
    base_amount       numeric(12,2) NOT NULL DEFAULT 0,  -- base líquida (bruto - desconto)
    rate              numeric(6,2)  NOT NULL DEFAULT 0,  -- percentual no dia da venda
    amount            numeric(12,2) NOT NULL DEFAULT 0,  -- base * rate / 100

    status            text        NOT NULL DEFAULT 'pending',
    paid_at           timestamptz,
    paid_by           uuid,

    -- Data da venda, copiada para cá. Sem ela, todo filtro por período teria de
    -- passar por `sales`, e a tela de comissões vive de filtro por período.
    sold_at           timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sale_commissions_status_check CHECK (status IN ('pending', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_comissao_salao ON public.sale_commissions (user_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_comissao_prof  ON public.sale_commissions (user_id, professional_id, status);
CREATE INDEX IF NOT EXISTS idx_comissao_venda ON public.sale_commissions (user_id, sale_id);

-- ------------------------------------------------------------
-- 2. O gatilho que gera a comissão
-- ------------------------------------------------------------
-- Roda uma vez por item inserido, dentro da transação da venda.
--
-- Só gera quando há o que pagar: serviço, com profissional, com percentual e
-- com base maior que zero. Produto nunca entra — `finalizar_venda` já grava
-- `commission_rate = 0` e `commission_base = 0` para ele, então a condição
-- abaixo o descarta sozinha, sem precisar repetir a regra aqui.
CREATE OR REPLACE FUNCTION public.gerar_comissao_do_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_valor    numeric(12,2);
    v_vendida  timestamptz;
BEGIN
    IF NEW.item_type IS DISTINCT FROM 'service'
       OR NEW.professional_id IS NULL
       OR COALESCE(NEW.commission_rate, 0) <= 0
       OR COALESCE(NEW.commission_base, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    v_valor := ROUND(NEW.commission_base * NEW.commission_rate / 100, 2);
    IF v_valor <= 0 THEN
        RETURN NEW;
    END IF;

    -- O cabeçalho da venda é gravado ANTES dos itens (passo 6 da RPC, os itens
    -- no passo 7), então `sold_at` já existe aqui.
    SELECT sold_at INTO v_vendida
    FROM sales WHERE id = NEW.sale_id AND user_id = NEW.user_id;

    INSERT INTO sale_commissions (
        id, user_id, sale_id, sale_item_id,
        professional_id, professional_name, service_id, service_name,
        gross_amount, discount_amount, base_amount, rate, amount,
        status, sold_at
    ) VALUES (
        'cm-' || NEW.id, NEW.user_id, NEW.sale_id, NEW.id,
        NEW.professional_id, NEW.professional_name, NEW.service_id, NEW.item_name,
        COALESCE(NEW.gross_amount, 0), COALESCE(NEW.discount_amount, 0),
        NEW.commission_base, NEW.commission_rate, v_valor,
        'pending', COALESCE(v_vendida, now())
    )
    ON CONFLICT (sale_item_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comissao_do_item ON public.sale_items;
CREATE TRIGGER trg_comissao_do_item
    AFTER INSERT ON public.sale_items
    FOR EACH ROW
    EXECUTE FUNCTION public.gerar_comissao_do_item();

-- ------------------------------------------------------------
-- 3. As vendas que já existem
-- ------------------------------------------------------------
-- O gatilho só pega o que vier daqui para a frente. Sem este preenchimento, as
-- vendas já concluídas ficariam de fora da aba Comissões e o dono veria um
-- histórico que começa do nada.
--
-- É o mesmo cálculo do gatilho, sobre os mesmos valores congelados — não há
-- recálculo com percentual de hoje em lugar nenhum.
INSERT INTO public.sale_commissions (
    id, user_id, sale_id, sale_item_id,
    professional_id, professional_name, service_id, service_name,
    gross_amount, discount_amount, base_amount, rate, amount,
    status, sold_at
)
SELECT
    'cm-' || i.id, i.user_id, i.sale_id, i.id,
    i.professional_id, i.professional_name, i.service_id, i.item_name,
    COALESCE(i.gross_amount, 0), COALESCE(i.discount_amount, 0),
    i.commission_base, i.commission_rate,
    ROUND(i.commission_base * i.commission_rate / 100, 2),
    'pending', COALESCE(s.sold_at, now())
FROM sale_items i
JOIN sales s ON s.id = i.sale_id AND s.user_id = i.user_id
WHERE i.item_type = 'service'
  AND i.professional_id IS NOT NULL
  AND COALESCE(i.commission_rate, 0) > 0
  AND COALESCE(i.commission_base, 0) > 0
  AND ROUND(i.commission_base * i.commission_rate / 100, 2) > 0
ON CONFLICT (sale_item_id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Quem vê o quê
-- ------------------------------------------------------------
ALTER TABLE public.sale_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comissao: leitura por papel" ON public.sale_commissions;

-- O dono vê o salão inteiro. O profissional vê SÓ AS DELE.
--
-- Esta é a linha que separa de verdade — não o filtro da tela. Um staff com o
-- console do navegador aberto e a mesma chave `anon` de todo mundo não alcança
-- a comissão do colega por aqui.
--
-- Staff sem `professional_id` preenchido não vê nada: `meu_profissional()`
-- devolve NULL e a comparação nunca é verdadeira. É a mesma decisão do script
-- 11 — melhor um profissional sem dados do que um vendo os dados de outro.
CREATE POLICY "Comissao: leitura por papel" ON public.sale_commissions
    FOR SELECT USING (
        user_id = public.salao_do_usuario()
        AND (
            public.meu_papel() = 'owner'
            OR professional_id = public.meu_profissional()
        )
    );

-- Nenhuma política de INSERT, UPDATE ou DELETE, de propósito: no Postgres isso
-- significa "nega tudo". Quem escreve é o gatilho e a RPC abaixo, os dois
-- SECURITY DEFINER. Assim nem o dono altera o valor de uma comissão pela API —
-- ele marca como paga, que é outra coisa.

-- ------------------------------------------------------------
-- 5. Marcar como paga
-- ------------------------------------------------------------
-- Recebe uma lista de ids e vira todas de uma vez: pagar comissão é um ato só,
-- feito no fim da semana ou do mês, e uma chamada por linha deixaria metade
-- marcada se a conexão caísse no meio.
--
-- `p_paga = false` desmarca. Existe porque errar a linha na hora de pagar é
-- comum, e sem desfazer o dono ficaria com um registro errado para sempre.
CREATE OR REPLACE FUNCTION public.pagar_comissoes(p_ids text[], p_paga boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_salao   uuid;
    v_afetadas integer;
BEGIN
    v_salao := public.salao_do_usuario();
    IF v_salao IS NULL THEN
        RAISE EXCEPTION 'Login sem salao vinculado.';
    END IF;

    -- Só o dono paga. A conferência é aqui, e não na tela: a função é SECURITY
    -- DEFINER e ignora RLS, então sem esta linha um staff marcaria as próprias
    -- comissões como pagas.
    IF public.meu_papel() <> 'owner' THEN
        RAISE EXCEPTION 'Somente o proprietario pode dar baixa em comissao.';
    END IF;

    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'atualizadas', 0);
    END IF;

    UPDATE sale_commissions
    SET status  = CASE WHEN p_paga THEN 'paid' ELSE 'pending' END,
        paid_at = CASE WHEN p_paga THEN now() END,
        paid_by = CASE WHEN p_paga THEN auth.uid() END
    WHERE user_id = v_salao
      AND id = ANY(p_ids);

    GET DIAGNOSTICS v_afetadas = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'atualizadas', v_afetadas, 'paga', p_paga);
END;
$$;

-- ------------------------------------------------------------
-- 6. Permissões — os DOIS revokes, e não um deles
-- ------------------------------------------------------------
-- Uma função nova em `public` chega a `anon` por DOIS caminhos diferentes, e
-- fechar só um deixa a porta aberta:
--
--   1. O grant que o Postgres dá a PUBLIC em toda função criada. Aparece no
--      `proacl` como `=X/postgres` — o campo vazio antes do `=` é PUBLIC. Todo
--      papel é membro de PUBLIC, `anon` inclusive.
--   2. O `ALTER DEFAULT PRIVILEGES` do Supabase, que concede EXECUTE
--      NOMINALMENTE a anon/authenticated/service_role. Aparece como `anon=X`.
--
-- O script 19 tropeçou no caminho 2 (revogava de PUBLIC e o grant nominal
-- ficava). Estas funções tropeçaram no caminho 1 (o revoke nominal passou e o
-- de PUBLIC ficou). Daí os dois, sempre — e a conferência no banco, com
-- `has_function_privilege`, porque ler o arquivo .sql não mostra nenhum dos
-- dois grants.
REVOKE EXECUTE ON FUNCTION public.pagar_comissoes(text[], boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gerar_comissao_do_item() FROM PUBLIC, anon, authenticated;

-- O painel chama esta pela sessão do dono; quem recusa o staff é a própria
-- função, que confere `meu_papel()` antes de escrever.
GRANT EXECUTE ON FUNCTION public.pagar_comissoes(text[], boolean) TO authenticated;

-- `gerar_comissao_do_item` não recebe grant nenhum: ela é corpo de gatilho e
-- roda como o dono da função, sem passar pelo privilégio de quem disparou o
-- INSERT. Ninguém precisa chamá-la, e ninguém deve.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- 1. A tabela existe, com RLS ligada e UMA política, só de leitura:
--
--      SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sale_commissions'::regclass;
--      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'sale_commissions';
--
--    Esperado: `true`, e uma linha com cmd = 'SELECT'.
--
-- 2. As vendas que já existiam viraram comissão:
--
--      SELECT professional_name, service_name, base_amount, rate, amount, status
--      FROM sale_commissions ORDER BY sold_at DESC;
--
-- 3. A conta bate com o item que a gerou — é o teste que importa, porque prova
--    que nada foi recalculado com o percentual de hoje:
--
--      SELECT c.id,
--             c.base_amount = i.commission_base   AS base_confere,
--             c.rate        = i.commission_rate   AS taxa_confere,
--             c.amount      = ROUND(i.commission_base * i.commission_rate / 100, 2) AS valor_confere
--      FROM sale_commissions c JOIN sale_items i ON i.id = c.sale_item_id;
--
--    As três colunas têm que ser `true` em todas as linhas.
--
-- 4. Produto não gerou comissão nenhuma:
--
--      SELECT count(*) FROM sale_commissions c
--      JOIN sale_items i ON i.id = c.sale_item_id
--      WHERE i.item_type <> 'service';                -- tem que ser 0
--
-- 5. O gatilho está no lugar:
--
--      SELECT tgname, tgenabled FROM pg_trigger
--      WHERE tgrelid = 'public.sale_items'::regclass AND NOT tgisinternal;
--
--    Esperado: `trg_comissao_do_item`, com tgenabled = 'O'.
--
-- 5b. As permissões ficaram como a seção 6 pretende. **Confira no banco**, não
--     no arquivo — foi assim que os dois caminhos de grant apareceram:
--
--      SELECT proname,
--             has_function_privilege('anon', oid, 'EXECUTE')          AS anon,
--             has_function_privilege('authenticated', oid, 'EXECUTE') AS autenticado
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND proname IN ('pagar_comissoes', 'gerar_comissao_do_item');
--
--    Esperado:
--      pagar_comissoes        -> anon false, autenticado true
--      gerar_comissao_do_item -> anon false, autenticado false
--
-- 6. **Teste na tela.** Conclua uma venda com serviço pelo checkout e confira
--    que ela apareceu na aba Comissões, com o valor certo. Depois marque como
--    paga e recarregue.
--
-- ============================================================
-- O QUE ESTE SCRIPT NÃO FAZ
-- ============================================================
--
-- A comissão dos atendimentos ANTIGOS — os que foram pagos pela confirmação do
-- atendimento, antes da Fase B — continua sendo calculada na tela, do jeito
-- antigo, a partir do cadastro atual. Não há como congelá-la: o percentual que
-- valia naquele dia não foi guardado em lugar nenhum, e inventar um número
-- seria pior do que mostrar a conta declarada como estimativa.
--
-- Por isso a aba Comissões separa as duas coisas, e o Financeiro continua
-- mostrando a estimativa antiga enquanto houver atendimento antigo no período.
