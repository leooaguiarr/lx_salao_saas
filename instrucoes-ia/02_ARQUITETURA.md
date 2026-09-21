# Arquitetura

## Visão geral

```text
Navegador (painel / link público / landing)
   │  HTML + CSS + JS puros, sem build, sem módulos
   ├──► server.js (Node, só módulos nativos)
   │       ├─ arquivos estáticos de public/
   │       └─ /api/*  → cadastro de salão e Asaas (usa a service role key)
   └──► Supabase autohospedado (supabase-js pelo CDN)
           ├─ Auth (e-mail e senha)
           ├─ Postgres com RLS por salão
           └─ RPCs: venda, comissão, crediário, fidelidade, agendamento público
```

**Não há npm, bundler nem transpilação.** O `package.json` não tem
dependências, e isso é proposital: mantenha assim.

## Arquivos

```text
server.js              servidor HTTP: estáticos, rotas do SPA e /api/*
asaas-service.js       cliente da API do Asaas (clientes, assinaturas, Pix)
Dockerfile             imagem do Coolify (node:20-alpine, porta 8000)
supabase/migrations/   schema do banco, em ordem (ver 03_BANCO_DE_DADOS.md)
supabase/functions/    Edge Function acesso-profissional (login do barbeiro)
docs/legacy_sql/       scripts da era Alabama — HISTÓRICO, não rodar
docs/                  runbook, planos e proposta comercial (para humanos)
instrucoes-ia/         esta pasta

public/
  landing.html          página de vendas (/) — CSS próprio: qutter-landing.css
  index.html            TODO o painel e o link público: um HTML só
  config.js             URL/chave anon do Supabase e a tabela de PLANS
  theme.js              ThemeManager: tema claro/escuro do salão
  saas-plan.js          trava de recursos por plano + modal de checkout Pix
  api.js                DataService: a camada de dados (Supabase + cache local)
  app.js                o núcleo (~6.700 linhas): navegação, agenda, clientes,
                        financeiro, caixa, PDFs, link público, configurações
  estoque.js            produtos, movimentação, vitrine pública
  encaixe.js            "Chegou agora"
  ajuda.js              guia rápido (o conteúdo é DADO, em duas listas no topo)
  vendas-base.js        aba Vendas: histórico, filtros, detalhe
  venda-calculo.js      a conta da venda: itens, desconto, rateio
  checkout.js           modal de venda
  comissoes.js          aba Comissões e baixa em lote
  crediario.js          aba Crediário: parcelas, recebimento, cobrança
  fidelidade.js         aba Fidelidade: clube, pontos, resgate
  recibo.js             recibo da venda em PDF e por WhatsApp
  topbar.js             sino de avisos do cabeçalho e chip do plano
  pwa.js                service worker, botão "Instalar aplicativo", theme-color
  sw.js                 service worker (cache da interface)
  manifest.webmanifest  identidade do app instalável
  *.css                 um por área; index.css é a base e os tokens de cor
```

### Ordem dos scripts importa

Tudo compartilha o **escopo global**, e a ordem das tags no fim do
`index.html` é uma dependência: `config` → `theme` → `saas-plan` → `api` →
`app` → módulos (`estoque`, `encaixe`, `ajuda`, os sete de venda) → `topbar` →
`pwa`. Os módulos leem o estado e as funções que o `app.js` define. Entre os de
venda a ordem também importa (`venda-calculo` precisa de `vendas-base`,
`checkout` precisa do cálculo). **Não reordene sem motivo.**

**Funcionalidade nova vai num arquivo novo**, carregado depois do `app.js`. O
escopo é o mesmo, e o `app.js` já é grande demais.

## Rotas (server.js + app.js)

| Caminho | O que serve |
| --- | --- |
| `/`, `/home`, `/landing` | `landing.html` |
| `/api/health` | status e ambiente do Asaas |
| `POST /api/auth/register-salon` | cria usuário, salão, vínculo de dono, profissional e serviço iniciais; começa o teste de 7 dias |
| `POST /api/asaas/create-subscription` | cria cliente + assinatura no Asaas e devolve o QR Code Pix |
| `POST /api/asaas/webhook` | eventos do Asaas → RPC `process_asaas_webhook`. Exige o cabeçalho `asaas-access-token` igual a `ASAAS_WEBHOOK_TOKEN` (401 se não); 500 se o banco recusar, para o Asaas reenviar |
| arquivo com extensão | estático de `public/` |
| qualquer outro caminho | `index.html` — o `app.js` decide se é painel ou link público |

O `app.js` separa os dois pela lista **`ROTAS_INTERNAS`** (`app`, `painel`,
`login`, `admin`...). O que não está nela é **slug de salão** e abre o link
público. Ao criar uma rota nova do painel, **inclua-a em `ROTAS_INTERNAS`** e
na cópia da lista no `<head>` do `index.html` (a que decide se o manifest da
PWA entra) — senão ela vira "Link de agendamento não encontrado".

