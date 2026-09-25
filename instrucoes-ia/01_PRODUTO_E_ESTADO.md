# Produto e estado atual

- Repositório: <https://github.com/leooaguiarr/lx_salao_saas> (público), branch `main`
- Última atualização deste documento: 24/09/2026

## O que é

**Lexion Salão & Barbearia** é um SaaS multi-tenant de gestão para
barbearias, salões de beleza e clínicas de estética. Cada estabelecimento tem
o seu painel (agenda, vendas, clientes, financeiro, caixa, estoque, comissões,
crediário, fidelidade) e um **link público de agendamento**
(`/<slug-do-salão>`) para o cliente final agendar sem login.

O painel roda no navegador do computador e **instala como aplicativo no
celular** (PWA, ver [APP_CELULAR.md](APP_CELULAR.md)).

Nasceu do sistema feito sob medida para a **Alabama Barbearia**
(`lx_salao_alabama`), transformado em SaaS em 19–20/09/2026. Muita regra de
negócio e muito comentário no código vêm dessa época — o diário completo está
em [legado/AGENT_HANDOFF_ALABAMA.md](legado/AGENT_HANDOFF_ALABAMA.md).

## Planos e cobrança

Assinatura mensal pelo **Asaas** (Pix recorrente), com **7 dias de teste
grátis** sem cartão:

| Plano | `plan_id` | Preço | Libera |
| --- | --- | --- | --- |
| Solo / Individual | `individual` | R$ 59,90 | 1 profissional, agenda, clientes, vendas, caixa |
| Equipe | `equipe_4` | R$ 119,90 | até 4 profissionais + estoque |
| Ilimitado Premium | `ilimitado` | R$ 199,90 | ilimitado + fidelidade + crediário |

Os limites estão em `public/config.js` (`PLANS`) e são aplicados na tela por
`public/saas-plan.js`. No banco, **só o limite de profissionais** é garantido
(gatilho `trg_check_professional_limit`, migração 03). Estoque, fidelidade e
crediário são travados apenas na tela. Ver *Riscos*.

## Infraestrutura (tudo autohospedado)

| Serviço | Endereço | Observação |
| --- | --- | --- |
| Site + painel | <https://salao.lexionconsultoria.tech> | Node 20 em Docker (Coolify), porta 8000. Landing em `/`, painel em `/app` |
| API Supabase (Kong) | <https://apisalao.lexionconsultoria.tech> | REST, Auth, Storage, Edge Functions |
| Supabase Studio | <https://supabasesalao.lexionconsultoria.tech> | SQL Editor — é por aqui que migrações são aplicadas, à mão |
| Coolify | <http://72.62.139.92:8000> | Orquestrador. VPS Hostinger KVM 4, Ubuntu 24.04 |

- **Deploy automático**: webhook do GitHub → Coolify. Todo push na `main` vai
  ao ar em cerca de 1 minuto.
