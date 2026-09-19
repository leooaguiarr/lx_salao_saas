---
title: "Plano de Implementacao - App Web para Cabeleireiros"
subtitle: "Agenda, clientes, leads, financeiro e link de agendamento"
author: "Lexion Consultoria"
date: "08/07/2026"
lang: pt-BR
geometry: margin=2cm
fontsize: 11pt
---

# 1. Visao geral do produto

A ideia e criar um app web para cabeleireiros, barbeiros e pequenos saloes, com foco em agenda, clientes, captacao de leads, fluxo de caixa e agendamento por link.

O objetivo nao e criar apenas uma agenda bonita. O produto precisa ajudar o profissional a:

- visualizar os agendamentos do dia, semana e mes;
- cadastrar e acompanhar clientes;
- entender a frequencia de corte ou atendimento de cada cliente;
- controlar leads que chegam pelo WhatsApp ou Instagram;
- acompanhar entradas, saidas e lucro;
- enviar um link de agendamento para o cliente marcar sozinho;
- reduzir horarios perdidos e melhorar o retorno de clientes antigos.

A proposta central pode ser resumida assim:

> Um sistema de agenda e gestao para cabeleireiros, com link inteligente de agendamento pelo WhatsApp e Instagram, controle de clientes, financeiro e acompanhamento de clientes que estao ha muito tempo sem retornar.

# 2. Referencias de mercado

Existem sistemas parecidos que podem servir como referencia de produto, posicionamento e funcionalidades.

## Trinks

O Trinks oferece agenda online, gestao para negocios de beleza, controle financeiro, clientes, profissionais, pagamentos, estoque, comissoes e recursos de mensagens. E uma referencia forte no Brasil para saloes, barbearias e negocios de beleza.

Referencia: https://www.trinks.com/

## Avec

A Avec trabalha com gestao para beleza, agenda, financeiro, pagamentos, agendamento pelo WhatsApp e recursos com inteligencia artificial. E uma boa referencia para posicionamento moderno, automacao e experiencia comercial.

Referencia: https://negocios.avec.app/

## Booksy

O Booksy e forte em agendamento online, marketplace, aplicativo para clientes e experiencia simples para escolher servicos, ver horarios e reservar. Serve como referencia para fluxo publico de agendamento.

Referencia: https://booksy.com/pt-br/

## AppBarber

O AppBarber e mais focado em barbearias, com agendamento por servicos cadastrados, organizacao de agenda e controle de clientes.

Referencia: https://appbarber.com.br/

## Diferencial recomendado para a Lexion

O diferencial nao deve ser competir com sistemas grandes em todos os modulos desde o inicio. O diferencial pode ser:

- agendamento por link simples para WhatsApp e Instagram;
- CRM de frequencia, mostrando clientes que precisam retornar;
- kanban de leads para nao perder contatos;
- financeiro simples e direto para profissional autonomo ou pequeno salao;
- possibilidade futura de automacoes com n8n e WhatsApp.

Muitos sistemas ficam grandes e complexos. O produto da Lexion pode comecar mais enxuto, rapido e facil de usar.

# 3. Publico-alvo inicial

O melhor publico para o MVP nao e um salao grande. O ideal e comecar com profissionais menores, que sentem dor real de organizacao e nao querem um sistema complexo.

Publico inicial recomendado:

- cabeleireiros autonomos;
- barbeiros autonomos;
- pequenas barbearias;
- pequenos saloes com ate 3 profissionais;
- profissionais que recebem muitos contatos pelo WhatsApp e Instagram;
- profissionais que ainda usam caderno, Google Calendar ou planilha.

Evite comecar por saloes grandes, porque eles costumam exigir estoque, comissoes, multiplas unidades, recepcao, caixa por operador e relatorios mais avancados.

# 4. Modulos principais do app

## 4.1 Dashboard inicial

A primeira tela deve mostrar os principais indicadores do negocio.

Indicadores recomendados:

- agendamentos de hoje;
- receita prevista do dia;
- receita recebida do dia;
- clientes novos no mes;
- clientes que estao atrasados para retorno;
- leads em aberto;
- ticket medio;
- servicos mais vendidos.

Exemplo de leitura rapida para o profissional:

