-- ============================================================
-- DIAGNÓSTICO DA EVOLUÇÃO DE VENDAS — o que existe e o que falta
-- Cole e execute no SQL Editor do Supabase.
-- ============================================================
--
-- ⚠️ Esta consulta só LÊ o catálogo do Postgres. Não cria, não altera e não
-- apaga nada. Pode rodar quantas vezes quiser, inclusive em produção.
--
-- Continuação de docs/diagnostico_banco.sql (que cobre 1-9 = scripts base,
-- até add_niveis_de_acesso/add_produtos_e_estoque/add_movimentacao_estoque).
-- Este cobre a Evolução de Vendas + Níveis de Acesso novo, portados de
-- dashboard_salao (ver docs/../PORTABILIDADE_ALABAMA.md):
--
--   14. 14_vendas_base.sql ............... sales, sale_items, sale_payments
--   15. 15_finalizacao_venda.sql ......... finalizar_venda, venda_em_json
--   16. 16_politicas_por_comando.sql ..... fecha o DELETE que "FOR ALL" deixava aberto
--   17. 17_limite_das_consultas_publicas.sql . limite_publico, checar_limite
--   18. 18_remove_agendamento_antigo.sql .. remove overload antigo de create_public_booking
--   19. 19_revoke_anon_das_rpcs_internas.sql . permissões (não cria objeto)
--   20. 20_fechamento_de_caixa.sql ........ cash_registers.expectedCash/countedCash/...
--   21. 21_comissoes.sql .................. sale_commissions, gerar_comissao_do_item, pagar_comissoes
--   22. 22_fecha_anon_nas_internas_restantes.sql . permissões (não cria objeto)
--   23. 23_crediario.sql .................. receivables, receivable_installments, receivable_payments
--   24. 24_corrige_source_crediario.sql ... corrige receber_crediario (bug do 23)
--   25. 25_fidelidade.sql ................. loyalty_programs, loyalty_movements, resgatar_fidelidade
--   26. 26_mensagens_editaveis.sql ........ business_info.whatsappChargeMessage, loyalty_programs.reward_message
--   27. 27_niveis_de_acesso.sql ........... sales.sold_by + políticas + patch em finalizar_venda/resgatar_fidelidade
--   28. 28_acesso_do_profissional.sql ..... professionals.email + política do quadro do salão
--
-- Scripts 19, 22 e 24 só mexem em permissão/corrigem função existente — não
-- criam tabela/coluna nova, por isso não aparecem como itens a conferir
-- abaixo. Rodar todos na ordem mesmo assim: pular um deles deixa a
-- permissão (anon) ou a correção (source do crediário) faltando, sem
-- nenhum erro visível até alguém tentar usar a função na tela.

SELECT
    'TABELA'  AS tipo,
    t.nome    AS objeto,
    CASE WHEN c.relname IS NULL THEN '>>> FALTA' ELSE 'existe' END AS situacao,
    CASE WHEN c.relname IS NULL THEN t.script ELSE '' END AS rode
FROM (VALUES
        ('sales',                    'docs/14_vendas_base.sql'),
        ('sale_items',                'docs/14_vendas_base.sql'),
        ('sale_payments',             'docs/14_vendas_base.sql'),
        ('limite_publico',            'docs/17_limite_das_consultas_publicas.sql'),
        ('sale_commissions',          'docs/21_comissoes.sql'),
        ('receivables',               'docs/23_crediario.sql'),
        ('receivable_installments',   'docs/23_crediario.sql'),
        ('receivable_payments',       'docs/23_crediario.sql'),
        ('loyalty_programs',          'docs/25_fidelidade.sql'),
        ('loyalty_movements',         'docs/25_fidelidade.sql')
     ) AS t(nome, script)
LEFT JOIN pg_class c
       ON c.relname = t.nome
      AND c.relkind = 'r'
      AND c.relnamespace = 'public'::regnamespace

UNION ALL

-- Uma linha POR ASSINATURA — função repetida com número de parâmetros
-- diferente é sinal de assinatura antiga sobrando (já derrubou o link
-- público uma vez, por isso o diagnóstico original confere isso).
SELECT
    'FUNCAO',
    f.nome,
    CASE WHEN p.proname IS NULL THEN '>>> FALTA'
         ELSE 'existe, ' || p.pronargs || ' parametros' END,
    CASE WHEN p.proname IS NULL THEN f.script ELSE '' END
