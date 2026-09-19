# 💈 LEXION SALÃO & BARBEARIA SAAS — GUIA COMPLETO DE CONTINUIDADE (HANDOVER)

Este documento foi criado para permitir que **qualquer inteligência artificial, agente ou desenvolvedor** em qualquer computador entenda instantaneamente o estado atual do projeto, a arquitetura implementada, os acessos configurados e as próximas tarefas pendentes.

---

## 1. 📌 Identificação do Projeto & Repositório

- **Nome do Projeto**: Lexion Salão & Barbearia SaaS (Multi-Tenant)
- **Repositório GitHub**: [https://github.com/leooaguiarr/lx_salao_saas](https://github.com/leooaguiarr/lx_salao_saas)
- **Branch Principal**: `main`
- **Público-Alvo (100% Unissex)**:
  1. ✂️ **Barbearias & Studios Masculinos**
  2. 💇 **Salões de Beleza & Cabeleireiros(as) Femininos**
  3. ✨ **Clínicas de Estética, Manicures & Spas**
- **Modelo de Monetização**: Assinatura Mensal Recorrente via Gateway Asaas:
  - **Solo / Individual**: R$ 59,90/mês (1 profissional, agenda, vendas e caixa).
  - **Equipe (Até 4)**: R$ 119,90/mês (até 4 profissionais + controle de estoque).
  - **Ilimitado Premium**: R$ 199,90/mês (equipe ilimitada + clube de fidelidade + crediário + mensagens customizadas).
  - **Trial**: 7 dias grátis para todos os novos cadastros, sem necessidade de informar cartão de crédito.

---

## 2. 🌐 Infraestrutura em Produção (VPS Hostinger + Coolify)

Toda a infraestrutura é dedicada e autohospedada, sem dependência de planos pagos do Supabase Cloud:

| Serviço | URL Oficial | Detalhes Técnicos |
| :--- | :--- | :--- |
| 🚀 **Web App / Landing Page** | `https://salao.lexionconsultoria.tech` | Node.js 20 (Docker Container na porta 8000) com SSL Let's Encrypt |
| 🗄️ **Supabase Kong API** | `https://apisalao.lexionconsultoria.tech` | Gateway REST, Auth e Storage do Supabase |
| 📊 **Supabase Studio** | `https://supabasesalao.lexionconsultoria.tech` | Painel Web do PostgreSQL, SQL Editor e Gerenciador de Tabelas |
| ⚙️ **Painel Coolify** | `http://72.62.139.92:8000` | Orquestrador de containers Docker da VPS |
| 🖥️ **IP Dedicado da VPS** | `72.62.139.92` | Hostinger KVM 4 (Ubuntu 24.04 LTS, 4 vCPUs, 16 GB RAM, 200 GB NVMe) |

---

## 3. 🗃️ Banco de Dados & Arquitetura Multi-Tenant (PostgreSQL)

O schema do banco foi executado e está unificado no arquivo:
📂 `supabase/migrations/00_MASTER_ALL_IN_ONE.sql`

### Principais Tabelas:
1. `public.plans`: Tabela mestre com os 3 planos SaaS (`individual`, `equipe_4`, `ilimitado`).
2. `public.business_info`: Informações do estabelecimento, slug único, nicho (`business_type`), cores, status de assinatura (`trial`, `active`, `past_due`) e `trial_ends_at`.
3. `public.salon_members`: Relação entre usuários autenticados (`auth.users`) e salões com controle de papéis (`owner`, `staff`, `admin`).
4. `public.services`, `public.professionals`, `public.clients`: Tabelas operacionais do salão.
5. `public.appointments`, `public.professional_blocks`: Agendamento interno e público.
6. `public.transactions`, `public.cash_registers`: Controle de caixa, entradas e saídas.
7. `public.products`, `public.stock_movements`: Gestão de produtos e estoque.
8. `public.sales`, `public.sale_items`, `public.sale_payments`, `public.commissions`: Ponto de Venda (PDV) e rateio de comissões por profissional.
9. `public.credit_accounts`, `public.credit_installments`: Crediário e parcelamento direto.
10. `public.loyalty_programs`, `public.loyalty_rewards`, `public.loyalty_redemptions`: Clube de pontos e fidelização.
11. `public.subscriptions`, `public.asaas_invoices`, `public.asaas_webhooks`: Histórico financeiro sincronizado com o gateway Asaas.

### Políticas de Segurança (Row Level Security):
- Cada consulta utiliza a função `public.salao_do_usuario()`, garantindo isolamento total entre os estabelecimentos.
- Rotas anônimas de agendamento têm permissão restrita para ler serviços/profissionais ativos e inserir agendamentos.

---

## 4. 💳 Gateway de Pagamento Asaas (Recorrência & Pix)

A integração com o Asaas está pronta em:
- 📂 `asaas-service.js`: Biblioteca de integração (clientes, assinaturas, pagamentos e QR Code Pix).
- 📂 `server.js`: Endpoints REST e webhook.

### Endpoints da API:
- `GET /api/health`: Health check da aplicação e do ambiente Asaas (`sandbox` ou `production`).
- `POST /api/auth/register-salon`: Cria o usuário no Supabase Auth, inicia o período de 7 dias grátis, cria o slug, o salão em `business_info`, define `salon_members` como `owner` e adiciona o profissional/serviço inicial de acordo com o nicho.
- `POST /api/asaas/create-subscription`: Cria ou localiza o cliente no Asaas pelo CPF/CNPJ, gera a assinatura recorrente e retorna o **QR Code Pix** e a linha digitável do **Pix Copia e Cola**.
- `POST /api/asaas/webhook`: Webhook oficial cadastrado no painel do Asaas que recebe os eventos:
  - `PAYMENT_CREATED`, `PAYMENT_AUTHORIZED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`.
  - Dispara a RPC `process_asaas_webhook` no banco para atualizar o salão para `active` automaticamente.

---

## 5. 🎨 Frontend & Design Qutter de Luxo Unissex

### Estrutura de Arquivos Públicos (`public/`):
- `public/landing.html`: Página principal redesenhada com base no template **Qutter**. Contém Hero monumental, seletor dinâmico de 3 nichos (Barbearia, Salão Feminino, Estética/Spa), grid de recursos, tabela de planos, depoimentos, accordion FAQ e modal de Teste de 7 Dias.
- `public/qutter-landing.css`: Design system *Dark Luxury* com dourado refinado (`#c89547`), fundo preto nobre (`#09090c`), superfícies em glassmorphism e tipografia Google Fonts (*Outfit* e *Plus Jakarta Sans*).
- `public/assets/`: Fotografias unissex geradas em alta resolução:
  - `hero_unisex_salon.jpg`: Fachada e interior de salão de luxo.
  - `niche_barbearia.jpg`: Serviços de corte e barba masculina.
  - `niche_salao_feminino.jpg`: Cabelos e mechas femininas de alto padrão.
  - `niche_estetica_spa.jpg`: Tratamentos faciais, estética corporal e spa.
- `public/index.html` & `public/app.js`: Aplicação principal do sistema (Dashboard, Agenda, Clientes, Vendas/PDV, Estoque, Financeiro, Comissões, Fidelidade e Crediário).
- `public/saas-plan.js`: Gatekeeper de planos (trava recursos PRO com base no plano contratado) e **Modal de Checkout Pix Asaas** integrado diretamente no painel.

---

## 6. 🚀 Como Rodar o Projeto em Qualquer Computador

### Pré-requisitos:
- Node.js 18+ instalado.
- Git instalado.

### Passo a Passo:
```bash
# 1. Clonar o repositório
git clone https://github.com/leooaguiarr/lx_salao_saas.git
cd lx_salao_saas

# 2. Instalar dependências
npm install

# 3. Iniciar o servidor local
node server.js
```
- Acesse a **Landing Page**: [http://localhost:8000/](http://localhost:8000/)
- Acesse o **Painel do Sistema**: [http://localhost:8000/app](http://localhost:8000/app)

---

## 7. 📋 Tarefas Futuras & Próximos Passos Recomendados

Quando você ou outro agente for retomar o desenvolvimento, foque nas seguintes melhorias:

1. **Ativar o Deploy Automático no Coolify (Webhook do GitHub)**:
   - No Coolify ([http://72.62.139.92:8000](http://72.62.139.92:8000)), abrir a aplicação `lx_salao_saas` e copiar a URL da seção **Webhooks / Deploy Webhook**.
   - No GitHub ([https://github.com/leooaguiarr/lx_salao_saas/settings/hooks](https://github.com/leooaguiarr/lx_salao_saas/settings/hooks)), adicionar a URL como webhook em formato `application/json` disparado a cada `push`.
   - Assim que configurado, qualquer `git push origin main` fará deploy automático no ar sem necessidade de entrar no Coolify.

2. **Validação de Fluxo de Pagamento Real no Asaas**:
   - Efetuar uma assinatura teste via Pix no modal de checkout do sistema e acompanhar o evento `PAYMENT_CONFIRMED` no log do webhook em `https://salao.lexionconsultoria.tech/api/asaas/webhook`.

3. **Painel Super Admin (Visão da Lexion Consultoria)**:
   - Criar uma tela exclusiva para o dono do SaaS visualizar todos os salões cadastrados, faturamento total, taxas Asaas e churn.

4. **Integração do Disparador de WhatsApp (CRM Automatizado)**:
   - Conectar uma instância de API do WhatsApp (ex: Evolution API ou Z-API) para enviar lembretes automáticos de agendamento 2 horas antes do atendimento e mensagens de pós-venda/aniversário.

5. **Upload de Imagens para o Supabase Storage**:
   - Conectar o seletor de fotos de profissionais e produtos diretamente ao bucket do Supabase Storage já provisionado no Coolify.

---

> **Status do Projeto**:
> Sistema 100% funcional no ar, banco de dados Supabase ativo, webhook Asaas registrado, nova Landing Page Qutter de luxo unissex publicada e modal de onboarding com 7 dias grátis funcionando com sucesso.
