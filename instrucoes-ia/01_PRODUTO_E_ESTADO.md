# Produto e estado atual

- Repositório: <https://github.com/leooaguiarr/lx_salao_saas> (público), branch `main`
- Última atualização deste documento: 21/09/2026

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
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ASAAS_API_KEY`, `ASAAS_ENV`.
- **Asaas em produção** (conferido em 21/09/2026 por `GET /api/health` →
  `"asaasEnv":"production"`). Cobrança real.

## Estado atual (21/09/2026)

**No ar e funcionando:**

- Landing page (`public/landing.html`) com os três nichos e o cadastro do teste
  grátis (`POST /api/auth/register-salon`).
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

## Riscos abertos (prioridade)

1. **Webhook do Asaas sem autenticação.** `POST /api/asaas/webhook`
   (`server.js`) aceita qualquer requisição e repassa o evento para a RPC
   `process_asaas_webhook`. Quem conhecer a URL pode forjar um
   `PAYMENT_CONFIRMED` e ativar um salão sem pagar. Correção: conferir o
   cabeçalho `asaas-access-token` contra um segredo em variável de ambiente
   (o token é configurado no painel do Asaas, na tela do webhook).
2. **Duas RPCs que o front chama não estão no schema do SaaS** (suspeita,
   levantada em 21/09/2026). `pagar_comissoes` (baixa de comissões) e
   `registrar_movimento_estoque` (toda entrada/saída de estoque) existem só nos
   scripts antigos (`docs/legacy_sql/21_comissoes.sql` e
   `add_movimentacao_estoque.sql`); o `00_MASTER` e as migrações 01–06 não as
   criam. É o mesmo buraco que derrubou o link público e foi fechado pela 06.
   **Não dá para confirmar pela chave anon** — conferir no SQL Editor:
   `select proname from pg_proc where proname in ('pagar_comissoes','registrar_movimento_estoque');`
   Se vier vazio, falta uma migração `07` portando as duas para o schema atual.
3. **Limites de plano de estoque, fidelidade e crediário só no front-end.** Um
   usuário técnico contorna a trava do `saas-plan.js` pelo console. O limite de
   profissionais já é garantido por gatilho no banco.
4. **Sem testes automáticos no repositório.** A Alabama tinha 28
   (`lx_salao_alabama/testes/`); nenhum veio para o SaaS. Só existem as
   ferramentas de [ferramentas/](ferramentas/).
5. **Fotos em base64 no banco** (logo, profissionais, produtos). Pesam em cada
   carga. O bucket do Storage já existe no Coolify, mas não está ligado.

## O que vem a seguir

Da lista do dono do projeto, em ordem sugerida:

1. Fechar o risco 1 (token do webhook do Asaas).
2. Conferir o risco 2 no SQL Editor e, se faltar, escrever a migração `07`.
3. Validar um pagamento real de assinatura ponta a ponta.
4. **Painel Super Admin** da Lexion: todos os salões, faturamento, churn.
5. **WhatsApp automático** (Evolution API ou Z-API): lembrete 2h antes,
   pós-venda e aniversário.
6. **Upload de imagens no Supabase Storage** no lugar do base64.
7. Trazer os testes da Alabama para `instrucoes-ia/ferramentas/` ou `tests/`.