- Hoje tenho 8 agendamentos.
- Receita prevista: R$ 640.
- Recebido ate agora: R$ 300.
- Tenho 22 clientes que podem ser chamados para retornar.
- Tenho 9 leads que ainda nao marcaram horario.

Esse painel precisa responder rapidamente tres perguntas:

1. Quem vem hoje?
2. Quanto vou receber?
3. Quem preciso chamar para voltar?

## 4.2 Agenda estilo Google Calendar

A agenda sera a tela principal do sistema. O visual deve lembrar a logica do Google Calendar, porque os profissionais ja entendem esse formato.

Funcionalidades essenciais:

- visualizacao por dia;
- visualizacao por semana;
- visualizacao por mes;
- criacao de agendamento manual;
- edicao de agendamento;
- cancelamento de agendamento;
- reagendamento com arrastar e soltar;
- cores por status;
- bloqueio de horarios;
- observacoes do atendimento;
- historico rapido do cliente dentro do evento;
- servico vinculado ao agendamento;
- duracao automatica conforme o servico.

Status sugeridos para agendamento:

- pendente;
- confirmado;
- concluido;
- cancelado;
- nao compareceu.

Cores sugeridas:

- pendente: amarelo;
- confirmado: azul;
- concluido: verde;
- cancelado: cinza;
- nao compareceu: vermelho.

Ponto critico: o sistema nao pode mostrar horarios disponiveis sem considerar a duracao do servico. Um corte de 40 minutos e uma coloracao de 3 horas bloqueiam tempos diferentes.

## 4.3 Cadastro de clientes

O banco de clientes deve ser simples, mas util.

Campos recomendados:

- nome completo;
- telefone/WhatsApp;
- Instagram;
- data de nascimento;
- observacoes;
- ultimo atendimento;
- frequencia media de atendimento;
- total gasto;
- servicos mais feitos;
- status do cliente.

Status sugeridos:

- novo;
- ativo;
- recorrente;
- sumido;
- VIP;
- bloqueado.

O campo de frequencia media e um diferencial. Exemplo:

> O cliente Joao costuma cortar a cada 21 dias. O ultimo corte foi ha 34 dias. O sistema deve mostrar que ele pode ser chamado para retornar.

Isso transforma o cadastro em ferramenta de venda, nao apenas em lista de contatos.

## 4.4 Link publico de agendamento

Esse e o ponto mais importante do produto.

Exemplos de link:

```text
https://app.lexion.com.br/agendar/barbearia-do-joao
https://app.lexion.com.br/agendar/joao-cabeleireiro
```

Fluxo do cliente:

1. Cliente recebe o link pelo WhatsApp, Instagram ou bio.
2. Abre a pagina de agendamento.
3. Escolhe o servico.
4. Preenche nome completo e telefone.
5. O sistema verifica se o telefone ja existe.
6. O sistema mostra os horarios disponiveis.
7. O cliente escolhe o horario.
8. O sistema cria o agendamento.
9. O cliente ve uma tela de confirmacao.
10. O profissional ve o agendamento na agenda.

Recomendacao para o MVP: nao exigir senha do cliente. Para marcar horario, nome e telefone sao suficientes.

Para cancelar, reagendar ou acessar historico, o ideal e usar validacao por codigo no WhatsApp ou SMS em uma fase posterior. Isso evita que alguem altere agendamentos usando o telefone de outra pessoa.

## 4.5 Configuracao de disponibilidade

O profissional precisa configurar quando atende.

Configuracoes necessarias:

- dias da semana em que atende;
- horario de inicio e fim;
- pausa para almoco;
- horarios bloqueados;
- folgas;
- feriados;
- antecedencia minima para agendamento;
- periodo maximo para agendamento futuro;
- intervalo entre atendimentos;
- servicos disponiveis;
- duracao de cada servico;
- preco de cada servico.

Exemplo:

- Segunda a sexta: 09:00 as 19:00.
- Sabado: 09:00 as 14:00.
- Pausa: 12:00 as 13:00.
- Corte masculino: 40 minutos.
- Barba: 30 minutos.
- Corte + barba: 70 minutos.
- Coloracao: 180 minutos.

## 4.6 Kanban de leads

O kanban deve ajudar o profissional a nao perder pessoas que chamaram, mas ainda nao agendaram.

Colunas recomendadas:

- novo lead;
- em conversa;
- link enviado;
- agendado;
- retorno futuro;
- perdido.

