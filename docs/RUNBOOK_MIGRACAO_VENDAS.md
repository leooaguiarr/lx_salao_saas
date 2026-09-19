# Runbook — Evolução de Vendas + Níveis de Acesso na Alabama (Fase 1: banco)

> ## ✅ FASE 1 CONCLUÍDA EM 10/09/2026
>
> Os scripts 14 a 28 estão **todos aplicados e conferidos** no banco de produção
> (`ekyonsvyeydfjxdytiyu`). A verificação final devolveu **19 de 19 objetos `ok`**:
> as 9 tabelas, as 4 RPCs, as 4 colunas novas e os dois patches em `finalizar_venda`.
>
> **O que resta deste runbook:** só o passo 6 (Edge Function). O passo seguinte do
> projeto é a **Fase 2 — o front-end**, que não faz parte deste documento.
>
> Este arquivo fica como registro do que foi feito e da ordem que funcionou.

Ordem exata para colar no SQL Editor do Supabase do projeto `ekyonsvyeydfjxdytiyu`.
Cada linha é um arquivo em `docs/`. **Não pule nenhuma, mesmo as que parecem só
"correção de permissão".** Depois de cada aplicação real, conferir "erro zero"
antes de ir para a próxima.

Eu (assistente) não tenho acesso direto a este banco — cada passo precisa ser
colado e rodado por você.

> ⚠️ **Antes de colar qualquer coisa aqui, leia "Como o SQL Editor do Supabase
> executa um script" no `AGENT_HANDOFF.md`.** Três comportamentos dele (analisar
> tudo antes de executar, mostrar só o último resultado, e engolir `RAISE NOTICE`)
> explicam a maior parte dos erros desta migração — nenhum deles era defeito dos
> scripts.

## 0. Pré-voo (só leitura)

- [x] `docs/diagnostico_banco.sql` — a fundação 01-13 estava intacta.
- [x] Conferir `salon_members`. **Resultado:** dois logins, os dois `owner`
      (`lexionconsultoriatec@` e `vagner.dobarbosa@`), nenhum `staff` ainda —
      os barbeiros não têm login. `professional_id` NULL nos dois, que é o
      normal para dono.

## 1. Fase A-D — núcleo de vendas + comissões (aplicar direto)

Aplicados em 09/09/2026.

- [x] `docs/14_vendas_base.sql`
- [x] `docs/15_finalizacao_venda.sql`
- [x] `docs/16_politicas_por_comando.sql`
- [x] `docs/17_limite_das_consultas_publicas.sql`
- [x] `docs/18_remove_agendamento_antigo.sql`
- [x] `docs/19_revoke_anon_das_rpcs_internas.sql`
- [x] `docs/20_fechamento_de_caixa.sql`
- [x] `docs/21_comissoes.sql`
- [x] `docs/22_fecha_anon_nas_internas_restantes.sql`

## 2. Crediário — em três partes (a única fase com patch não re-executável)

Aplicados em 10/09/2026.

- [x] `docs/23_crediario_1_tabelas_e_rpcs.sql`
- [x] `docs/24_corrige_source_crediario.sql`
- [x] `docs/23_crediario_2_patch_real.sql`

> **O ensaio (`23_crediario_2_patch_ENSAIO.sql`) não chegou a rodar.** Ele nunca
> havia sido executado em lugar nenhum — foi escrito para a Alabama junto com a
> portabilidade, e cada tentativa descobria um defeito dele. O patch foi aplicado
> direto, com o aval do Leonardo, por três razões: as quatro âncoras já tinham
> sido vistas casando (uma tentativa fracassada imprimiu a função inteira já
> patchada), **nenhum arquivo de `public/` chama `finalizar_venda`** — então o
> patch mexia em código fora de uso —, e o caminho de volta era reexecutar o
> `15_finalizacao_venda.sql`, que é idempotente.
>
> A conferência do script 24 merece atenção: **duas versões dela davam falso
> positivo**. Procurar `receivable` em `prosrc` casa com os nomes das tabelas, e
> procurar `'receivable'` com aspas casa com o comentário "CORRECAO: era
> 'receivable'" que está dentro do próprio corpo da função. A que vale olha o que
> a função **grava**: `prosrc LIKE '%v_caixa END, ''credit''%'`.

## 3. Fase F-G — fidelidade e mensagens (aplicar direto)

- [x] `docs/25_fidelidade.sql`
- [x] `docs/26_mensagens_editaveis.sql`

## 4. Níveis de acesso

- [x] **Criar `public._backup_funcoes` numa execução separada, ANTES** — sem isso
      o script 27 falha com `42P01: relation ... does not exist`, mesmo trazendo
      o `CREATE TABLE` dentro dele. Criada com **RLS habilitada e sem política**,
      atendendo ao aviso do Supabase (o script no repositório ainda não faz isso).
- [x] `docs/27_niveis_de_acesso_ENSAIO.sql` — rodou limpo. O staff simulado
      concluiu venda de balcão com `sold_by` gravado, e foi **bloqueado** ao
      tentar fechar atendimento de outro profissional. Terminou em ROLLBACK.
- [x] `docs/27_niveis_de_acesso.sql`
- [x] `docs/28_acesso_do_profissional.sql`

## 5. Verificação final (dados reais + tela)

- [x] Catálogo completo: **19 de 19 objetos `ok`** (tabelas, RPCs, colunas e os
      dois patches em `finalizar_venda`).
- [x] As travas conferidas **na política**, não na intenção: `cash_registers` e
      `receivables` exigem as duas
      `user_id = salao_do_usuario() AND meu_papel() = 'owner'`; `salon_members`
      tem zero políticas de escrita.
- [ ] **Testar na tela como dono E como um segundo login `staff`.** Ainda não é
      possível: o front-end da Fase 2 não existe, e nenhum barbeiro tem login.
      Fica para depois da tela pronta — catálogo não é funcionalidade.

## 6. Edge Function (o único passo que falta deste runbook)

- [ ] `supabase functions deploy acesso-profissional --project-ref ekyonsvyeydfjxdytiyu`
      — **confirmar com o Leonardo antes, é publicação em produção.** Sem ela o
      dono não consegue criar login para os barbeiros: `salon_members` não tem
      política de escrita, de propósito.

## 7. Registro

- [x] Anotado em `AGENT_HANDOFF.md`: a fase completa, o comportamento do SQL
      Editor do Supabase e a pendência do RLS em `_backup_funcoes`.
- [ ] Pendência aberta (não corrigida aqui): o `add_niveis_de_acesso.sql` da
      Alabama não faz `REVOKE ALL FROM public` + `GRANT TO anon` em
      `meu_papel()`/`meu_profissional()` como a versão de origem — avaliar
      separadamente se isso afeta o link público.
