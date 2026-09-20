-- ============================================================
-- LIMPAR OS DADOS DE TESTE ANTES DE ENTREGAR AO CLIENTE
-- Cole e execute no SQL Editor do Supabase.
-- ============================================================
--
-- O QUE ESTE SCRIPT FAZ
--
-- Apaga TUDO que foi cadastrado durante os testes — serviços, profissionais,
-- clientes, agendamentos, leads, lançamentos financeiros e caixas — deixando
-- apenas os DADOS DO ESTABELECIMENTO (nome, slug, telefone, endereço,
-- Instagram e a logomarca).
--
-- É o passo "apagar os dados de teste" da seção 8 do PASSO_A_PASSO_NOVO_CLIENTE.
--
-- ⚠️ NÃO TEM DESFAZER. O SQL Editor roda tudo numa transação, mas depois que
-- ela é confirmada os registros se foram. Rode primeiro a conferência do
-- passo 1 e só siga se os números baterem com o que você espera perder.
--
-- ⚠️ business_info é PRESERVADA de propósito. Se ela for apagada junto, o link
-- público passa a responder "salão não encontrado" e o cliente recebe um
-- sistema que não abre.

-- ------------------------------------------------------------
-- 1. CONFERÊNCIA — rode sozinho primeiro e leia o resultado
-- ------------------------------------------------------------
-- Mostra quanto será apagado de cada tabela. Se algum número surpreender,
-- PARE aqui: é sinal de que há dado real misturado com o de teste.
SELECT 'services'       AS tabela, count(*) AS sera_apagado FROM public.services
UNION ALL SELECT 'professionals',  count(*) FROM public.professionals
UNION ALL SELECT 'clients',        count(*) FROM public.clients
UNION ALL SELECT 'appointments',   count(*) FROM public.appointments
UNION ALL SELECT 'leads',          count(*) FROM public.leads
UNION ALL SELECT 'transactions',   count(*) FROM public.transactions
UNION ALL SELECT 'cash_registers', count(*) FROM public.cash_registers
UNION ALL SELECT 'business_info (PRESERVADA)', count(*) FROM public.business_info;

-- ------------------------------------------------------------
-- 2. LIMPEZA — rode depois de conferir o passo 1
-- ------------------------------------------------------------
-- A ordem não importa aqui (não há foreign key entre estas tabelas), mas o
-- bloco só toca no que existe: cash_registers vem de outro script e pode não
-- ter sido criada nesta instância.
DO $BLOCO$
DECLARE
    t text;
    tabelas text[] := ARRAY[
        'appointments', 'transactions', 'cash_registers',
        'leads', 'clients', 'professionals', 'services'
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            EXECUTE format('DELETE FROM public.%I', t);
            RAISE NOTICE 'Limpa: %', t;
        END IF;
    END LOOP;
END $BLOCO$;

-- ------------------------------------------------------------
-- 3. CONFIRMAÇÃO — tem que vir tudo zerado, menos o estabelecimento
-- ------------------------------------------------------------
SELECT 'services'       AS tabela, count(*) AS restou FROM public.services
UNION ALL SELECT 'professionals',  count(*) FROM public.professionals
UNION ALL SELECT 'clients',        count(*) FROM public.clients
UNION ALL SELECT 'appointments',   count(*) FROM public.appointments
UNION ALL SELECT 'leads',          count(*) FROM public.leads
UNION ALL SELECT 'transactions',   count(*) FROM public.transactions
UNION ALL SELECT 'cash_registers', count(*) FROM public.cash_registers
UNION ALL SELECT 'business_info (tem que ser 1)', count(*) FROM public.business_info;

-- ============================================================
-- DEPOIS DE LIMPAR
-- ============================================================
--
-- 1. O app guarda uma cópia local em localStorage. Quem estiver com o sistema
--    aberto ainda vê os dados antigos até sair e entrar de novo. Faça logout e
--    login para confirmar que a tela ficou realmente vazia.
--
-- 2. O link público vai mostrar a barbearia SEM serviços e SEM profissionais.
--    Isso é esperado — o cliente cadastra a equipe dele no primeiro acesso.
--
-- 3. Conferir que os dados do estabelecimento continuam lá:
--
--     SELECT name, slug, phone, address, instagram,
--            CASE WHEN "avatarUrl" IS NULL THEN 'SEM LOGO' ELSE 'logo ok' END AS logo
--     FROM public.business_info;
