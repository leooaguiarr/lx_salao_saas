-- ============================================================
-- DIAGNÓSTICO DO BANCO — o que existe e o que falta
-- Cole e execute no SQL Editor do Supabase.
-- ============================================================
--
-- ⚠️ Esta consulta só LÊ o catálogo do Postgres. Não cria, não altera e não
-- apaga nada. Pode rodar quantas vezes quiser, inclusive em produção.
--
-- POR QUE ELE EXISTE
--
-- Os scripts de migração dependem uns dos outros. Rodar um fora de ordem
-- devolve um erro que não explica o que falta:
--
--   ERROR: 42883: function public.meu_papel() does not exist
--
-- Isso não quer dizer que o script esteja errado — quer dizer que o script
-- ANTERIOR dele nunca rodou. Esta consulta mostra a fila inteira de uma vez,
-- em vez de descobrir um buraco por erro.
--
-- A ORDEM DOS SCRIPTS
--
--   1. supabase_setup.sql .............. tabelas base
--   2. public_booking_setup.sql ........ link público de agendamento
--   3. supabase_cash_registers.sql ..... caixa
--   4. add_transaction_timestamp.sql ... carimbo de caixa (registradoEm)
--   5. multi_login_por_salao.sql ....... salon_members + salao_do_usuario()
--   6. add_disponibilidade.sql ......... professional_blocks + folgas
--   7. add_niveis_de_acesso.sql ........ meu_papel() + fila do cliente
--   8. add_produtos_e_estoque.sql ...... products + vitrine
--   9. add_movimentacao_estoque.sql .... stock_movements + baixa de estoque
--
-- Os de 5 a 9 dependem do anterior. Ler a coluna "rode" do resultado diz o
-- que executar e em que ordem.

SELECT
    'TABELA'  AS tipo,
    t.nome    AS objeto,
    CASE WHEN c.relname IS NULL THEN '>>> FALTA' ELSE 'existe' END AS situacao,
    CASE WHEN c.relname IS NULL THEN t.script ELSE '' END AS rode
FROM (VALUES
        ('business_info',       'docs/supabase_setup.sql'),
        ('services',            'docs/supabase_setup.sql'),
        ('professionals',       'docs/supabase_setup.sql'),
        ('clients',             'docs/supabase_setup.sql'),
        ('appointments',        'docs/supabase_setup.sql'),
        ('leads',               'docs/supabase_setup.sql'),
        ('transactions',        'docs/supabase_setup.sql'),
        ('cash_registers',      'docs/supabase_cash_registers.sql'),
        ('salon_members',       'docs/multi_login_por_salao.sql'),
        ('professional_blocks', 'docs/add_disponibilidade.sql'),
        ('products',            'docs/add_produtos_e_estoque.sql'),
        ('stock_movements',     'docs/add_movimentacao_estoque.sql')
     ) AS t(nome, script)
-- Tudo filtrado pelo schema `public`: sem isso, objeto de mesmo nome em outro
-- schema conta como existente e a consulta devolve linha repetida.
LEFT JOIN pg_class c
       ON c.relname = t.nome
      AND c.relkind = 'r'
      AND c.relnamespace = 'public'::regnamespace

UNION ALL

-- Uma linha POR ASSINATURA. Função que aparecer duas vezes com contagens de
-- parâmetros diferentes é sinal de assinatura antiga sobrando — foi assim que
-- o link público quebrou uma vez.
SELECT
    'FUNCAO',
    f.nome,
    CASE WHEN p.proname IS NULL THEN '>>> FALTA'
         ELSE 'existe, ' || p.pronargs || ' parametros' END,
    CASE WHEN p.proname IS NULL THEN f.script ELSE '' END
FROM (VALUES
        ('get_public_salon',            'docs/public_booking_setup.sql'),
        ('check_client_exists',         'docs/public_booking_setup.sql'),
        ('check_week_appointments',     'docs/public_booking_setup.sql'),
        ('create_public_booking',       'docs/add_disponibilidade.sql (precisa de 8 parametros)'),
        ('salao_do_usuario',            'docs/multi_login_por_salao.sql'),
        ('meu_papel',                   'docs/add_niveis_de_acesso.sql'),
        ('meu_profissional',            'docs/add_niveis_de_acesso.sql'),
        ('get_public_queue',            'docs/add_niveis_de_acesso.sql'),
        ('get_public_products',         'docs/add_produtos_e_estoque.sql'),
        ('registrar_movimento_estoque', 'docs/add_movimentacao_estoque.sql (precisa de 12 parametros)')
     ) AS f(nome, script)
LEFT JOIN pg_proc p
       ON p.proname = f.nome
      AND p.pronamespace = 'public'::regnamespace

UNION ALL

SELECT
    'COLUNA',
    'transactions.' || col.nome,
    CASE WHEN c.column_name IS NULL THEN '>>> FALTA' ELSE 'existe' END,
    CASE WHEN c.column_name IS NULL THEN col.script ELSE '' END
FROM (VALUES
        ('registradoEm',  'docs/add_transaction_timestamp.sql'),
        ('status',        'docs/supabase_cash_registers.sql'),
        ('productId',     'docs/add_movimentacao_estoque.sql'),
        ('productQty',    'docs/add_movimentacao_estoque.sql'),
        ('clientId',      'docs/add_movimentacao_estoque.sql'),
        ('appointmentId', 'docs/add_movimentacao_estoque.sql')
     ) AS col(nome, script)
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public'
      AND c.table_name   = 'transactions'
      AND c.column_name  = col.nome

ORDER BY 1, 2;

-- ============================================================
-- COMO LER O RESULTADO
-- ============================================================
--
-- Rode os scripts da coluna "rode" NA ORDEM da lista lá em cima, um de cada
-- vez, conferindo se cada um terminou sem erro antes de passar ao próximo.
-- Todos são idempotentes: rodar de novo o que já rodou não causa problema.
--
-- Casos que merecem atenção:
--
--   create_public_booking com MENOS de 8 parâmetros
--     Assinatura antiga. Rode docs/add_disponibilidade.sql de novo.
--
--   registrar_movimento_estoque com um número diferente de 12
--     Rode docs/add_movimentacao_estoque.sql de novo.
--
--   a mesma função aparecendo em DUAS linhas
--     Sobrou assinatura antiga no banco. Precisa de um DROP FUNCTION com a
--     assinatura exata da versão velha antes de recriar — assinatura duplicada
--     já derrubou o link público uma vez.
