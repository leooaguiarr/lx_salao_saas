-- ============================================================
-- SCRIPT 31: O PROFISSIONAL DAS VENDAS DE BALCÃO JÁ GRAVADAS
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTE SCRIPT CONSERTA
--
-- A venda de balcão nunca gravou o responsável no CABEÇALHO. O balcão escolhia
-- quem atendeu, a venda fechava, e a coluna Profissional do histórico dizia
-- "Não informado" no segundo seguinte.
--
-- O nome não se perdeu: ele foi para `sale_items.professional_id`, que é de
-- onde a comissão sempre saiu — nenhuma comissão ficou faltando por causa
-- disso. O que ficou vazio foi:
--
--   `sales.professional_id`   — o que a lista de Vendas mostra;
--   `transactions."profId"`   — o que o Financeiro usa para separar o
--                               faturamento por pessoa. Sem ele, a venda do
--                               barbeiro caiu em "Barbearia (Geral)".
--
-- O CÓDIGO da tela já foi corrigido nos dois lados: a venda nova leva o
-- responsável derivado dos itens, e o histórico lê os itens quando o cabeçalho
-- está vazio. Este script é para o que JÁ está no banco — sem ele, o Financeiro
-- continua sem saber de quem foi o faturamento das vendas antigas.
--
-- O CRITÉRIO, E POR QUE ELE É ESTREITO
--
-- Só recebe dono a venda cujos itens de serviço são TODOS do mesmo
-- profissional. Venda de dois barbeiros na mesma conta fica como está, de
-- propósito: eleger um deles jogaria o faturamento inteiro para o lado dele.
-- Nesse caso a tela mostra os dois nomes, lendo dos itens.
--
-- Nada é sobrescrito: só linhas com o campo NULL entram.

BEGIN;

-- ------------------------------------------------------------
-- 1. O cabeçalho da venda
-- ------------------------------------------------------------
-- O snapshot do nome vem junto, na mesma convenção do resto da tabela: o
-- profissional pode sair do salão amanhã, e o histórico não pode ficar órfão.
WITH dono_unico AS (
    SELECT i.sale_id,
           i.user_id,
           MIN(i.professional_id) AS professional_id
      FROM sale_items i
     WHERE i.item_type = 'service'
       AND i.professional_id IS NOT NULL
     GROUP BY i.sale_id, i.user_id
    -- Um só profissional em todos os serviços da venda. Dois ou mais: fora.
    HAVING COUNT(DISTINCT i.professional_id) = 1
)
UPDATE sales s
   SET professional_id   = d.professional_id,
       professional_name = COALESCE(
           (SELECT p.name FROM professionals p
             WHERE p.id = d.professional_id AND p.user_id = s.user_id),
           s.professional_name)
  FROM dono_unico d
 WHERE s.id = d.sale_id
   AND s.user_id = d.user_id
   AND s.professional_id IS NULL;

-- ------------------------------------------------------------
-- 2. O lançamento no Financeiro
-- ------------------------------------------------------------
-- `finalizar_venda` copia o profissional do cabeçalho para cada pagamento
-- (script 15, seção 8). Como o cabeçalho estava vazio na hora, a cópia veio
-- vazia — agora que ele tem dono, o razão acompanha.
--
-- Só as transações QUE VIERAM DE VENDA (`source = 'sale'`): lançamento manual
-- do Financeiro tem o profissional que alguém escolheu na mão, e não é da
-- conta deste script.
UPDATE transactions t
   SET "profId" = s.professional_id
  FROM sales s
 WHERE t.sale_id = s.id
   AND t.user_id = s.user_id
   AND t.source = 'sale'
   AND s.professional_id IS NOT NULL
   AND NULLIF(TRIM(COALESCE(t."profId", '')), '') IS NULL;

COMMIT;

-- ============================================================
-- CONFERENCIA
-- ============================================================
--
-- 1. Quantas vendas ainda estão sem dono, e por quê:
--
--      SELECT CASE
--               WHEN s.professional_id IS NOT NULL THEN 'com dono'
--               WHEN EXISTS (SELECT 1 FROM sale_items i
--                             WHERE i.sale_id = s.id
--                               AND i.item_type = 'service'
--                               AND i.professional_id IS NOT NULL)
--                    THEN 'sem dono unico (dois profissionais na conta)'
--               ELSE 'sem nenhum servico com profissional'
--             END AS situacao,
--             count(*)
--        FROM sales s
--       GROUP BY 1;
--
--    As duas ultimas linhas sao esperadas e corretas: a primeira delas a tela
--    resolve mostrando os dois nomes, e a segunda e venda so de produto.
--
-- 2. Nenhuma venda ficou com um dono que NAO atendeu nela:
--
--      SELECT s.id, s.professional_id
--        FROM sales s
--       WHERE s.professional_id IS NOT NULL
--         AND EXISTS (SELECT 1 FROM sale_items i
--                      WHERE i.sale_id = s.id AND i.item_type = 'service'
--                        AND i.professional_id IS NOT NULL)
--         AND NOT EXISTS (SELECT 1 FROM sale_items i
--                          WHERE i.sale_id = s.id
--                            AND i.professional_id = s.professional_id);
--
--    Tem que devolver zero linhas. (Venda de agendamento cujo item ficou no
--    nome de outra pessoa apareceria aqui — e ai o certo e conferir a venda,
--    nao mexer neste script.)
--
-- 3. O Financeiro acompanhou o cabecalho:
--
--      SELECT count(*) AS pagamentos_de_venda_sem_profissional
--        FROM transactions t
--        JOIN sales s ON s.id = t.sale_id AND s.user_id = t.user_id
--       WHERE t.source = 'sale'
--         AND s.professional_id IS NOT NULL
--         AND NULLIF(TRIM(COALESCE(t."profId", '')), '') IS NULL;
--
--    Tem que devolver zero.
--
-- 4. **Teste na tela.** Abra Vendas: a coluna Profissional das vendas antigas
--    de balcao passa a mostrar quem atendeu. No Financeiro, filtre por um
--    profissional e confira que as vendas dele sairam de "Barbearia (Geral)".