- **Variáveis de ambiente no Coolify** (não estão no repositório):
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ASAAS_API_KEY`, `ASAAS_ENV`,
  `ASAAS_WEBHOOK_TOKEN` (o mesmo valor do "Token de autenticação" da tela do
  webhook no painel do Asaas; sem ele o webhook recusa tudo).
- **Conferir a configuração sem abrir o Coolify**: `GET /api/health` diz
  `webhookProtegido` (token configurado?) e `chaveSupabase` (tem que ser
  `service_role`). Nunca mostra o valor de segredo nenhum.
- **Asaas em SANDBOX, de propósito** (decidido em 21/09/2026). O sistema
  ainda está em fase de testes da API de cobrança: `ASAAS_ENV=sandbox` e chave
  `$aact_hmlg_` no Coolify, webhook com token cadastrado na conta sandbox.
  Nenhuma cobrança é real. Confira o ambiente em vigor pelo campo `asaasEnv`
  do `/api/health`. **A volta para produção faz parte do *Checklist de
  lançamento*, mais abaixo neste arquivo.**

## Estado atual (24/09/2026)

**No ar e funcionando:**

- Landing page (`public/landing.html`) com identidade clara em off-white,
  verde profundo e caramelo; demonstrações visuais de agenda, clientes,
  agendamento online e financeiro; planos e FAQ simplificados. Métricas e
  depoimentos sem comprovação foram removidos. O cadastro do teste grátis
  continua em `POST /api/auth/register-salon`.
- Painel completo: tudo o que está em [FUNCIONALIDADES.md](FUNCIONALIDADES.md),
  menos os módulos pausados (Mensagens e Kanban de Leads, ocultos no menu).
- Tema claro/escuro por salão.
- **PWA instalável** com barra de abas inferior no celular — conferido em
  produção por teste headless em 21/09/2026.
- Link público de agendamento, depois da migração
  `supabase/migrations/06_rpcs_publicas.sql` (20/09/2026).

**Não verificado — confirmar antes de afirmar que funciona:**

- **Edge Function `acesso-profissional`** (login individual de barbeiro). O
  código está em `supabase/functions/`, mas não há registro de ela ter sido
  publicada no Supabase autohospedado.
- **Fluxo de pagamento real** do Asaas ponta a ponta (assinatura Pix →
  webhook → salão `active`).
- Se o `SUPABASE_SERVICE_ROLE_KEY` está configurado no Coolify. Sem ele o
  `server.js` cai na chave anon, e o cadastro de salão pela Admin API falha.
  Conferir pelo campo `chaveSupabase` do `/api/health`.

## Riscos abertos (prioridade)

1. **Cobrança burlável — corrigido e aplicado em 21/09/2026.** Eram três
   portas para um salão ficar ativo ou mudar de plano sem pagar: webhook sem
   token, `process_asaas_webhook` executável pela chave anon, e o dono
   podendo editar `status`/`plan_id`/`trial_ends_at` da própria linha. O
   `server.js` exige o token (no ar, `webhookProtegido: true`,
   `chaveSupabase: service_role`) e a migração `07_protege_cobranca.sql` foi
   rodada no Studio com as 4 conferências `true`. **Pendente:** confirmar o
   mesmo token no painel do Asaas e ver o próximo evento real chegar com 200
   no log de webhooks dele. Se a fila do Asaas tiver sido pausada pelas
   recusas, reativá-la lá. (Por ora o token está na conta **sandbox**; na
   conta principal entra no checklist de lançamento.)
   **Quarta porta, fechada no código em 21/09/2026:** o checkout
   (`/api/asaas/create-subscription`) aceitava qualquer `salonId` no corpo e
   gravava o plano no salão ao GERAR a cobrança, sem pagamento. Agora exige
   o token de login e o plano só muda na confirmação. **Falta rodar a
   migração `08_plano_so_apos_pagamento.sql`** no Studio — sem ela, o
   pagamento confirmado ativa o salão mas não troca o plano.
2. **A chave anon lê e grava tabelas direto.** As políticas
   "Agendamento: ..." da migração 01 dão à chave pública (que está no
   `config.js`) leitura de **todos** os `business_info`, `appointments` e
   `professional_blocks` de todos os salões, e INSERT livre em
   `appointments`. Conferido em 21/09/2026: a anon enxerga a linha de
   `business_info` do salão existente. O link público já usa só RPCs
   (migração 06), então essas políticas provavelmente sobraram — mas
   removê-las mexe no agendamento público e precisa de teste ponta a ponta
   antes.
3. **Duas RPCs que o front chama não estão no schema do SaaS** (suspeita,
   levantada em 21/09/2026). `pagar_comissoes` (baixa de comissões) e
   `registrar_movimento_estoque` (toda entrada/saída de estoque) existem só nos
   scripts antigos (`docs/legacy_sql/21_comissoes.sql` e
   `add_movimentacao_estoque.sql`); o `00_MASTER` e as migrações 01–06 não as
   criam. É o mesmo buraco que derrubou o link público e foi fechado pela 06.
   **Não dá para confirmar pela chave anon** — conferir no SQL Editor:
   `select proname from pg_proc where proname in ('pagar_comissoes','registrar_movimento_estoque');`
   Se vier vazio, falta uma migração nova portando as duas para o schema atual.
4. **Limites de plano de estoque, fidelidade e crediário só no front-end.** Um
   usuário técnico contorna a trava do `saas-plan.js` pelo console. O limite de
   profissionais já é garantido por gatilho no banco.
5. **Sem testes automáticos no repositório.** A Alabama tinha 28
   (`lx_salao_alabama/testes/`); nenhum veio para o SaaS. Só existem as
   ferramentas de [ferramentas/](ferramentas/).
6. **Fotos em base64 no banco** (logo, profissionais, produtos). Pesam em cada
   carga. O bucket do Storage já existe no Coolify, mas não está ligado.

## Onde paramos (21/09/2026) — retomar por aqui

O código da cobrança está pronto e no ar (webhook com token, checkout com
login, plano só na confirmação). Falta **testar na sandbox**, nesta ordem:

1. **Rodar a migração `08_plano_so_apos_pagamento.sql`** no SQL Editor (3
   linhas `ok = true`). Ainda não foi rodada.
2. **Trocar o Asaas para sandbox no Coolify** (aplicação `lx_salao_saas`,
   variáveis Production): `ASAAS_ENV=sandbox`, `ASAAS_API_KEY` da sandbox
   (`$aact_hmlg_...`), **Redeploy**. Em 21/09 o `/api/health` ainda dizia
   `asaasEnv: production` — **testar assim gera cobrança real**. Conferir
   `asaasEnv: sandbox` antes do passo 3.
3. O teste: entrar no painel como **dono** de um salão de teste →
   Ctrl+Shift+R → clicar no **selo do plano, no rodapé do menu lateral**
   ("Ver planos e assinar") → escolher um plano diferente do atual → gerar
   o Pix (a sandbox exige CPF válido; se o QR não aparecer, cadastrar uma
   chave Pix aleatória na conta sandbox). **Até aqui o plano não pode ter
   mudado.**
4. No painel da sandbox, abrir a cobrança e **confirmar o recebimento**.
5. Conferir: evento com **200** no log de webhooks da sandbox (401 = token
   diferente do Coolify; 500 = banco recusou); plano novo no selo; e
   `select name, status, plan_id from public.business_info;` com
   `status = active` e o plano escolhido. Se o salão não ativar, anotar o
   **nome do evento** que o Asaas mandou: a função só ativa com
   `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` ou `PAYMENT_AUTHORIZED`.

Pendências menores do mesmo assunto: apagar o log falso do teste de
21/09 (`delete from public.asaas_webhooks where payment_id = 'pay_falso';`)
e, depois do teste, o risco 2 (políticas da chave anon).

## Checklist de lançamento

**Antes de abrir para clientes pagantes, tudo isto precisa estar feito.** Se
o Leonardo falar em "colocar em produção", "lançar" ou "começar a cobrar",
é esta lista — confira item por item com ele, não presuma que algo já foi
feito.

1. **Limpar o banco de dados.** Hoje ele tem salões, clientes, agendamentos,
   vendas e cobranças de teste. O Leonardo vai pedir o comando: escreva o SQL
   de limpeza nessa hora, olhando o schema do momento (não um script
   guardado, que fica velho). Regras:
   - **Mostre antes de apagar**: primeiro um `SELECT` com a contagem por
     tabela do que vai sair, e só depois o `DELETE`, com o aval dele.
   - **Preserve** a tabela `plans` (os três planos) e toda a estrutura:
     tabelas, funções, gatilhos, políticas.
   - Apague também os usuários de teste em `auth.users`. As tabelas da
     migração 01 têm `user_id ... ON DELETE CASCADE`, mas **confira no schema
     do momento se todas têm** — tabela sem cascade deixa linha órfã ou
     bloqueia o delete. Apague também os logs
     `asaas_webhooks`, `asaas_invoices` e `subscriptions` do período sandbox —
     são ids da sandbox, que não existem na conta de produção.
   - Pergunte se algum salão ou login deve ficar (ex.: uma conta de
     demonstração da Lexion).
2. **Asaas de volta para produção**, no Coolify (aplicação
   `lx_salao_saas`, variáveis do tipo Production) e depois **Redeploy**:
   - `ASAAS_ENV=production`
   - `ASAAS_API_KEY` com a chave da **conta principal** (`$aact_prod_...`).
     Ambiente e chave mudam juntos: a chave de um com o endereço do outro faz
     o Asaas recusar tudo.
3. **Webhook na conta principal do Asaas** (Integrações → Webhooks):
   URL `https://salao.lexionconsultoria.tech/api/asaas/webhook`, "Token de
   autenticação" igual ao `ASAAS_WEBHOOK_TOKEN` do Coolify, eventos de
   cobrança (criada, confirmada, recebida, vencida, estornada, removida),
   ativo.