FROM (VALUES
        ('atualizar_venda_updated_at',            'docs/14_vendas_base.sql'),
        ('venda_em_json',                          'docs/15_finalizacao_venda.sql (3 parametros)'),
        ('finalizar_venda',                        'docs/15_finalizacao_venda.sql (1 parametro: jsonb)'),
        ('checar_limite',                          'docs/17_limite_das_consultas_publicas.sql (3 parametros)'),
        ('gerar_comissao_do_item',                 'docs/21_comissoes.sql'),
        ('pagar_comissoes',                        'docs/21_comissoes.sql (2 parametros)'),
        ('gerar_crediario',                        'docs/23_crediario.sql (2 parametros)'),
        ('receber_crediario',                      'docs/23_crediario.sql (1 parametro: jsonb)'),
        ('atualizar_programa_fidelidade_updated_at', 'docs/25_fidelidade.sql'),
        ('gerar_pontuacao_fidelidade',              'docs/25_fidelidade.sql'),
        ('resgatar_fidelidade',                     'docs/25_fidelidade.sql (1 parametro: jsonb)')
     ) AS f(nome, script)
LEFT JOIN pg_proc p
       ON p.proname = f.nome
      AND p.pronamespace = 'public'::regnamespace

UNION ALL

SELECT
    'COLUNA',
    tab.tabela || '.' || tab.nome,
    CASE WHEN c.column_name IS NULL THEN '>>> FALTA' ELSE 'existe' END,
    CASE WHEN c.column_name IS NULL THEN tab.script ELSE '' END
FROM (VALUES
        ('transactions',    'sale_id',                'docs/14_vendas_base.sql'),
        ('transactions',    'sale_payment_id',         'docs/14_vendas_base.sql'),
        ('transactions',    'cash_register_id',        'docs/14_vendas_base.sql'),
        ('transactions',    'source',                  'docs/14_vendas_base.sql'),
        ('stock_movements', 'sale_id',                 'docs/15_finalizacao_venda.sql'),
        ('stock_movements', 'sale_item_id',             'docs/15_finalizacao_venda.sql'),
        ('cash_registers',  'expectedCash',             'docs/20_fechamento_de_caixa.sql'),
        ('cash_registers',  'countedCash',              'docs/20_fechamento_de_caixa.sql'),
        ('cash_registers',  'cashDifference',           'docs/20_fechamento_de_caixa.sql'),
        ('cash_registers',  'closingNote',              'docs/20_fechamento_de_caixa.sql'),
        ('clients',         'loyaltyEnrolled',          'docs/25_fidelidade.sql'),
        ('clients',         'loyaltyPoints',            'docs/25_fidelidade.sql'),
        ('business_info',   'whatsappChargeMessage',    'docs/26_mensagens_editaveis.sql'),
        ('loyalty_programs','reward_message',           'docs/26_mensagens_editaveis.sql (precisa do 25 antes)'),
        ('sales',           'sold_by',                  'docs/27_niveis_de_acesso.sql'),
        ('professionals',   'email',                    'docs/28_acesso_do_profissional.sql')
     ) AS tab(tabela, nome, script)
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public'
      AND c.table_name   = tab.tabela
      AND c.column_name  = tab.nome

ORDER BY 1, 2;

-- ============================================================
-- CONFERIR SE O PATCH DE ACESSO (SCRIPT 27) JÁ ENTROU NAS RPCs
-- ============================================================
-- finalizar_venda e resgatar_fidelidade são recriadas pelos scripts 15 e 25,
-- e depois PATCHADAS por substituição de texto pelos scripts 23 (só
-- finalizar_venda) e 27 (as duas). Rodar antes do ensaio do script 27, para
-- confirmar que o texto que ele vai procurar ainda está lá:

SELECT
    'finalizar_venda' AS funcao,
    pg_get_functiondef(p.oid) ILIKE '%Fase I (niveis de acesso)%' AS ja_tem_patch_do_27,
    pg_get_functiondef(p.oid) ILIKE '%gerar_crediario%' AS ja_tem_patch_do_23
FROM pg_proc p
WHERE p.proname = 'finalizar_venda' AND p.pronamespace = 'public'::regnamespace

UNION ALL

SELECT
    'resgatar_fidelidade',
    pg_get_functiondef(p.oid) NOT ILIKE '%Somente o proprietario pode resgatar beneficio%',
    NULL
FROM pg_proc p
WHERE p.proname = 'resgatar_fidelidade' AND p.pronamespace = 'public'::regnamespace;

-- ============================================================
-- COMO LER O RESULTADO
-- ============================================================
--
-- Mesma regra do docs/diagnostico_banco.sql: rodar os scripts da coluna
-- "rode" NA ORDEM (14 a 28), um de cada vez, conferindo erro zero antes do
-- próximo. Todos são idempotentes NO DDL — mas o patch de texto em
-- finalizar_venda (dentro dos scripts 23 e 27) só aplica uma vez: depois de
-- aplicado com sucesso, rodar o script de novo lança
-- "RAISE EXCEPTION 'Patch (...) nao encontrou...'" em vez de reaplicar. Isso
-- é seguro (não corrompe nada), mas confirma que o script já rodou — não é
-- sinal de erro se aparecer numa segunda tentativa.
--
-- ⚠️ Conferir o catálogo não é conferir a funcionalidade. Depois de cada
-- fase aplicada, testar na tela como dono e como um login de teste 'staff'.
