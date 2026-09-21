# Banco de dados (Supabase autohospedado)

## Onde está e como se mexe

- Postgres do Supabase rodando no Coolify. Studio em
  <https://supabasesalao.lexionconsultoria.tech>.
- **O agente não tem acesso direto ao banco.** O conector Supabase MCP fala
  com o Supabase Cloud, não com esta instância. Toda migração é **escrita
  pelo agente e colada pelo Leonardo** no SQL Editor do Studio.
- Local e produção usam **o mesmo banco** (`public/config.js`). Não existe
  ambiente de teste.

## Migrações

`supabase/migrations/` é a fonte da verdade do schema atual:

| Arquivo | Conteúdo |
| --- | --- |
| `00_MASTER_ALL_IN_ONE.sql` | 01 a 04 concatenados, para montar um banco do zero |
| `01_saas_multi_tenant_base.sql` | planos, `business_info`, `salon_members`, tabelas operacionais, RLS, `salao_do_usuario()` |
| `02_sales_commissions_loyalty.sql` | vendas, itens, pagamentos, comissões, crediário, fidelidade |
| `03_saas_subscriptions_asaas.sql` | assinaturas, faturas, webhooks do Asaas, limite de profissionais |
| `04_rpcs_finalizar_venda_e_fidelidade.sql` | `finalizar_venda`, `receber_crediario`, `resgatar_fidelidade`, `venda_em_json` |
| `05_tema_do_painel.sql` | coluna `theme` em `business_info` |
| `06_rpcs_publicas.sql` | RPCs do link público, freio por IP, colunas que faltavam |

`docs/legacy_sql/` guarda os 38 scripts da era Alabama. **São histórico:
não rode.** Servem para consultar como uma função era, e muitos comentários do
código citam esses arquivos pelo nome antigo (`docs/25_fidelidade.sql` =
`docs/legacy_sql/25_fidelidade.sql`).

### Como escrever uma migração nova

- Próximo número em sequência: `07_<assunto>.sql`, em `supabase/migrations/`.
- **Idempotente**: `create table if not exists`, `add column if not exists`,
  `create or replace function`, `drop policy if exists` antes de `create
  policy`. Tem que poder rodar duas vezes sem erro.
- Cabeçalho explicando **por que** o arquivo existe (veja o da 06 como modelo).
- Termine com `NOTIFY pgrst, 'reload schema';` para a API enxergar o que mudou.
- Função chamada pelo painel: `revoke ... from anon` e `grant ... to
  authenticated`. Função do link público: `SECURITY DEFINER`, `set search_path
  = public`, e grant a `anon` **com a assinatura completa** (parâmetros com
  `DEFAULT` contam).
- **Código que depende da migração só vai ao ar depois dela aplicada.** Ao
  entregar, diga explicitamente ao Leonardo o que colar no Studio e em que ordem.

### Comportamento do SQL Editor do Studio

1. **Analisa o script inteiro antes de executar.** Tabela criada no próprio
   script é invisível aos comandos seguintes (`42P01 relation does not
   exist`). Crie a tabela numa execução separada, antes.
2. **Mostra só o resultado do último comando.** Para conferências múltiplas,
   junte num `SELECT ... UNION ALL`.
3. **`RAISE NOTICE` não aparece.** Não use NOTICE como forma de comunicar.
4. Roda o script numa transação: um erro na última linha desfaz tudo, inclusive
   as funções criadas antes dele.

## Colunas e nomes

- Tabelas em inglês e snake_case; **colunas vindas do front em camelCase e
  entre aspas** (`"clientId"`, `"profId"`, `"paymentStatus"`, `"avatarUrl"`,
  `"registradoEm"`). Sem as aspas o Postgres cria em minúsculas e o PostgREST
  não encontra.
- O dono do registro é `user_id` = id do **dono** do salão (não de quem
  gravou). RLS: `user_id = public.salao_do_usuario()`.
- Funções auxiliares da RLS: `salao_do_usuario()`, `meu_papel()`,
  `meu_profissional()`.

## Armadilhas do PostgREST que já derrubaram o sistema

- **Upsert em lote usa a união das chaves.** Se um objeto do array tem a chave
  e outro não, o que não tem vai com `NULL` explícito — nunca com o `DEFAULT`.
  Numa coluna `NOT NULL`, o lote inteiro falha. Por isso existem
  `normalizaFidelidade()` e `normalizaServico()` no `api.js`: **coluna `NOT
  NULL` nova em tabela salva por `saveData` precisa de normalização igual.**
- **Coluna inexistente derruba a linha inteira** (`PGRST204`). Mandar um campo
  que o banco não tem faz o registro todo ser recusado. O `business_info` tem
  uma lista `allowedCols` no `api.js`: **campo novo do estabelecimento entra
  na migração E nessa lista**, senão fica só no navegador de quem editou.
- **`PGRST202` = função não existe** (ou assinatura errada). O front costuma
  engolir o erro e cair no cache local — o sintoma é "não acontece nada" ou
  "funciona só neste aparelho".
- **Saldo nunca vem do navegador.** Pontos de fidelidade e quantidade em
  estoque são alterados só por gatilho/RPC. O `api.js` remove essas chaves do
  payload para um aparelho com cache velho não sobrescrever o saldo.

## Diagnóstico rápido

Existência de funções (rodar no SQL Editor):

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;
```

(Prefixe com `p.`: `oid` existe nas duas tabelas e fica ambíguo.)

Chamar uma RPC pública pela API, sem gravar nada (slug que não existe):

```bash
curl -s -X POST "https://apisalao.lexionconsultoria.tech/rest/v1/rpc/get_public_salon" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" -d '{"p_slug":"__nao_existe__"}'
```

`null` = a função existe; `PGRST202` = não existe. A chave anon está em
`public/config.js` (é pública por natureza). Para RPC interna do painel essa
checagem **não serve**: a anon não enxerga funções sem permissão, e a resposta
é igual existindo ou não — confira pelo SQL acima.
