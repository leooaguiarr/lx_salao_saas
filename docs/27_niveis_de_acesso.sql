-- ============================================================
-- NIVEIS DE ACESSO: ADMIN (dono) e USUARIO (profissional)
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- ⚠️ ANTES DESTE ARQUIVO, RODE ISTO SOZINHO, NUMA EXECUCAO SEPARADA:
--
--     CREATE TABLE IF NOT EXISTS public._backup_funcoes (
--         id serial PRIMARY KEY, nome text, def text, quando timestamptz DEFAULT now()
--     );
--
-- O SQL Editor do Supabase ANALISA TODOS OS COMANDOS DO SCRIPT ANTES DE
-- EXECUTAR O PRIMEIRO. A tabela criada aqui dentro ainda nao existe nessa
-- analise, e o `INSERT INTO public._backup_funcoes` falha com
-- "42P01: relation ... does not exist" mesmo com o CREATE TABLE logo acima.
-- O CREATE continua no corpo abaixo (e idempotente); roda-lo antes so garante
-- que a tabela ja exista quando a analise acontecer.
--
-- O QUE MUDA
--
-- Ate aqui o profissional (`staff`) era quase um espectador: via a propria
-- agenda, os proprios clientes, o estoque e a propria comissao. Vender era
-- so do dono — decisao da Fase A, escrita dentro da propria RPC.
--
-- A regra nova, definida pelo dono:
--
--   ADMIN (owner)    — tudo, como hoje.
--   USUARIO (staff)  — agenda dele, clientes dele, ESTOQUE, FINANCEIRO dele,
--                      comissao dele, VENDAS e FIDELIDADE.
--
-- Quatro travas continuam de pe para o USUARIO, e sao o coracao deste script:
--
--   1. CAIXA e do dono. Abrir, fechar e conferir a gaveta continua exclusivo.
--      O profissional vende normalmente e o dinheiro entra sozinho no caixa
--      aberto, porque `finalizar_venda` e SECURITY DEFINER e faz esse vinculo
--      por dentro — ele nunca precisa LER `cash_registers` para isso.
--   2. CREDIARIO e do dono. Divida de cliente e do salao.
--   3. CONFIGURACAO do clube de fidelidade e do dono. Ele resgata beneficio,
--      mas nao muda meta nem premio.
--   4. O ATENDIMENTO DE OUTRO nao se fecha. Venda de balcao e livre; a venda
--      que nasce de um agendamento so pode ser concluida pelo dono ou por quem
--      vai fazer o corte.
--
-- E toda venda passa a registrar QUEM a fez (`sales.sold_by`), amarrado ao
-- login. Com a equipe inteira vendendo, "quem lancou isto" deixa de ser uma
-- pergunta sem resposta.

-- ------------------------------------------------------------
-- 1. Quem efetuou a venda
-- ------------------------------------------------------------
-- Nao confundir com `professional_id`: aquele e de QUEM ATENDE (e a base da
-- comissao); este e de QUEM OPEROU O SISTEMA. Na venda de balcao feita pela
-- recepcao os dois sao pessoas diferentes, e as duas informacoes importam.
--
-- ON DELETE SET NULL de proposito: apagar o login de um ex-funcionario nao
-- pode apagar nem travar a venda que ele fez. O historico do dinheiro sobrevive
-- a saida da pessoa.
ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS sold_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sales.sold_by IS
    'Login que concluiu a venda. professional_id e quem atende; este e quem operou.';

-- ------------------------------------------------------------
-- 2. Leitura das vendas para a equipe
-- ------------------------------------------------------------
-- Decisao do dono: o profissional ve TODAS as vendas, e nao so as dele —
-- "se tiver somente ele no salao precisa ter acesso completo". O registro de
-- quem vendeu (item 1) e o que mantem a rastreabilidade.
--
-- A ESCRITA continua sem politica nenhuma nas tres tabelas: quem grava e a
-- RPC, e so ela. Isso nao muda aqui.
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

-- ------------------------------------------------------------
-- 3. Fidelidade para a equipe: ler tudo, configurar nada
-- ------------------------------------------------------------
-- A politica antiga era `FOR ALL` do dono. Trocada por politicas POR COMANDO,
-- pelo mesmo motivo do script 16: `WITH CHECK` nao vale para DELETE, e um
-- `FOR ALL` que sobra se soma com OR e reabre o buraco.
DROP POLICY IF EXISTS "Fidelidade: acesso do dono" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: equipe le o programa" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: dono cria o programa" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: dono altera o programa" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Fidelidade: dono apaga o programa" ON public.loyalty_programs;

-- O profissional PRECISA ler o programa: sem a meta e o beneficio, o aviso do
-- checkout nao tem o que mostrar.
CREATE POLICY "Fidelidade: equipe le o programa" ON public.loyalty_programs
    FOR SELECT USING (user_id = public.salao_do_usuario());
