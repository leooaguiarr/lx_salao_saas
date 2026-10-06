# Produto e estado atual

- Repositório: <https://github.com/leooaguiarr/lx_salao_saas> (público), branch `main`
- Última atualização deste documento: 05/10/2026

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

**Plano Solo = "modo Solo"** (decisão do Leonardo, 30/09/2026): o plano
`individual` é do profissional que trabalha sozinho, usa o sistema no celular
entre um corte e outro e fica com todo o lucro. Decidido **pelo plano**, nunca
pela quantidade de profissionais. `SaaSPlanManager.ehSolo()` põe a classe
`plano-solo` no `<html>`, e o CSS esconde tudo o que tem `.so-equipe`: aba
Comissões, escolha e filtros de profissional, comissão no cadastro, acesso de
profissional. Comissão é sempre 0% (`server.js` no cadastro, migração 11 para
os antigos, formulário força 0). No Início, quem está na cadeira ou ficou "a
receber" ganha o botão **Receber**: valor preenchido, Pix/Dinheiro/Débito/
Crédito em um toque, pelo mesmo checkout (`receberAtendimentoRapido`), e em
seguida o próximo cliente com "Começar agora". Falta a etapa 3: um Início
próprio do Solo no celular (quem está na cadeira, o próximo, recebido hoje).
No Solo o menu mostra Início, Agenda, Atendimentos, Clientes, Financeiro e
Configurações; Estoque, Fidelidade e Crediário **ficam visíveis com cadeado**
(vitrine do upgrade, decisão de 05/10/2026), assim como "Adicionar
Profissional". Conta de teste do Solo: e-mail do Leonardo com o alias `+solo`, salão
"Teste Solo" (`teste-solo-cr2y`), criada pela API em 05/10 — sai na limpeza.

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
- **Asaas indo para PRODUÇÃO (05/10/2026), decisão do Leonardo: cobrar de
  verdade.** O `/api/health` já dizia `asaasEnv: production`. Chave e webhook
  da sandbox foram removidos na conta sandbox. Em andamento: chave
  `$aact_prod_` e `ASAAS_WEBHOOK_TOKEN` no Coolify, webhook na conta principal
  (v3, envio **sequencial**, eventos CREATED, CONFIRMED, RECEIVED, OVERDUE,
  DELETED, REFUNDED, CREDIT_CARD_CAPTURE_REFUSED, REPROVED_BY_RISK_ANALYSIS,
  CHARGEBACK_REQUESTED — **sem** AUTHORIZED, que a função trata como pago),
  migração 08 a confirmar e um pagamento real de ponta a ponta com estorno.
  **Feito em 05/10:** chave de produção, webhook e token no ar; Coolify com
  healthcheck em `/api/health`. Checkout real no cartão gerou a assinatura na
  conta principal, e `PAYMENT_CREATED`/`PAYMENT_DELETED` chegaram com
  `processed = true` em `asaas_webhooks`. O Leonardo **não pagou** (removeu a
  cobrança): a ativação por pagamento confirmado **não foi vista em produção**
  — conferir no primeiro cliente real (`business_info.status = active`).
  Checkout com **cartão recorrente** (fatura do Asaas, cartão nunca passa pelo
  servidor) e Pix, versão 2.8.0. Estorno e chargeback só ficam registrados:
  não bloqueiam o salão sozinhos.

## Estado atual (24/09/2026)

**No ar e funcionando:**

- Landing segmentada (`public/landing-preview.html`) com entrada neutra escura
  e três experiências comerciais: Barbearia, Salão de beleza e Nail & Beauty.
  Cada nicho tem linguagem, cores, exemplos de agenda e rota própria em
  `/segmentos/*`; as chamadas ocupam telas completas. O cadastro do teste grátis
  continua em `POST /api/auth/register-salon`.
- Painel completo: tudo o que está em [FUNCIONALIDADES.md](FUNCIONALIDADES.md),
  menos os módulos pausados (Mensagens e Kanban de Leads, ocultos no menu).
- Nove temas por salão, três por nicho (ver *Redesenho*, mais abaixo).
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
2. **A chave anon lê e grava tabelas direto — FECHADO em 05/10/2026.** A
   migração `12_fecha_acesso_anonimo.sql` foi aplicada: apagou as seis
   políticas abaixo e fixou o `search_path` do gatilho de limite de
   profissionais; o Security Advisor do Supabase zerou os avisos. Conferido
   por fora com a chave anon: SELECT nas cinco tabelas volta `[]`, INSERT em
   `appointments` volta 401, e `get_public_salon` segue respondendo. O
   `api.js` (2.6.4) não lê mais `business_info` direto. Texto original: as políticas
   "Agendamento: ..." da migração 01 dão à chave pública (que está no
   `config.js`) leitura de **todos** os `business_info`, `appointments` e
   `professional_blocks` de todos os salões, e INSERT livre em
   `appointments`. Conferido em 21/09/2026: a anon enxerga a linha de
   `business_info` do salão existente. O link público já usa só RPCs
   (migração 06), então essas políticas provavelmente sobraram — mas
   removê-las mexe no agendamento público e precisa de teste ponta a ponta
   antes.