Exemplo pratico:

1. Cliente chama no Instagram perguntando preco.
2. Profissional cadastra como lead.
3. Envia o link de agendamento.
4. Se o cliente agenda, o card vai para agendado.
5. Se nao responde, fica em retorno futuro.

Futuramente, o lead pode entrar automaticamente por integracao com WhatsApp, Instagram, Chatwoot ou n8n.

## 4.7 Painel financeiro

O financeiro deve ser simples e direto.

Funcoes iniciais:

- registrar entradas;
- registrar saidas;
- vincular entrada a agendamento;
- marcar agendamento como pago;
- filtrar por dia;
- filtrar por semana;
- filtrar por mes;
- mostrar total de entradas;
- mostrar total de saidas;
- mostrar lucro estimado;
- mostrar ticket medio.

Formas de pagamento:

- dinheiro;
- Pix;
- cartao de credito;
- cartao de debito;
- outro.

Status financeiro do agendamento:

- pendente;
- pago;
- cortesia;
- cancelado.

No MVP, nao e necessario integrar pagamento online. Primeiro, basta registrar manualmente. Depois podem entrar Pix, Mercado Pago, Stripe ou outro gateway.

# 5. MVP recomendado

O MVP deve ser vendavel, mas nao inchado.

## Escopo do MVP 1

1. Login do profissional.
2. Cadastro do negocio.
3. Cadastro de servicos.
4. Configuracao de disponibilidade.
5. Agenda visual.
6. Cadastro de clientes.
7. Link publico de agendamento.
8. Criacao automatica de agendamento pelo cliente.
9. Financeiro basico.
10. Historico de cliente.
11. Frequencia media de atendimento.
12. Kanban simples de leads.

Esse MVP ja pode ser testado com clientes reais.

## O que nao colocar no MVP 1

Nao recomendo colocar no primeiro momento:

- estoque;
- comissao por profissional;
- multiplas unidades;
- marketplace;
- aplicativo mobile nativo;
- pagamento online;
- fidelidade complexa;
- automacao completa de WhatsApp;
- integracao com Instagram;
- relatorios muito avancados.

Esses recursos podem entrar depois. O primeiro objetivo e validar o fluxo principal: profissional configura disponibilidade, envia link e cliente agenda sozinho.

# 6. Fases de implementacao

## Fase 1 - Prototipo visual

Criar as telas principais antes de implementar regras complexas.

Telas:

- login;
- dashboard;
- agenda;
- clientes;
- detalhe do cliente;
- kanban de leads;
- financeiro;
- servicos;
- disponibilidade;
- pagina publica de agendamento;
- tela de confirmacao do agendamento.

Objetivo: validar a experiencia de uso.

## Fase 2 - Banco de dados

Criar a estrutura no Supabase/PostgreSQL.

Tarefas:

- criar tabelas principais;
- criar relacionamentos;
- configurar autenticacao;
- configurar politicas de seguranca;
- garantir separacao por negocio;
- impedir que um cliente veja dados de outro cliente da Lexion.

## Fase 3 - Agenda interna

Implementar a agenda do profissional.

Funcoes:

- criar agendamento manual;
- editar agendamento;
- cancelar agendamento;
- marcar como concluido;
- marcar como pago;
- visualizar dia, semana e mes;
- bloquear horarios;
- vincular cliente e servico.

## Fase 4 - Link publico

Implementar o fluxo publico de agendamento.

Funcoes:

- pagina publica por slug;
- escolha de servico;
- cadastro simples de cliente;
- busca por telefone;
- calculo de horarios disponiveis;
- criacao do agendamento;
- tela de confirmacao.

Essa e a fase mais importante para o diferencial do produto.

## Fase 5 - Financeiro

Implementar fluxo de caixa.

Funcoes:

- entrada automatica quando atendimento for concluido;
- entrada manual;
- saida manual;
- filtros por periodo;
- grafico mensal;
- total de entradas;
- total de saidas;
- lucro estimado.

## Fase 6 - CRM e frequencia

Implementar recursos que ajudam o profissional a vender mais para clientes antigos.

Funcoes:

- historico do cliente;
- frequencia media de atendimento;
- clientes inativos;
- clientes recorrentes;
- clientes novos;
- ranking por faturamento;
- clientes para chamar hoje.