4. **Desativar o webhook da sandbox** (ou trocar o token dele). Se ficar
   ativo com o token certo, pagamentos de teste chegam ao servidor de
   produção e são aceitos.
5. **Conferir** no `/api/health`: `asaasEnv: production`,
   `webhookProtegido: true`, `chaveSupabase: service_role`.
6. **Um pagamento real de ponta a ponta**, de valor baixo: assinatura pelo
   checkout Pix → pagar → webhook com 200 no log do Asaas → salão `active`.
   Depois, estornar pelo painel do Asaas.

## Trabalho combinado e ainda não começado (25/09/2026)

**Redesenho do painel com temas por nicho.** O Leonardo não gostou das cores
nem do layout do painel; a direção foi desenhada, revisada com ele e aprovada
em 25/09. Ele pediu para retomar na noite de 25/09.

A especificação completa — nove temas com os valores de cor exatos, as três
personalidades tipográficas, o modelo de escolha do salão e as seis correções
de layout — está em [DESIGN_E_TEMAS.md](DESIGN_E_TEMAS.md). O protótipo de oito
telas está em <https://claude.ai/artifact/QUxn2Few2eZ7FjHF7M6ZxQ> (privado).

Pontos que essa página não repete e valem lembrar aqui:

- **A landing também será refeita** nessa linguagem. O Leonardo disse que a
  landing atual é protótipo, então a identidade nasce no painel. Combinar com
  o Gemini, que mexeu nela por último.
- **Duas colunas que o painel nunca envia**: `business_type` e `primary_color`
  existem em `business_info` mas ficaram fora da `allowedCols` do `api.js`, e
  por isso o nicho e a cor configurados na tela não persistem. Entra junto.
- Nada disso foi implementado: o código no ar continua com o tema claro/escuro
  da migração 05.

## O que vem a seguir

Da lista do dono do projeto, em ordem sugerida:

1. Testar a cobrança na sandbox de ponta a ponta: checkout Pix → "confirmar
   recebimento" no painel da sandbox → webhook com 200 → salão ativo.
2. Fechar o risco 2 (políticas anon), com teste do link público.
3. Conferir o risco 3 no SQL Editor e, se faltar, escrever a migração.
4. Validar um pagamento real de assinatura ponta a ponta.
5. **Painel Super Admin** da Lexion: todos os salões, faturamento, churn.
6. **WhatsApp automático** (Evolution API ou Z-API): lembrete 2h antes,
   pós-venda e aniversário.
7. **Upload de imagens no Supabase Storage** no lugar do base64.
8. Trazer os testes da Alabama para `instrucoes-ia/ferramentas/` ou `tests/`.
