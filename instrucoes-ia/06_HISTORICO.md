# Histórico

Uma linha por mudança relevante, a mais recente no fim. O detalhe de cada uma
está na mensagem do commit (`git log`). O período anterior ao SaaS, da Alabama
Barbearia (julho a setembro de 2026), está em
[legado/AGENT_HANDOFF_ALABAMA.md](legado/AGENT_HANDOFF_ALABAMA.md).

| Quando | O que aconteceu |
| --- | --- |
| 19/09/2026 | Primeiro commit do SaaS multi-tenant a partir do sistema da Alabama: landing, schema com planos e `salon_members`, Supabase autohospedado no Coolify. |
| 19/09/2026 | Integração com o Asaas: serviço, assinatura com Pix, webhook. Cadastro com teste de 7 dias. Landing "Qutter" unissex. |
| 20/09/2026 | Marca Alabama removida. 38 scripts SQL antigos arquivados em `docs/legacy_sql/`. Deploy automático GitHub → Coolify ativo. |
| 20/09/2026 | `/app` deixa de ser lido como slug de salão (`ROTAS_INTERNAS`). |
| 20/09/2026 | Migração 06: as RPCs do link público, que tinham ficado fora do `00_MASTER`, voltam; o link público volta a funcionar. |
| 20/09/2026 | Painel: menu agrupado, barra superior com sino e chip do plano, tema claro/escuro por salão (migração 05); base do escuro vira preto neutro. |
| 20/09/2026 | Correções de layout: barra lateral sem rolagem, cabeçalho sem transbordo, busca global removida. |
| 21/09/2026 | **Painel instalável como aplicativo (PWA)**: manifest, service worker, ícones, botão "Instalar aplicativo" (iPhone com passo a passo), barra de abas inferior no celular, `minimum-scale=1`. Versão 2.1.0. |
| 21/09/2026 | Criada a pasta `instrucoes-ia/`, que reúne as instruções para agentes. Substitui o `PROJECT_HANDOVER.md` da raiz. Correção: o botão de instalar aparecia mesmo com o app instalado (`[hidden]` vencido pelo CSS). |
| 21/09/2026 | **Cobrança protegida**: o webhook do Asaas passa a exigir token (`ASAAS_WEBHOOK_TOKEN`) e a responder 500 quando o banco recusa; migração 07 tira a `process_asaas_webhook` da chave anon e congela as colunas de cobrança de `business_info` para o navegador. `GEMINI.md` na raiz e regras para agentes em paralelo. |
| 21/09/2026 | **Checkout protegido**: `/api/asaas/create-subscription` passa a exigir o token de login e a tirar o salão dele; o plano só muda na confirmação do pagamento (migração 08). |
| 21/09/2026 | **Ajustes de layout e navegação**: barra lateral retrátil com botão de seta no desktop (com persistência em localStorage), novos ícones SVG lineares no menu lateral, renomeação Dashboard → Início e Vendas → Atendimentos, chip de teste grátis realocado para o rodapé da sidebar e sub-aba "Meu Plano" adicionada em Configurações. Versão 2.2.0. |
| 24/09/2026 | **Landing page redesenhada**: nova identidade premium e clara, Hero centrado no produto, demonstrações de agenda/clientes/agendamento/financeiro, segmentos e planos simplificados, prova social fictícia removida e cadastro do teste gratuito preservado. A Home anterior ficou salva na tag `backup-home-anterior-redesign-2026-09-24`. |
| 25/09/2026 | **Direção de design nova, aprovada e ainda não implementada**: nove temas por nicho (barbearia, salão, estética) montados de três eixos — base clara/escura, personalidade e acento —, acento com paleta curada e cor livre atrás de "Usar a cor da minha marca", link público herdando o tema, e seis correções de layout independentes de cor. Especificação com os valores exatos em [DESIGN_E_TEMAS.md](DESIGN_E_TEMAS.md); protótipo de oito telas em <https://claude.ai/artifact/QUxn2Few2eZ7FjHF7M6ZxQ>. |
| 26/09/2026 | **Redesenho, primeira entrega**: Início e Agenda refeitos (indicadores com referência, agenda de hoje em linhas, cor só com sentido, trilho de 60px e vagas livres clicáveis na Agenda); **nove temas** com três personalidades (fonte, raio, bordas), escolhidos em Configurações; migração 09 amplia o CHECK de `business_info.theme`; `business_type` passa a ser gravado; seletor de cor primária removido. `print.js` ganha `--js`. Versão 2.3.0. |
| 26/09/2026 | **Outras abas na linguagem nova**: cards de número sem ícone e com número grande em todas as abas, "Resumo do dia" do Financeiro como indicadores, títulos de painel sem ícone, cor só com sentido (pendente em âmbar, projeção e saldo neutros, gráfico numa cor só), tons fixos de status trocados pelas variáveis do tema; selo "PRO" e modais de plano/checkout seguem o tema. Versão 2.3.1. |