3. **Vendas — migração 13 aplicada em 05/10/2026.** Até ela, a
   `finalizar_venda` recusava toda venda com item (ver 05_ARMADILHAS, "schema
   de vendas"). Depois de aplicar: receber um atendimento de teste pelo
   "Receber" e pela aba Atendimentos, e conferir Financeiro e Comissões.
   **Comissões e estoque — migração 14 aplicada e conferida pela API em 05/10/2026.**
   `pagar_comissoes` e `registrar_movimento_estoque` não existiam no banco
   (chamadas pela API com a conta Teste Solo: PGRST202). A 14 cria as duas
   nas colunas do SaaS e acrescenta a `stock_movements` as colunas que a tela
   lê; o `api.js` expõe `qty` e `base_amount`. Ainda sem conferência
   ponta a ponta: `receber_crediario` e `resgatar_fidelidade` (migração 04)
   existem, mas podem ter o mesmo descompasso de nomes que a `finalizar_venda`
   tinha.
4. **Limites de plano de estoque, fidelidade e crediário só no front-end.** Um
   usuário técnico contorna a trava do `saas-plan.js` pelo console. O limite de
   profissionais já é garantido por gatilho no banco.
5. **Sem testes automáticos no repositório.** A Alabama tinha 28
   (`lx_salao_alabama/testes/`); nenhum veio para o SaaS. Só existem as
   ferramentas de [ferramentas/](ferramentas/).
6. **Fotos em base64 no banco** (logo, profissionais, produtos). Pesam em cada
   carga. O bucket do Storage já existe no Coolify, mas não está ligado.

## Onde paramos (05/10/2026) — retomar por aqui

No ar: versão **2.8.2** (`?v=98`). Migrações 11 a 14 aplicadas. O dia foi
de consertos que só apareceram usando o sistema de verdade (detalhe de cada
um no 06_HISTORICO): vendas não gravavam (13), comissões e estoque sem as
RPCs (14), chave anon com acesso às tabelas (12), checkout de assinatura
com falso "sessão expirou", link público "travando" no Confirmar.

**Asaas em produção, cobrando de verdade.** Chave `$aact_prod_` e token no
Coolify (Literal, sem Buildtime), webhook sequencial na conta principal,
healthcheck do Coolify em `/api/health` porta 8000. Checkout com cartão
recorrente (fatura do Asaas) ou Pix. Testado sem pagar: assinatura criada
no Asaas e `PAYMENT_CREATED`/`PAYMENT_DELETED` gravados com
`processed = true`.

**Pendências do Leonardo** (perguntar no início da sessão):

1. **Remover a assinatura de teste** dele no Asaas (*Clientes → Leonardo
   Aguiar → Assinaturas*). Ele removeu só a cobrança; a assinatura gera outra
   no mês seguinte.
2. **Migração 08** — não há confirmação de que rodou. Sem ela, quem paga é
   ativado mas não muda de plano. Rodar (é idempotente) e ver 3× `true`.
3. **Testar pela tela** (conta de desenvolvedor, Ilimitado): entrada de
   estoque (saldo e histórico) e baixa de comissão com a coluna "Base".
4. **Primeiro cliente real que pagar**: conferir
   `select name, status, plan_id from public.business_info where ...` com
   `status = active`. A ativação por pagamento nunca foi vista em produção.

**Contas de teste:** Teste Solo (e-mail do Leonardo com o alias `+solo`, slug
`teste-solo-cr2y`, plano individual) — tem agendamentos e duas vendas de
teste; a senha está com o Leonardo. Conta de desenvolvedor no Ilimitado
(`contato@lexionconsultoria.com.br`). Ambas saem (ou ficam) na limpeza do
checklist de lançamento.

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
     demonstração da Lexion). **Existe uma conta de desenvolvedor** (pedida
     em 26/09/2026): salão no plano `ilimitado`, `status = 'active'` e
     `trial_ends_at` daqui a 100 anos, liberado pelo SQL Editor, no e-mail
     `contato@lexionconsultoria.com.br`. Deixe-a fora da limpeza.
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

## Redesenho com temas por nicho (26/09/2026) — em andamento