## Fase 7 - Automacoes futuras

Depois do app funcionando, implementar automacoes.

Possiveis automacoes:

- lembrete automatico via WhatsApp;
- confirmacao automatica;
- mensagem para cliente sumido;
- mensagem de aniversario;
- follow-up pos-atendimento;
- alerta para o profissional;
- lista de espera para horarios cancelados.

# 7. Stack tecnica recomendada

Como a Lexion ja trabalha com Vercel, Supabase e n8n, a stack recomendada e:

- Frontend: Next.js;
- UI: Tailwind CSS + shadcn/ui;
- Agenda visual: FullCalendar ou React Big Calendar;
- Banco de dados: Supabase/PostgreSQL;
- Autenticacao: Supabase Auth;
- Backend/API: Next.js API Routes ou Server Actions;
- Hospedagem: Vercel;
- Automacoes: n8n;
- WhatsApp: Evolution API ou WhatsApp Cloud API;
- Graficos: Recharts;
- Exportacao: CSV, XLSX e PDF.

Essa stack permite desenvolver rapido, hospedar com facilidade e manter o codigo editavel no VS Code.

# 8. Modelo inicial de banco de dados

## users

Usuarios internos do sistema.

Campos:

- id;
- name;
- email;
- role;
- created_at.

Roles sugeridas:

- admin;
- owner;
- professional;
- assistant.

## businesses

Cada barbearia, salao ou profissional.

Campos:

- id;
- name;
- slug;
- phone;
- instagram;
- address;
- created_at.

## professionals

Profissionais que atendem.

Campos:

- id;
- business_id;
- name;
- phone;
- active.

## clients

Clientes finais.

Campos:

- id;
- business_id;
- full_name;
- phone;
- instagram;
- birth_date;
- notes;
- created_at.

## services

Servicos oferecidos.

Campos:

- id;
- business_id;
- name;
- price;
- duration_minutes;
- active.

## appointments

Agendamentos.

Campos:

- id;
- business_id;
- professional_id;
- client_id;
- service_id;
- start_at;
- end_at;
- status;
- payment_status;
- notes;
- created_at.

Status sugeridos:

- scheduled;
- confirmed;
- done;
- cancelled;
- no_show.

Payment status sugeridos:

- pending;
- paid;
- free.

## availability_rules

Regras fixas de disponibilidade.

Campos:

- id;
- professional_id;
- weekday;
- start_time;
- end_time;
- active.

## blocked_times

Bloqueios manuais.

Campos:

- id;
- professional_id;
- start_at;
- end_at;
- reason.

## leads

Cards do kanban.

Campos:

- id;
- business_id;
- name;
- phone;
- source;
- stage;
- notes;
- created_at.

Sources sugeridas:

- whatsapp;
- instagram;
- manual;
- website;
- referral.

Stages sugeridas:

- new;
- talking;
- link_sent;
- scheduled;
- lost;
- follow_up.

## cash_flow

Lancamentos financeiros.

Campos:

- id;
- business_id;
- appointment_id;
- type;
- category;
- amount;
- payment_method;
- date;
- description;
- created_at.

Tipos:

- income;
- expense.

Payment methods:

- cash;
- pix;
- credit_card;
- debit_card;
- other.

# 9. Regras criticas do sistema

## 9.1 Nao permitir conflito de horario

Antes de criar um agendamento, o sistema deve verificar:

1. profissional;
2. servico escolhido;
3. duracao do servico;
4. horario inicial;
5. horario final;
6. agendamentos existentes;
7. bloqueios manuais;
8. disponibilidade do dia;
9. intervalo entre atendimentos.

Se houver qualquer conflito, o horario nao deve aparecer para o cliente.

## 9.2 Considerar a duracao do servico

Exemplo:

- 10:00 esta livre;
- 10:40 tem outro atendimento;
- o cliente escolheu coloracao de 3 horas.

Nesse caso, 10:00 nao pode aparecer como horario disponivel, mesmo que o inicio esteja livre.

## 9.3 Evitar acesso indevido por telefone

Para marcar horario, nome e telefone sao suficientes.

Para cancelar, reagendar ou acessar historico, o ideal e validar com codigo via WhatsApp ou SMS.

## 9.4 Separar dados por negocio

Como o sistema pode virar SaaS, cada negocio deve enxergar apenas os proprios dados.