**As abas do painel ficam no hash** (`/app#vendas`), nunca no caminho: o
caminho pertence ao slug do link público.

## Fluxo de dados — a regra central

O estado vive no objeto global **`data`** do `app.js` (`data.clients`,
`data.appointments`, ...). Cada coleção tem uma chave em **`STATE_KEYS`**
(`lexion_clients`, ...), que é também a chave do cache no `localStorage`.

**Gravar:**

```js
data.clients.push(novo);
saveData(STATE_KEYS.CLIENTS, data.clients);   // → DataService.save → upsert do array INTEIRO
```

**Excluir** não pode depender do `saveData`: o upsert nunca apaga a linha que
saiu do array. Toda exclusão chama **`await DataService.deleteItem('tabela', id)`**
(com rollback local se falhar).

**Operações de dinheiro** (venda, comissão, crediário, fidelidade, movimento
de estoque) **não** usam upsert: são **RPCs atômicas** no banco
(`DataService.finalizarVenda`, `pagarComissoes`, `receberCrediario`,
`resgatarFidelidade`, `registrarMovimentoEstoque`). O saldo de pontos e o de
estoque são do banco, nunca do navegador.

**Ler:** `loadData()` → `DataService.loadAll()`. Um ciclo em segundo plano
(`refreshCloudData`) recarrega a cada **2 min** no expediente e **10 min** fora
dele, e ao voltar para a aba. O ciclo é **leve**: não traz `business_info`,
`professionals` nem `products` (pesados por causa das fotos em base64); a volta
completa vem a cada 20 min ou ao abrir Estoque/Configurações. No modo leve
essas chaves voltam `undefined` **de propósito** — é o que faz a tela manter o
que já tem. Trocar por `[]` apaga a agenda sem erro no console.

**Falha de rede ou de sessão:** o `loadAll` renova a sessão e tenta de novo;
se ainda falhar, **cai para o cache do `localStorage`**, nunca para lista
vazia. Por isso uma tabela ou coluna ausente no banco não dá erro visível — o
app segue com o dado local. É a causa de "funciona aqui e não nos outros
aparelhos".

## Multi-tenant, papéis e acesso

- O salão é identificado por `user_id` (o id do **dono**) em todas as tabelas.
  `DataService.getTenantId()` devolve esse id, e a RLS filtra por
  `public.salao_do_usuario()`.
- Vários logins por salão via **`salon_members`** (`salon_id`, `role`,
  `professional_id`). `role`: `owner`, `admin` ou `staff`.
- **Barbeiro** = login com `role` `staff` (`DataService.ehBarbeiro()`); o
  `professional_id` diz qual profissional ele é.
  Ele não vê as abas de `ABAS_SO_DO_DONO` (`leads`, `configuracoes`,
  `financeiro`): a trava está no `switchTab`, no `renderPageData` e no CSS
  `body.acesso-barbeiro`. **O que ele pode ler de verdade é decidido pela RLS**;
  a tela só esconde.
- O login do barbeiro é criado pela Edge Function `acesso-profissional`, porque
  mexer em `auth.users` exige a service role key, que nunca pode ir ao
  navegador.

## Planos

`saas-plan.js` lê `businessInfo.plan_id` e `trial_ends_at` e bloqueia na tela
os recursos fora do plano (menu com cadeado "PRO", limite de profissionais).
Os preços e limites estão em `config.js`. No banco, só o limite de
profissionais é garantido (gatilho `trg_check_professional_limit`); o resto é
trava de interface (ver riscos em [01_PRODUTO_E_ESTADO.md](01_PRODUTO_E_ESTADO.md)).

## Link público de agendamento

Fala com o banco **só por RPCs `SECURITY DEFINER`** (em
`supabase/migrations/06_rpcs_publicas.sql`): `get_public_salon`,
`check_client_exists`, `check_week_appointments`, `create_public_booking`,
`get_public_queue`, `get_public_products`. A chave anon não tem acesso direto a
tabela nenhuma. Há limite de chamadas por IP contra varredura de telefones.
Nunca devolva ao público quantidade de estoque, motivo de folga ou dado de
outro cliente.

## Tema e aparência

- Tokens de cor no `:root` do `index.css` (escuro é o padrão; o claro é
  `[data-theme="claro"]`). Use as variáveis (`--bg-primary`, `--primary`,
  `--text-muted`, `--border-color`...), nunca cor fixa.
- O tema é do **salão** (`business_info.theme`), vale para a equipe toda.
- Breakpoints usados: 1460, 1024, 992, 880, 768 (celular), 600, 420 px.