A direção está em [DESIGN_E_TEMAS.md](DESIGN_E_TEMAS.md) (protótipo em
<https://claude.ai/artifact/QUxn2Few2eZ7FjHF7M6ZxQ>, privado).

**Feito e publicado em 26/09 (versão 2.3.0, migração 09 aplicada):**

- Os seis defeitos de layout no **Início** e na **Agenda**: indicadores com
  número grande e referência, cor só com sentido (verde pago, âmbar a
  receber, acento "agora"), agenda de hoje em linhas densas, um par só de
  botões, contraste dos rótulos, trilho de 60px na Agenda e vagas livres
  clicáveis ("livre · 14:30").
- Os **nove temas** e as **três personalidades** (fonte, raio de canto,
  cartões sem borda no Clean), escolhidos em Configurações → Dados do
  Estabelecimento. Os do nicho aparecem primeiro.
- `business_type` passou a ser gravado (entrou na `allowedCols`).
- O seletor "Identidade Visual (Cor Primária)" **saiu**: pintava só parte do
  painel e nunca era gravado. `primary_color` voltou a ser usado em 27/09, para o acento.

**Também feito em 26/09 (versão 2.3.1):** as outras abas na mesma linguagem —
todo `.metric-card` sem ícone e com número grande, títulos de painel sem
ícone, sem faixas laterais coloridas, cores de status só com sentido, tons
fixos antigos trocados pelas variáveis do tema (inclusive o selo "PRO" e os
modais de plano/checkout do `saas-plan.js`).

**Também feito em 27/09 (versão 2.4.0):** acento personalizável (paleta
curada por tema e "Usar a cor da minha marca", ajustada até ter 4,5:1 e
gravada em `primary_color`); link público herdando tema e acento (migração
10, que faz `get_public_salon` devolver `theme`, aplicada em 27/09); cards do Início alinhados à grade de 4 colunas; sino no fim
do cabeçalho; tela de carregamento neutra até o tema do salão estar aplicado
(nada de piscar o tema padrão).

**Também feito em 30/09:** landing refeita e segmentada por nicho. A entrada
escura leva a `/segmentos/barbearia`, `/segmentos/salao` ou
`/segmentos/estetica`; cada experiência usa personalidade e exemplos próprios,
mantém o cadastro real de 7 dias e organiza as chamadas como telas completas.

**Também feito em 05/10:** a entrada da landing ficou mais leve: as cenas de
atendimento com pessoas deram lugar a naturezas-mortas dos três nichos, os
cards ficaram cerca de 15% mais baixos no desktop e ganharam foco dourado
discreto, sem mudar as rotas nem o comportamento da escolha.

**Também feito em 05/10 (versão 2.6.0):** quem conclui o cadastro pela landing
recebe um onboarding de boas-vindas orientado a valor antes do passo a passo
técnico. A landing também ganhou cabeçalho mais compacto, artigo feminino da
marca em toda a narrativa e rodapé institucional completo, com contato,
navegação, redes sociais, acesso, política de privacidade, termos e crédito da
consultoria. Na entrada neutra aparece apenas a faixa de copyright e crédito.

**Também feito em 05/10 (versão 2.6.1):** as rotas comerciais foram
simplificadas para `/segmentos/barbearia`, `/segmentos/salao` e
`/segmentos/estetica`. As antigas rotas `/para/*` respondem com redirecionamento
permanente, preservando links que já tenham sido divulgados.

**Também feito em 05/10 (versão 2.6.2):** a landing recebeu a Google tag do
Google Ads (`AW-18490550479`) com Consent Mode. Cookies de medição e publicidade
ficam negados por padrão até a escolha do visitante; o rodapé permite reabrir
as preferências, e a Política de Privacidade informa a finalidade da medição.

**Também feito em 05/10 (versão 2.6.3):** a conversão do Google Ads é
disparada apenas depois que `/api/auth/register-salon` confirma a criação da
conta. O redirecionamento aguarda o callback da tag, com fallback temporizado,
e nenhum identificador interno ou dado pessoal é enviado no evento.

**Falta, na ordem:**

1. Estrutura interna das telas (tabelas, filtros, modal de venda) ainda é a
   antiga, só com as cores novas. Refazer o que o Leonardo apontar.

## O que vem a seguir

Da lista do dono do projeto, em ordem sugerida:

1. Conferir `receber_crediario` e `resgatar_fidelidade` (migração 04) contra
   o payload que a tela manda — mesmo descompasso possível da
   `finalizar_venda` (ver 05_ARMADILHAS, "schema de vendas").
2. Estorno (`PAYMENT_REFUNDED`) e chargeback desativarem o salão sozinhos;
   hoje só ficam no log `asaas_webhooks`.
3. Limpeza do banco (checklist de lançamento, item 1).
4. **Painel Super Admin** da Lexion: todos os salões, faturamento, churn.
5. **WhatsApp automático** (Evolution API ou Z-API): lembrete 2h antes,
   pós-venda e aniversário.
6. **Upload de imagens no Supabase Storage** no lugar do base64.
7. Trazer os testes da Alabama para `instrucoes-ia/ferramentas/` ou `tests/`.