Isso deve ser garantido por:

- business_id em quase todas as tabelas;
- regras de Row Level Security no Supabase;
- validacoes no backend;
- testes de permissao.

## 9.5 LGPD

Como o sistema coleta nome e telefone, ele trata dados pessoais. O app deve ter:

- politica de privacidade;
- informacao clara sobre uso dos dados;
- consentimento no cadastro;
- possibilidade de correcao ou exclusao de dados;
- cuidado com acesso indevido aos dados.

Referencia: Lei Geral de Protecao de Dados Pessoais - https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm

# 10. Recursos que podem diferenciar o produto

## 10.1 Clientes para chamar hoje

Criar uma tela especifica com clientes que provavelmente precisam retornar.

Exemplo:

- Joao - ultimo corte ha 34 dias - frequencia media 21 dias;
- Pedro - ultimo corte ha 45 dias - frequencia media 30 dias;
- Lucas - ultimo corte ha 28 dias - frequencia media 20 dias.

A tela pode ter um botao:

> Enviar mensagem no WhatsApp

## 10.2 Lista de espera

Quando a agenda estiver cheia, o cliente pode entrar em lista de espera. Se alguem cancelar, o sistema avisa o profissional ou o cliente.

## 10.3 Links rastreaveis

Criar links com origem:

```text
/agendar/barbearia-do-joao?origem=instagram
/agendar/barbearia-do-joao?origem=whatsapp
/agendar/barbearia-do-joao?origem=trafego-pago
```

Assim o painel mostra de onde vieram os agendamentos.

## 10.4 Confirmacao automatica

Exemplo de mensagem futura:

> Ola, Joao. Seu horario com Carlos esta confirmado para amanha as 15:00. Responda 1 para confirmar ou 2 para cancelar.

## 10.5 Politica anti-furo

Configuracoes futuras:

- cancelamento minimo com 4 horas de antecedencia;
- bloquear cliente apos 2 faltas;
- exigir sinal em servicos caros;
- lista de clientes com maior indice de falta.

## 10.6 Pos-atendimento

Depois do atendimento, o sistema pode permitir:

- marcar como concluido;
- registrar pagamento;
- adicionar observacao;
- programar lembrete de retorno;
- enviar pedido de avaliacao.

# 11. Ordem recomendada de desenvolvimento

A ordem mais segura e:

1. Definir nome e proposta do produto.
2. Criar prototipo visual.
3. Criar banco de dados.
4. Implementar login e multiempresa.
5. Implementar servicos.
6. Implementar disponibilidade.
7. Implementar agenda interna.
8. Implementar link publico.
9. Implementar calculo de horarios disponiveis.
10. Implementar clientes.
11. Implementar financeiro basico.
12. Implementar kanban.
13. Implementar frequencia de clientes.
14. Testar com 1 profissional real.
15. Ajustar experiencia.
16. Preparar primeira versao vendavel.

# 12. Perguntas para decidir antes de codar

Quando voltar com as respostas, estas perguntas ajudam a fechar o escopo:

1. O app sera para cabeleireiro individual, barbearia pequena ou salao com varios profissionais?
2. Cada profissional tera sua propria agenda ou todos usarao uma agenda compartilhada?
3. O cliente escolhe o profissional ou escolhe apenas o servico?
4. O profissional precisa aprovar o agendamento ou o agendamento entra automaticamente?
5. Vai ter servicos com preco fixo ou preco variavel?
6. O cliente podera cancelar ou reagendar sozinho?
7. Vai ter lembrete por WhatsApp ja no MVP ou so depois?
8. O financeiro precisa controlar apenas entradas e saidas ou tambem lucro por profissional?
9. O sistema sera vendido como mensalidade SaaS?
10. A Lexion vai oferecer configuracao personalizada para cada cliente?

# 13. Recomendacao final

A versao inicial deve focar em uma dor clara:

> O profissional envia um link, o cliente agenda sozinho, o sistema organiza a agenda, salva o cliente, acompanha o financeiro e mostra quem precisa voltar.

Esse escopo ja e forte o suficiente para testar com clientes reais.

Nao recomendo comecar com um sistema grande demais. Primeiro, valide o fluxo principal. Depois acrescente automacoes, estoque, comissoes, pagamentos e recursos avancados.
