-- ============================================================
-- FECHA `anon` NAS DUAS FUNÇÕES INTERNAS QUE SOBRARAM
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- Terceira vez que este mesmo bug aparece, e agora com o quadro completo.
--
-- Uma função criada em `public` chega a `anon` por DOIS caminhos:
--
--   1. PUBLIC — o Postgres concede EXECUTE a PUBLIC em toda função nova.
--      No `proacl` aparece como `=X/postgres`: o campo vazio antes do `=` é
--      PUBLIC, e todo papel é membro dele.
--   2. Nominal — o `ALTER DEFAULT PRIVILEGES` do Supabase concede EXECUTE
--      diretamente a anon, authenticated e service_role. Aparece como `anon=X`.
--
-- Fechar um não fecha o outro:
--
--   O script 19 revogava de PUBLIC e o grant nominal ficava de pé
--   (`checar_limite`, `finalizar_venda`, `registrar_movimento_estoque`).
--   O script 21 revogava do nominal e o de PUBLIC ficava de pé
--   (`pagar_comissoes`, `gerar_comissao_do_item`).
--
-- Sobraram estas duas, as últimas do banco onde o comentário do script diz uma
-- coisa e o `proacl` diz outra:
--
--   venda_em_json              — script 15 fez `REVOKE ALL ... FROM public` e o
--                                grant nominal ficou. O risco real é baixo: ela
--                                NÃO é SECURITY DEFINER, então roda com o
--                                privilégio de quem chamou e a RLS de `sales` a
--                                barra — anon não lê linha nenhuma por ela. Mas
--                                a intenção do script era fechá-la.
--   atualizar_venda_updated_at — corpo de gatilho, do script 14. Chamável fora
--                                do contexto de gatilho não faz nada útil, e
--                                ninguém precisa chamá-la.
--
-- Nenhuma função é recriada aqui: só permissão.

REVOKE EXECUTE ON FUNCTION public.venda_em_json(uuid, text, boolean)
    FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.atualizar_venda_updated_at()
    FROM PUBLIC, anon, authenticated;

-- `venda_em_json` continua com `authenticated`: é ela que monta o retorno de
-- `finalizar_venda`, e o painel logado chega até ela por esse caminho.
GRANT EXECUTE ON FUNCTION public.venda_em_json(uuid, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- 1. As duas fecharam para `anon`:
--
--      SELECT proname,
--             has_function_privilege('anon', oid, 'EXECUTE')          AS anon,
--             has_function_privilege('authenticated', oid, 'EXECUTE') AS autenticado
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND proname IN ('venda_em_json', 'atualizar_venda_updated_at');
--
--    Esperado:
--      venda_em_json              -> anon false, autenticado true
--      atualizar_venda_updated_at -> anon false, autenticado false
--
-- 2. **O quadro inteiro**, que é o que vale a pena guardar. Só as seis funções
--    do link público podem estar abertas a `anon`:
--
--      SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') AS anon
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND prokind = 'f'
--      ORDER BY anon DESC, proname;
--
--    Esperado com `anon = true`, e mais nenhuma:
--      check_client_exists, check_week_appointments, create_public_booking,
--      get_public_products, get_public_queue, get_public_salon
--
--    `meu_papel`, `meu_profissional` e `salao_do_usuario` também aparecem, e
--    ali é DE PROPÓSITO: o script 11 concede a `anon` explicitamente. Sem
--    sessão elas devolvem nulo, e a página pública não passa por elas.
--
-- 3. O checkout continua funcionando: conclua uma venda de verdade com login de
--    proprietário. `venda_em_json` está no caminho de retorno da RPC.
--
-- ============================================================
-- PARA O PRÓXIMO SCRIPT
-- ============================================================
--
-- Toda função nova em `public` nasce chamável por `anon`. Para fechar de
-- verdade, as duas linhas:
--
--     REVOKE EXECUTE ON FUNCTION public.minha_funcao(...) FROM PUBLIC, anon;
--     GRANT  EXECUTE ON FUNCTION public.minha_funcao(...) TO authenticated;   -- se for o caso
--
-- E a conferência tem de ser no BANCO, com `has_function_privilege`. Ler o
-- arquivo .sql não mostra um grant que o arquivo nunca escreveu — foi
-- exatamente assim que os três casos passaram despercebidos.