CREATE POLICY "Fidelidade: dono cria o programa" ON public.loyalty_programs
    FOR INSERT WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Fidelidade: dono altera o programa" ON public.loyalty_programs
    FOR UPDATE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner')
             WITH CHECK (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');
CREATE POLICY "Fidelidade: dono apaga o programa" ON public.loyalty_programs
    FOR DELETE USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

-- O razao de pontos: leitura para a equipe, escrita continua so do gatilho e
-- da RPC (nao ha politica de INSERT nesta tabela, e nao passa a haver).
DROP POLICY IF EXISTS "Fidelidade: dono le o razao" ON public.loyalty_movements;
DROP POLICY IF EXISTS "Fidelidade: equipe le o razao" ON public.loyalty_movements;
CREATE POLICY "Fidelidade: equipe le o razao" ON public.loyalty_movements
    FOR SELECT USING (user_id = public.salao_do_usuario());

-- ------------------------------------------------------------
-- 4. Backup das funcoes antes de alterar
-- ------------------------------------------------------------
-- Mesmo cuidado da Fase E: a versao que esta RODANDO fica guardada antes de
-- qualquer substituicao de texto. Para restaurar, ver o fim deste arquivo.
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

-- ------------------------------------------------------------
-- 5. finalizar_venda: quem pode concluir, e quem fez
-- ------------------------------------------------------------
-- ⚠️ O PATCH PARTE DA DEFINICAO QUE ESTA RODANDO (pg_get_functiondef), e nao de
-- uma copia do arquivo. E a diferenca entre editar o que existe e sobrescrever
-- com o que se imagina que existe — o erro que ja derrubou o link publico uma
-- vez (ver o alerta nos scripts 10, 12, 13 e 17).
--
-- Todas as ancoras sao de UMA LINHA: o corpo no banco usa CRLF, e um bloco
-- multi-linha escrito com LF nao casaria. Cada uma foi conferida como UNICA, e
-- cada substituicao ABORTA se nao casar — meia alteracao seria pior que nenhuma.
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

    -- Ja aplicado? Sai sem fazer nada (o script e idempotente).
    IF position('Fase I (niveis de acesso)' in d) > 0 THEN
        RAISE NOTICE 'finalizar_venda ja tem a regra de niveis de acesso. Nada a fazer.';
        RETURN;
    END IF;

    -- 5.1 A trava de papel vira a trava do ATENDIMENTO DE OUTRO ------------
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

    -- 5.2 Gravar quem efetuou a venda -------------------------------------
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
    RAISE NOTICE 'finalizar_venda atualizada: equipe conclui venda, com registro de quem fez.';
END $patch$;

-- ------------------------------------------------------------
-- 6. resgatar_fidelidade: a equipe tambem resgata
-- ------------------------------------------------------------
-- O resgate vira desconto na venda, e quem fecha a venda agora e a equipe
-- inteira. Manter o resgate so no dono travaria o atendimento sempre que ele
-- nao estivesse no salao — que e justamente a hora em que o cliente esta na
-- cadeira esperando.
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

    -- Some a trava, mas NAO some o recorte de salao: `v_salao` continua sendo
    -- conferido logo acima, e e ele que impede resgatar em nome de outro salao.
    d := replace(d, a,
         '    -- Fase I (niveis de acesso): a equipe tambem resgata. O recorte de' || chr(13) || chr(10) ||
         '    -- salao acima continua sendo a trava real.');

    EXECUTE d;
    RAISE NOTICE 'resgatar_fidelidade atualizada: a equipe tambem resgata.';
END $patch$;

-- ============================================================
-- CONFERENCIA — rode depois e confira o resultado
-- ============================================================
-- 1) A coluna nova existe e aceita nulo:
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='sales' AND column_name='sold_by';

-- 2) As tres tabelas de venda leem por SALAO (e nao mais por papel):
SELECT tablename, policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('sales','sale_items','sale_payments','loyalty_programs','loyalty_movements')
 ORDER BY tablename, cmd;

-- 3) As duas RPCs foram alteradas (espera-se `true` nas duas):
SELECT
  (SELECT position('Fase I (niveis de acesso)' in pg_get_functiondef(p.oid)) > 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='finalizar_venda') AS venda_liberada,
  (SELECT position('Somente o proprietario pode resgatar' in pg_get_functiondef(p.oid)) = 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='resgatar_fidelidade') AS resgate_liberado;

-- 4) O que continua SO do dono (espera-se as quatro linhas com 'owner'):
SELECT tablename, cmd, qual
  FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('cash_registers','receivables')
   AND cmd = 'SELECT';

-- ============================================================
-- COMO VOLTAR ATRAS
-- ============================================================
-- As duas funcoes ficaram guardadas antes da alteracao. Para restaurar:
--
--   DO $$ DECLARE d text; BEGIN
--     SELECT def INTO d FROM public._backup_funcoes
--      WHERE nome = 'finalizar_venda_antes_niveis_de_acesso'
--      ORDER BY quando DESC LIMIT 1;
--     EXECUTE d;
--   END $$;
--
-- (idem para 'resgatar_fidelidade_antes_niveis_de_acesso')
--
-- As politicas voltam rodando de novo os scripts 14 (vendas) e 25 (fidelidade),
-- que recriam as versoes so-do-dono.
