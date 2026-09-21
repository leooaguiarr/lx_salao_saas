> **LEGADO — leia com filtro.** Este é o diário do sistema de origem, feito
> sob medida para a Alabama Barbearia (julho a setembro de 2026), antes de
> virar o SaaS. Copiado de `lx_salao_alabama/AGENT_HANDOFF.md` em 21/09/2026.
>
> **Continua valendo:** as regras de negócio (caixa, comissão, datas,
> frequência, encaixe, estoque, fila), o porquê de cada decisão e as
> armadilhas de SQL/PostgREST.
>
> **Não vale mais:** tudo sobre Vercel, domínio `alabamabarbearia.com.br`,
> projeto Supabase `ekyonsvyeydfjxdytiyu`, `servidor-local.js`, a pasta
> `testes/` (não veio para o SaaS) e os caminhos `docs/NN_*.sql` (hoje em
> `docs/legacy_sql/`, substituídos por `supabase/migrations/`).
>
> Em caso de conflito, os arquivos `01` a `05` desta pasta prevalecem.

---

# Agent Handoff & Project Context

## 🚦 REGRA DE TRABALHO (a partir de 06/08/2026) — leia antes de tudo

> **O sistema está EM PRODUÇÃO, com a barbearia trabalhando nele todos os dias.**
> A partir de agora, **nada vai para o ar sem ter rodado localmente antes.**

Até 06/08/2026 o fluxo era: alterar → commit → push → conferir em produção. Isso funcionou
enquanto o cliente ainda não dependia do sistema. **Não funciona mais**: um erro no meio do
expediente derruba a agenda do dia, o caixa e o link que os clientes usam para agendar.

**O fluxo passa a ser:**

1. Alterar o código.
2. **Subir o servidor local e testar na mão**, no navegador, na tela do celular.
3. Rodar as suítes de `testes/` que tocam a área alterada.
4. **Mostrar ao Leonardo e esperar o aval.**
5. Só então commit, push e conferência em produção.

**Na raiz do projeto** (não dentro de `public/`):

```bash
node servidor-local.js```

Ele imprime os endereços ao subir:

```text
  Sistema .............. http://localhost:8099
  Link de agendamento .. http://localhost:8099/agendamento

  No celular (mesma rede Wi-Fi):
  Sistema .............. http://192.168.x.x:8099
```

- **Não precisa instalar nada** — usa só o que vem no Node.
- **Abre no celular** pela mesma rede Wi-Fi. O sistema é usado no celular;
  testar só no computador esconde justamente os problemas que mais aparecem.
- **Sem cache**: alteração no CSS aparece ao recarregar, sem `Ctrl+F5`.
- Se a porta estiver ocupada: `node servidor-local.js 8100`.

> Antes era um comando de uma linha colado no terminal. **Não use mais** — ele
> quebra ao ser colado no PowerShell, por causa das aspas aninhadas.
>
> ⚠️ **O banco é o MESMO em local e em produção.** Não existe Supabase de teste: `public/api.js`
> aponta para o projeto `ekyonsvyeydfjxdytiyu` nos dois casos. Ou seja, **testar localmente
> protege o código, não os dados** — um `DELETE` ou um agendamento de teste feito na máquina
> local entra na base real da barbearia. Para testar comportamento, prefira os scripts de
> `testes/`, que trabalham com dados falsos injetados na memória do navegador.

### Versão do sistema

O rodapé da tela de login mostra a versão (`v1.5.0`), discreta, ao lado do crédito da Lexion.
Ela existe para **saber o que está no ar** sem abrir o painel da Vercel — útil agora que o deploy
deixou de ser imediato. A constante fica em `public/app.js` (`VERSAO_DO_SISTEMA`).

**Subir a versão junto com o deploy de cada parte funcional**, não a cada commit:
`MAIOR.MENOR.CORRECAO` — funcionalidade nova sobe o `MENOR`, correção sobe o `CORRECAO`.

| Versão | O que entrou |
| --- | --- |
| `1.3.0` | Níveis de acesso do barbeiro e fila do cliente no link público |
| `1.4.0` | Encaixe ("Chegou agora") e controle de produtos/estoque |
| `1.5.0` | Guia rápido (o "?" no rodapé da barra lateral) |
| `1.6.0` | Evolução de Vendas: abas Vendas, Comissões, Crediário e Fidelidade |
| `1.6.1` | Exclusão real de transações no Supabase, fundo verde escuro profundo, remoção do amarelado e layout do telefone dos profissionais |
| `1.6.2` | Restrição de Financeiro para profissionais, liberação de todos os clientes para equipe (script 29) e exibição de 'Administrador' nas vendas |
| `1.6.3` | Seleção de profissional no "Chegou agora" com fallback inteligente e botão dourado harmonizado |

> ⚠️ **É fácil esquecer.** A versão saiu em `1.4.0` enquanto o guia rápido já estava
> pronto e no ar — quem olhasse o rodapé do login veria uma versão que não descrevia
> o que estava rodando. Ao terminar uma parte funcional, subir a constante **antes**
> do push, junto com o resto da entrega.

## 📌 Visão Geral do Projeto
Este projeto é uma instância independente do sistema de agendamento e dashboard dedicado ao cliente
(**Alabama Barbearia**). Foi gerado a partir de um template/mostruário.

- **Tecnologias:** HTML, CSS (Vanilla), JS (Vanilla), Node (Express), Supabase.
- **Objetivo:** Gestão de agendamentos, clientes, profissionais, comissões, comandas, estoque e
  fluxo de caixa da barbearia.

### Como os arquivos de `public/` se organizam

**Não há módulos nem build**: tudo compartilha o mesmo escopo global, e a **ordem das tags em
`index.html` importa**. O `app.js` continua sendo o núcleo grande — o que a Alabama evita é
reorganizar o que já existe, não ter mais de um arquivo.

| Arquivo | O que tem |
| --- | --- |
| `api.js` | Camada de dados: Supabase, RLS por salão, `loadAll`/`save`, RPCs públicos e de venda |
| `app.js` | O núcleo (~5.700 linhas): agenda, clientes, financeiro, caixa, PDFs, link público |
| `estoque.js` | Cadastro de produtos, movimentação, produto no atendimento e vitrine |
| `encaixe.js` | O "Chegou agora" |
| `ajuda.js` | O guia rápido (conteúdo em duas listas no topo do arquivo) |
| `vendas-base.js` | Aba Vendas: histórico, filtros, detalhe da venda |
| `venda-calculo.js` | A conta da venda: itens, desconto, acréscimo, rateio |
| `checkout.js` | O modal de venda — o maior dos sete |
| `comissoes.js` | Aba Comissões e a baixa em lote |
| `crediario.js` | Aba Crediário: parcelas, recebimento, cobrança por WhatsApp |
| `fidelidade.js` | Aba Fidelidade: clube, pontos, resgate |
| `recibo.js` | Recibo da venda em PDF e por WhatsApp |

Todos os que vêm depois de `api.js`/`app.js` são **carregados depois de `app.js`**: eles leem o
estado global e as funções de cálculo que ele define. Ao criar funcionalidade nova, **prefira um
arquivo novo** a inchar o `app.js` — o escopo é o mesmo, e o resultado fica legível.

> Entre os sete de venda a ordem **também** importa, e não é a mesma coisa: `venda-calculo`
> precisa das constantes de `vendas-base`, `checkout` precisa do cálculo, e `recibo` é chamado no
> fim do checkout. A ordem correta está no `index.html`; não reordene sem motivo.
>
> ⚠️ **Ao alterar qualquer arquivo de `public/`, suba o `?v=` em TODAS as tags de `<script>` e
> `<link>` do `index.html`.** Sem isso o navegador do cliente serve o arquivo velho e o trabalho
> "não aparece" — inclusive para você, conferindo em produção.

## 🏗️ Status Atual do Lançamento
- [x] Repositório clonado com sucesso a partir do projeto base.
- [x] Banco de dados configurado no Supabase para este cliente.
- [x] Chaves de API atualizadas (projeto `ekyonsvyeydfjxdytiyu`, verificado no ar em 01/08/2026).
- [x] Pasta local convertida em clone git de verdade, com push funcionando.
- [x] **Deploy feito e verificado**. Domínio próprio `alabamabarbearia.com.br` no ar (CI/CD ligado ao `main`).
- [x] Migração da logo do estabelecimento aplicada no Supabase (`docs/add_business_avatar.sql`).
- [x] Rótulos do link público corrigidos (não exibem mais domínio fixo da Lexion).
- [x] **Customização visual aplicada** (logo, nome, cores) — ver seção 🎨 abaixo.
- [x] Disponibilidade dos profissionais (folgas + horário de funcionamento por dia).
- [x] Níveis de acesso (dono/barbeiro) e fila do cliente no link público.
- [x] **Encaixe "Chegou agora"** e **controle de produtos e estoque** (v1.4.0).
- [x] **Guia rápido** com primeiros passos, dúvidas frequentes e contato do suporte (v1.5.0).
- [x] **Banco completo e conferido em 19/08/2026.** As três migrações que faltavam foram
      executadas (`add_niveis_de_acesso.sql`, `add_produtos_e_estoque.sql` e
      `add_movimentacao_estoque.sql`) e o `docs/diagnostico_banco.sql` devolveu **zero
      pendências**: nenhuma tabela, função ou coluna faltando, nenhuma assinatura duplicada, e
      `registrar_movimento_estoque` com os 12 parâmetros corretos.
- [x] **Fila e vitrine conferidas em produção** (19/08/2026): agendamento pelo link entra, a fila
      responde, e a vitrine aparece na fila e na tela de sucesso — **sem a quantidade**.
- [x] **Evolução de Vendas — Fase A-D aplicada no banco em 09/09/2026** (scripts `14_vendas_base.sql`
      a `22_fecha_anon_nas_internas_restantes.sql`, portados de `dashboard_salao` — ver
      `PORTABILIDADE_ALABAMA.md`). Núcleo de vendas (`sales`/`sale_items`/`sale_payments`),
      `finalizar_venda`, comissões (`sale_commissions`), limite de consultas públicas e fechamento
      de caixa **já estão no banco de produção**, conferidos com `docs/diagnostico_vendas.sql`
      (zero pendências nessa fase). **Ainda não tem tela** — é só banco, o front-end é a Fase 2,
      ainda não começada.
- [x] **Evolução de Vendas — FASE 1 (BANCO) COMPLETA em 10/09/2026.** Os scripts restantes (23 a
      28) foram aplicados: crediário (`receivables`/`receivable_installments`/`receivable_payments`
      + `gerar_crediario`/`receber_crediario`), a correção do `source` (24), o patch do crediário
      em `finalizar_venda`, fidelidade (25), mensagens editáveis (26), níveis de acesso (27) e
      acesso do profissional (28). Conferido item a item: **19 de 19 objetos `ok`** — as 9 tabelas,
      as 4 RPCs, as 4 colunas novas (`sales.sold_by`, `professionals.email`,
      `business_info."whatsappChargeMessage"`, `loyalty_programs.reward_message`) e os **dois
      patches** em `finalizar_venda` (o do 23 e o do 27).
      As duas travas que mais importam foram conferidas **na política, não na intenção**:
      `cash_registers` e `receivables` exigem as duas
      `user_id = salao_do_usuario() AND meu_papel() = 'owner'` — caixa e crediário continuam
      exclusivos do dono. E `salon_members` tem **zero** políticas de escrita: criar vínculo de
      login só pela Edge Function, com a chave de serviço.

- [x] **Evolução de Vendas — FASE 2 (FRONT-END) INTEGRADA em 10/09/2026, ainda SEM AVAL.** Pela
      **Rota A** do `PORTABILIDADE_ALABAMA.md`: os sete módulos JS (~2.960 linhas) e cinco CSS
      (~945) vieram prontos de `lexion_salao`, onde já haviam sido testados, em vez de reescritos.
      O encaixe exigiu pouco, e foi isso que decidiu a rota: as cinco funções globais que os
      módulos usam (`escapeHTML`, `formatCurrency`, `showToast`, `openModal`, `closeModal`) já
      existiam na Alabama com o mesmo nome. O que faltava era só a ligação com o banco novo —
      quatro métodos em `api.js` (`finalizarVenda`, `pagarComissoes`, `receberCrediario`,
      `resgatarFidelidade`), as 10 tabelas no `loadAll` e os campos correspondentes em `data`.
      Conferido que os nomes de coluna que os módulos leem batem com o SQL aplicado (os 12 de
      `sale_commissions` e os 8 de `loyalty_programs`).
      Três diferenças entre os projetos foram resolvidas na integração, e é bom saber quais:
      a Alabama chama de **`ehBarbeiro()`** o que o clone chamava de `ehAcessoRestrito()` (o módulo
      foi adaptado ao nome da casa, para não haver dois nomes para a mesma regra); o recibo usava
      `garantirPDF()`, que baixava a biblioteca sob demanda, e passou a usar o **`pdfDisponivel()`**
      da Alabama, que é como o resto do app já resolve isso; e os arquivos perderam o prefixo
      numérico (`22-vendas-base.js` → `vendas-base.js`), que não faria sentido num projeto sem os
      arquivos 01 a 21.
      **Falta o aval do Leonardo na tela** — a regra de trabalho do topo deste documento. Nada foi
      commitado nem publicado.

- [x] **Evolução de Vendas — Fase 2 testada na tela e corrigida em 10/09/2026.** O Leonardo testou
      ao vivo (servidor local, banco real) e oito problemas apareceram — todos da mesma família: a
      integração trouxe o JS pronto do clone, mas alguns pedaços de HTML e uma função ficaram para
      trás. Todos corrigidos, testados e **ainda não commitados** neste momento:
      1. **`renderCaixaOperacional()` não existia.** A aba Vendas já tentava chamá-la para manter o
         badge/saldo do caixa em dia, mas a função nunca foi definida — falhava em silêncio
         (`typeof ... === 'function'`). O painel ficava preso no HTML estático ("Fechado") até
         algum evento avulso disparar `renderFinance()` por acaso. Extraída de dentro de
         `renderFinance()` e agora roda nas duas telas.
      2. **Caixa do Dia / Confirmar Pagamentos duplicados** entre Financeiro e Vendas (sobra de
         antes da Fase C) — a cópia do Financeiro nunca era atualizada (mesmo id, `getElementById`
         pega só a primeira) e sempre mostrava zerado. Removida; Financeiro ficou só com leitura.
      3. **Código `cash` invisível no saldo da gaveta.** O checkout novo grava `paymentMethod:
         'cash'`; `resumoDaGaveta()` só reconhecia o código legado `dinheiro`. Dinheiro recebido
         pelo checkout não entrava na conta da gaveta. Unificado com `ehPagamentoEmDinheiro()`, e
         portado o painel de **pendências em dinheiro de dias anteriores** (`renderPendentesAntigos`),
         que também nunca tinha sido trazido.
      4. **Botão "Confirmar" de pagamento pendente** abria o modal antigo de agendamento no modo
         pagamento — mas esse modo perdeu a opção "Pago" quando o agendamento parou de cobrar
         direto (v1.6.0). Agora chama `abrirCheckoutDoAtendimento()`, que já existia pronta e nunca
         tinha sido ligada a nada.
      5. **Atendimento concluído antes do horário marcado** não entrava em "Confirmar Pagamentos":
         a checagem só olhava se o horário agendado já tinha passado, nunca o status. Agora
         `status === 'done'` conta sozinho — vale também para a trava do fechamento de caixa, que
         usa a mesma função.
      6. **Modal "Receber parcela" do Crediário** não existia no `index.html` — o JS (`crediario.js`)
         estava certo, mas `openModal('modal-receber-parcela')` não tinha o que abrir.
      7. **"Projeção Faturamento Hoje" foi para a aba errada.** Acabou dentro do painel "Caixa do
         Dia" em Vendas, ao lado de "Total vendido hoje" — dois números parecidos mas diferentes
         (projeção pela agenda x vendas reais) lado a lado, comparação que não deveria existir.
         Voltou para o Financeiro como painel **"Resumo do Dia"**, com um link "Abrir/fechar caixa
         em Vendas" — exatamente como o clone já fazia.
      8. **`aplicarTagsWhatsApp()` não sabia `{parcela}`, `{valor}`, `{vencimento}`, `{clube}`,
         `{beneficio}`, `{pontos}`, `{meta}`.** Isto já afetava o botão "Cobrar por WhatsApp" da
         aba Crediário **antes de qualquer mudança de hoje**: a mensagem saía com essas tags
         escritas cruas para o cliente. Trocada pela versão genérica (qualquer chave extra em
         `dados` vira tag automaticamente) — corrige a cobrança e destrava a prévia da nova sub-aba
         "Cobrança".
      Rodada a suíte inteira de `testes/` a cada correção — sem regressão.

- [x] **Configurações reorganizada em 10/09/2026, igual ao clone.** "Link de Agendamento" saiu do
      menu lateral (não é mais tela de operação) e virou sub-aba de Configurações — o mockup de
      celular que simulava o cliente foi removido (quem quer ver de verdade abre o link). A edição
      da mensagem de agendamento foi junto, pra dentro da própria sub-aba. Acrescentadas as
      sub-abas **Fidelidade** (config do clube: meta, pontos, benefício, aviso de WhatsApp) e
      **Cobrança** (mensagem da parcela em aberto) — o JS das duas (`renderConfigDaFidelidade`,
      `modeloDeCobranca`) já existia pronto desde a integração da Fase 2; só faltava o HTML, mesmo
      padrão dos itens 1, 3 e 6 da lista acima.

> **O que falta:** commitar e publicar tudo isto (nada foi enviado ao GitHub ainda); a **Edge
> Function `acesso-profissional`** (passo 6 do runbook, exige confirmação do Leonardo por ser
> publicação em produção); testar a visão do `staff` na tela real (só foi simulada por SQL até
> agora); a venda de produto no Financeiro e vincular o `professional_id` quando houver login de
> barbeiro.

## 🔑 Contas e Acessos (verificado em 01/08/2026)

- O repositório pertence a **`lexionconsultoria`**, que é uma **conta de usuário do GitHub, NÃO uma organização**.
  (Versões anteriores deste documento diziam "organização" — está incorreto e leva a instruções erradas.)
- Existem duas contas GitHub autenticadas nesta máquina via `gh`: `lexionconsultoria` (dona do repo, com
  `admin`/`push`) e `leooaguiarr` (que **nem enxerga** este repo — ele é privado e ela não é colaboradora).
- Antes de qualquer `git push` ou operação de deploy, confirmar a conta ativa com `gh auth status`.

### ⚠️ O que trava o push de verdade (verificado em 18/08/2026)

**A autoria do commit já está resolvida** e não precisa de nada: este repositório tem `user.name`/`user.email`
**locais** apontando para `Lexion Consultoria <278407426+lexionconsultoria@users.noreply.github.com>`, que
sobrepõem os globais. Todo commit feito aqui já sai com o autor certo.

O que falha é a **credencial**, que é coisa separada. O `credential.helper` é o `manager` (Git Credential
Manager, vindo do gitconfig do sistema) e ele serve o token de `leooaguiarr` para `github.com`. O resultado
não é um 403 — é:

```text
remote: Repository not found.
```

…que parece remoto quebrado ou URL errada, e já fez perder tempo procurando problema onde não tem.
**A URL do remoto está correta**, o repositório existe e `lexionconsultoria` tem `push: true`.

Para escrever, sobrepor o helper na própria chamada. **O primeiro `credential.helper` vazio é o que
importa** — ele zera a lista; sem isso o `manager` responde primeiro e o erro volta:

```bash
TOK=$(gh auth token --user lexionconsultoria) && export TOK
git -c credential.helper= \
    -c credential.helper='!f(){ echo username=lexionconsultoria; echo password=$TOK; };f' \
    push origin main
```

Alternativa mais invasiva: `gh auth switch --user lexionconsultoria` (muda estado global do `gh`,
lembrar de voltar).

## 🚀 Deploy (concluído em 01/08/2026)

- Projeto na Vercel: conta `lexionconsultoriatec-7027` (plano Hobby), nome do projeto **`alabamabarbearia`**.
- URL de produção: **<https://alabamabarbearia.com.br>** (ver seção do domínio abaixo).
  O `alabamabarbearia.vercel.app` continua existindo, mas só redireciona.
  CI/CD ativo: publica sozinho a cada push no `main`.
- **Application Preset = "Other"**, nunca "Node". A Vercel sugere Node por causa do `server.js` na raiz
  (que é só o servidor de desenvolvimento local). Deixar em Node arrisca o erro 500 descrito no `.vercelignore`.
- **O nome do projeto na Vercel precisa ser digitado à mão como `alabamabarbearia`.** O repositório se chama
  `alabama_barbearia` e o underscore vira hífen, o que geraria `alabama-barbearia.vercel.app` — URL errada.
- Verificado após o deploy: assets servidos de `public/`, rewrite de slug funcionando
  (`/qualquer-slug` devolve o `index.html`) e `server.js` não exposto nem executado.

### 🌐 Domínio próprio: `alabamabarbearia.com.br` (no ar em 05/08/2026)

**URL de produção definitiva: <https://alabamabarbearia.com.br>**

Estado verificado por requisição HTTP:

| Endereço | Resposta |
| --- | --- |
| `alabamabarbearia.com.br` | **200** — serve o app (Production) |
| `www.alabamabarbearia.com.br` | 308 → apex |
| `alabamabarbearia.vercel.app` | 308 → apex |

O `.vercel.app` **também redireciona**, então não serve mais como entrada alternativa. Se um dia
for preciso acessar sem passar pelo domínio próprio, é necessário remover esse redirecionamento
no painel da Vercel.

> A Vercel monta o par apex/www com o **apex redirecionando para o www** por padrão. Aqui é o
> contrário, e foi preciso inverter à mão. Ao inverter, tirar primeiro o redirecionamento do
> apex e só depois apontar o www — na ordem errada os dois apontam um para o outro e vira loop.

Registrado no **registro.br**. Decisões tomadas com o cliente:

- **Apex é o principal** (`alabamabarbearia.com.br`); `www` só redireciona. Motivo: o link de
  agendamento é enviado por WhatsApp e fica mais curto — `alabamabarbearia.com.br/<slug>`.
- **DNS delegado para a Vercel** (troca de servidores DNS no registro.br).

Estado do domínio antes da mudança, conferido por consulta DNS:

| Registro | Valor | Leitura |
| --- | --- | --- |
| NS | `a.auto.dns.br` / `b.auto.dns.br` | DNS grátis do registro.br |
| A | nenhum | não apontava para lugar nenhum |
| MX | `0 .` | *null MX* — e-mail desativado |
| TXT | `v=spf1 -all` | SPF bloqueando envio |

Ou seja, **não havia e-mail para quebrar** ao delegar. Se um dia o domínio tiver caixa postal,
os registros MX terão de ser criados **dentro do painel DNS da Vercel**, não no registro.br.

> ⚠️ **A ordem importa: adicionar na Vercel ANTES de trocar os servidores no registro.br.**
> O registro.br valida a zona antes de aceitar a troca. Se a Vercel ainda não estiver
> respondendo pelo domínio, a alteração é recusada.

**Nenhuma mudança de código é necessária ao trocar de domínio.** Não existe domínio fixo em
lugar nenhum: `getPublicBookingUrl()` usa `location.origin`, `updatePublicUrlLabels()` usa
`location.host` e o `redirectTo` da recuperação de senha usa `location.origin`. Tudo acompanha
sozinho. **Não introduzir domínio literal em nada disso.**

Depois que o domínio responder, atualizar no Supabase: **Authentication → URL Configuration**,
`Site URL` e `Redirect URLs` com o domínio novo — senão o link de recuperação de senha continua
levando para o `.vercel.app`.

### ⚠️ Plano Hobby x uso comercial (verificado em 04/08/2026)

A conta está no **plano Hobby**, e a política da Vercel diz, literalmente:

> Hobby teams are restricted to non-commercial personal use only. All commercial usage of the
> platform requires either a Pro or Enterprise plan.

A definição de uso comercial inclui *"financial gain of anyone involved in any part of the
production of the project, including a paid employee or consultant writing the code"*, e cita
como exemplos "advertising the sale of a product or service" e "receiving payment to create,
update, or host the site".

O modelo da Lexion se enquadra duas vezes: cobra para criar/hospedar, e o site anuncia serviços
da barbearia. O domínio próprio torna a operação comercial evidente. **Risco concreto:**
suspensão do projeto derruba o link de agendamento do cliente sem aviso — e vale para todas as
instâncias clonadas na mesma conta. Decisão comercial do dono da Lexion, registrada aqui para
não se perder.

## 🎨 Identidade Visual (aplicada em 01/08/2026)

Paleta derivada das referências reais do cliente (fachada, interior do salão e Instagram
`@barbeariaalabamaoficial`), e não de escolha arbitrária:

| Token | Valor | Origem |
| --- | --- | --- |
| `--bg-primary` | `#0C110F` | Preto esverdeado das paredes e do piso |
| `--bg-secondary` | `#141B18` | — |
| `--bg-tertiary` | `#1D2620` | — |
| `--primary` | `#C9A24B` | Dourado das luminárias de latão e dos destaques do Instagram |
| `--primary-hover` | `#DFBE72` | — |
| `--primary-dark` | `#8F6F2E` | — |
| `--warning` | `#E67E22` | Deslocado do âmbar para laranja: o âmbar antigo era quase idêntico ao dourado da marca |

Verde/vermelho/azul de status foram mantidos para não perder significado. As cores do mockup do
WhatsApp (`#00a884`, `#0b141a`…) e o rosa do Instagram (`#e1306c`) são propositais — imitam
interfaces reais e **não devem ser trocadas** pela paleta da marca.

### Arquivos de marca

- `public/assets/logo_alabama.png` — logo circular, traço branco, fundo transparente (UI escura).
  **Tela quadrada (512x512) com folga interna**, de propósito: a marca é exibida em container
  redondo, e um PNG não quadrado seria recortado nas laterais, achatando o círculo do desenho.
- `public/assets/favicon_alabama.png` — mesma arte em dourado. Branco sumiria em aba clara.
- `public/assets/login-bg-alabama.jpg` — capa do login no desktop: a logo aplicada em tecido.
- `public/assets/login-bg-alabama-wide.jpg` — mesma cena em formato largo, para a faixa do mobile.
  Gerada estendendo o tecido das bordas da foto original por espelhamento, sem tocar na marca.
- Os arquivos `logo_lexion.png` e `login-bg.png` continuam no repositório, mas já não são referenciados.

> A terceira imagem enviada pelo cliente (panda em render 3D com brilhos) **não serve** para conversão
> por luminância: os reflexos viram furos na transparência. Recortar o panda da logo circular também
> não funciona — o desenho se sobrepõe aos anéis do círculo. Por isso a marca é usada sempre inteira,
> que é como a própria barbearia faz no avatar do Instagram.

### Cuidados

- O `<img id="sidebar-logo-icon">` é preenchido por `updateUserProfileUI()` **trocando o `src`**.
  Não voltar a usar `innerHTML` ali: `<img>` é elemento vazio e a logomarca enviada pelo salão
  nas Configurações deixaria de aparecer.
- **A marca é sempre exibida redonda**, nunca quadrada: `.logo-mark` na sidebar e `.pub-logo` na
  página pública usam `border-radius: 50%` com `object-fit: cover`. Em quadrado a logo destoa do
  restante da interface, que é toda arredondada. O anel dourado de 1px sustenta a forma mesmo
  quando a imagem tem fundo transparente.
- Na capa do login **não** há logomarca sobreposta: a imagem de fundo já traz a marca.
- **A capa do login tem duas imagens, por proporção.** No desktop o painel é alto e usa a imagem
  quadrada. No mobile a faixa é baixa e larga: a quadrada não serve ali, porque `cover` recorta o
  miolo da logo e `contain` deixa faixas de cor lisa nas laterais. Por isso o `@media (max-width: 992px)`
  troca para `login-bg-alabama-wide.jpg`, que tem o tecido estendido e preenche a faixa inteira com a
  marca intacta no centro.
- **"Desenvolvido por Lexion Consultoria" no rodapé é o crédito da agência e deve permanecer.**
  Apenas a identidade do estabelecimento virou Alabama. O crédito aparece em **dois lugares**, com o
  link para `https://lexionconsultoria.com.br` logo abaixo:
  - **Tela de login** — `.auth-footer` em `public/index.html`, estilo em `public/auth.css`.
  - **Página pública de agendamento** — função `rodapeLexion()` em `public/app.js`, estilo `.pub-footer`
    em `public/index.css`. Ela é anexada com `insertAdjacentHTML('beforeend', …)` **no fim de**
    `renderPhoneScreen()`, e não dentro de cada passo: cada passo reescreve o `innerHTML` inteiro do
    container, então um rodapé escrito dentro de um `if` seria apagado no passo seguinte — e repetir o
    HTML nos cinco passos criaria cinco cópias para manter em sincronia.
  - O `.pub-footer` usa `margin-top: auto` para encostar na base quando o passo é curto (o
    `.phone-content` é flex em coluna). Não trocar por `position: fixed`: nos passos longos o rodapé
    passaria a cobrir os botões.
  - Como o rodapé sai de `renderPhoneScreen()`, ele aparece também no simulador de celular das
    Configurações. É intencional — o simulador é a prévia do que o cliente vê.
- **Nunca usar `height: 100vh` em elemento de altura cheia.** Em navegador mobile o `100vh` mede a
  janela SEM as barras do navegador, então tudo que fica na base sai da área visível. Foi o que
  deixou o botão Sair da sidebar inalcançável no celular. Usar `100dvh` (com `100vh` antes, como
  fallback). Vale para `.sidebar` e `.auth-overlay`, e para qualquer painel novo do mesmo tipo.

## 📝 Próximos Passos Imediatos (Para o próximo Agente)

1. **A Evolução de Vendas (Fase 2) já está construída, testada na tela e corrigida — falta só
   commitar.** Ao contrário do que uma versão anterior desta lista dizia: a decisão de arquitetura
   mudou de Rota B para **Rota A** (módulos prontos do clone `dashboard_salao`, não reescritos
   dentro do `app.js` — ver `PORTABILIDADE_ALABAMA.md`), e ela foi entregue em 10/09/2026. O
   Leonardo testou ao vivo no servidor local (banco real — não existe banco de teste aqui) e oito
   problemas de integração apareceram, todos já corrigidos — a lista completa está na entrada do
   dia 10/09/2026 em "Status Atual do Lançamento", logo acima.

   **Isto ainda não foi commitado nem enviado ao GitHub.** Antes de continuar para qualquer coisa
   nova, revisar o diff, commitar e dar `git push` — é o primeiro passo, não um item à parte.

   Depois disso, falta:
   - Testar a visão do `staff` (barbeiro) na tela de verdade — até agora só foi simulada por SQL
     em `docs/27_niveis_de_acesso_ENSAIO.sql`. Precisa de um login de barbeiro real (item 3 desta
     lista) e da Edge Function abaixo.
   - **A Edge Function `acesso-profissional`** (passo 6 do `docs/RUNBOOK_MIGRACAO_VENDAS.md`):
     `supabase functions deploy acesso-profissional --project-ref ekyonsvyeydfjxdytiyu`. É
     publicação em produção — **confirmar com o Leonardo antes**. Sem ela, o dono não consegue
     criar login para os barbeiros pela tela: `salon_members` não tem política de escrita nenhuma,
     de propósito — o vínculo continua manual por SQL (comentado no fim de
     `docs/add_niveis_de_acesso.sql`) até a Function estar no ar.

2. **Validar a venda de produto no Financeiro.** É o que falta do teste de uso. Vender um
   produto junto com o corte e conferir **dois lançamentos separados** (um `Serviço`, um
   `Produto`), com a comissão do profissional saindo **só** do serviço, e depois fechar o caixa
   do dia com os dois lançamentos dentro.

   > ✅ **Conferido no aparelho em 19/08/2026, em produção:** o agendamento pelo link público
   > entra, a **fila responde** ("Você é o próximo", com horário e profissional) e a **vitrine
   > aparece nos dois lugares** — na fila ("Enquanto espera") e na tela de sucesso ("A barbearia
   > também vende"). Nos dois, **sem a quantidade em estoque**, que é a regra que não pode
   > quebrar: a página é aberta a qualquer um. O cadastro de produto também grava na nuvem.
   >
   > Isso fecha a dúvida sobre a fila, que estava silenciosamente fora do ar desde `0f809b1`.

   > **Por que isso não é preciosismo.** A fila (`get_public_queue`) tinha o código em produção
   > desde o commit `0f809b1` e o SQL nunca havia rodado — ela simplesmente não respondia, e
   > ninguém percebeu, porque o app cai para o cache local sem reclamar. Objeto existir no banco
   > e funcionalidade funcionar são duas conferências diferentes.

3. **Se houver login de barbeiro, vincular o `professional_id`.** Depois do
   `add_niveis_de_acesso.sql` a coluna `role` passou a valer na RLS, e um login com
   `role = 'staff'` **sem** `professional_id` não enxerga nada — a agenda abre vazia.

   > ✅ **O login do dono está confirmado como `owner`** (19/08/2026): ele entrou normalmente e
   > **cadastrou um produto**, o que só passa pela política de `products` com
   > `meu_papel() = 'owner'`. Não é preciso conferir o `role` dele de novo — a gravação é a
   > prova. Falta só o caso dos barbeiros, que ainda não foram cadastrados.

   ```sql
   SELECT u.email, m.role, m.professional_id, p.name AS profissional,
          CASE WHEN m.role = 'staff' AND m.professional_id IS NULL
               THEN '⚠️ FALTA VINCULAR O PROFISSIONAL' ELSE 'ok' END AS situacao
   FROM public.salon_members m
   JOIN auth.users u ON u.id = m.user_id
   LEFT JOIN public.professionals p ON p.id = m.professional_id
   ORDER BY m.role, u.email;
   ```

   O dono precisa aparecer como `owner`. O passo a passo de vincular um barbeiro está comentado
   no fim do próprio `docs/add_niveis_de_acesso.sql`.

4. **Peso da página (opcional).** Continua valendo o apêndice do
   `IMPLEMENTAR_ENCAIXE_E_ESTOQUE.md`, ainda não executado — só vale a pena se houver reclamação
   de lentidão no celular:

   | Onde | Problema |
   | --- | --- |
   | `index.css` | **683 kB** de papel de parede do chat, vindo de `user-images.githubusercontent.com` — endereço de terceiro que pode sumir e quebrar a tela sozinho |
   | `index.html` | jsPDF (~106 kB) baixado em toda visita, para um botão que quase nunca é apertado |
   | `index.css` | `backdrop-filter` em painéis de fundo chapado: não desenha nada e cria camada por painel |
   | `assets/` | `login-bg.png` (834 kB), `carlos_barber.png` (818 kB) e `felipe_barber.png` (808 kB) **não são referenciados** por nada — 2,4 MB de peso morto |

> ✅ **Disponibilidade dos profissionais** (que era o passo 2 desta lista) **foi entregue.**
> Ver a seção "Disponibilidade: funcionamento + folgas" mais abaixo. O efeito colateral que
> estava anotado aqui — o link oferecendo horário no domingo — deixou de existir: o horário
> de funcionamento passou a ter dia fechado.

## 🧾 Extratos em PDF (Financeiro)

Dois geradores, ambos em `public/app.js`, seção 12:

- **`gerarExtratoDia(opcoes)`** — botão *Extrato do Dia*, no painel Caixa do Dia, e também emitido
  sozinho ao fechar o caixa. Cobre a janela **desde o último extrato emitido** (não o dia
  corrente): situação do caixa, comissões por profissional e as movimentações da janela.
  No fechamento (`{ caixa, automatico: true }`) a janela é a sessão inteira do caixa.
- **`gerarExtratoPeriodo()`** — botão *Gerar PDF*, junto dos filtros. Respeita o período e o
  profissional selecionados na tela. Em *Geral*, sai uma linha por profissional com comissão e
  líquido do salão; num profissional específico, sai atendimento a atendimento.

Dependências: `jsPDF` + `jspdf-autotable` via CDN, carregados com `defer`. Como podem não estar
prontos no primeiro clique, `pdfDisponivel()` checa antes e avisa por toast.

**Regra que não pode ser quebrada:** os números do PDF têm de bater com os da tela, ou o extrato
perde credibilidade diante do cliente. Dois pontos exigem atenção:

- O *Saldo em Gaveta* sai de **`resumoDaGaveta()`**, a mesma função usada pela tela e pelo
  fechamento. Não recalcular à mão em lugar nenhum: essa conta já esteve duplicada em quatro
  pontos e cada cópia era uma chance de divergir.
- Faturamento, gastos e lucro **excluem** os pendentes, como na tela.
- Comissão sai de `atendimentoRealizado()` / `comissaoDoAtendimento()`, também compartilhadas.

O nome do arquivo inclui período e profissional (`extrato-ultimos-30-dias-bruno-alabama-...`), para
que gerar um PDF por profissional não sobrescreva o anterior na pasta de downloads.

## 🐞 Bugs Conhecidos / Pontos de Atenção

- **A carga automática é LEVE de propósito (11/09/2026).** `DataService.loadAll(keys, opcoes)`
  aceita `{ escopo: 'ciclo' }`, e nesse modo **não** consulta `business_info`, `professionals`
  nem `products` — as três guardam foto em base64 e respondiam pela maior parte do tráfego de
  cada volta, num plano gratuito que dá 5 GB de saída por mês. Sem o segundo argumento a carga
  é completa, como sempre foi.
  - No ciclo, essas três chaves voltam como **`undefined`**, e é assim que tem que ser: é a
    ausência que faz `loadData` preservar o que já está na tela. Trocar por `[]` ou `{}` deixa
    a agenda sem barbeiro e o checkout sem produto — **sem erro no console**, porque
    `refreshCloudData` engole a exceção. Há teste travando isso (`testes/testa_ciclo_leve.js`).
  - O ciclo roda a cada 2 min (10 min fora do expediente) e vira completo de 20 em 20 minutos,
    ou assim que alguém abre Estoque/Configurações, ou ao voltar para a aba.
- **O endereço das abas é HASH (`#vendas`), nunca caminho.** O caminho já pertence ao link
  público, onde `/alabama` é o nome do salão (`getPublicSlugFromUrl` lê `location.pathname`).
  Uma aba em `/vendas` seria lida como um salão chamado "vendas".

- **Como testar mobile de verdade.** O `--window-size` do Chrome headless no Windows tem piso de
  ~504px: pedir `--window-size=390` entrega viewport de 504 e recorta a imagem em 390, o que
  *aparenta* conteúdo vazando para fora da tela e elementos descentralizados. Uma versão anterior
  deste documento chegou a registrar um "bug de estouro no login mobile" que **não existe** — era
  esse artefato. O caminho correto é impor o viewport pelo DevTools Protocol
  (`Emulation.setDeviceMetricsOverride` com `mobile: true`), que renderiza 320–430px de fato.
- **Não há estouro horizontal no mobile.** Medido em 02/08/2026 a 390px: `body`, `.app-container` e
  `.main-content` têm `scrollWidth` igual ao `clientWidth`, e forçar `scrollLeft` resulta em 0. O
  `html` reporta `scrollWidth` 9px maior, resquício da sidebar fechada em `left: -280px`, sem efeito
  prático. Não perseguir isso.
- **NÃO apagar o `vercel.json`.** Ele não contém nada da conta Vercel (o vínculo com a conta fica em `.vercel/`,
  que é gitignored). O que ele contém é essencial: `outputDirectory: "public"` e o rewrite `/(.*)` → `/index.html`.
  Sem esse rewrite, os **links públicos de agendamento quebram** — `public/app.js` (~linha 2601) lê
  `location.pathname` para descobrir o slug do salão, então URLs como `/alabama` dependem dele.
- **Domínio `.vercel.app` é global.** O projeto antigo (de outra conta Vercel) foi apagado e o nome
  `alabamabarbearia` foi reaproveitado com sucesso. Ao migrar qualquer cliente de conta, apagar o projeto
  na conta antiga ANTES de importar na nova, senão a Vercel acrescenta um sufixo aleatório à URL.
- **O rótulo do link público NÃO deve ter domínio fixo no HTML.** Antes exibia `lexion.com.br/agendar/`,
  que estava errado duas vezes: domínio de outro cliente e um trecho `/agendar/` que não existe na rota real
  (`getPublicBookingUrl` devolve apenas `origem + / + slug`). Hoje `updatePublicUrlLabels()` em `public/app.js`
  preenche os quatro pontos de exibição a partir de `location.host`. Se um domínio próprio for apontado para
  o site, os rótulos se atualizam sozinhos — não voltar a chumbar domínio nenhum ali.
- Se o repositório não aparecer no import da Vercel (erro 404), é permissão do Vercel App no GitHub.
  Como `lexionconsultoria` é conta de usuário, a instalação é pessoal — ajustar em
  `github.com/settings/installations`, e não em página de organização.
- A identidade de commit desta máquina é `Leonardo <leooaguiarr@gmail.com>` (config global). Os commits antigos
  do repo usam outro e-mail. Se quiser que os commits fiquem sob a identidade da Lexion, definir um override
  local com `git config user.email "..."` dentro da pasta do projeto.

## 🗄️ Estrutura do Banco de Dados (Supabase)

### ⚠️ Como o SQL Editor do Supabase executa um script (descoberto em 10/09/2026)

Três coisas que custaram várias tentativas na migração dos scripts 23-28, e que **não são defeito
dos scripts** — são o comportamento do editor:

1. **Ele analisa TODOS os comandos antes de executar o primeiro.** Uma tabela criada no próprio
   script é invisível para os comandos seguintes, e o erro é
   `42P01: relation "..." does not exist` **mesmo com o `CREATE TABLE` logo acima**. Foi o que
   derrubou o `_backup_funcoes` do script 27. A saída é criar a tabela numa **execução separada,
   antes** — os `CREATE TABLE IF NOT EXISTS` são idempotentes, então rodar antes não atrapalha.
2. **Ele mostra apenas o resultado do ÚLTIMO comando.** Num script com vários `SELECT` de
   conferência, os anteriores somem. Para diagnóstico (que é só leitura) dá para fatiar sem risco;
   para um ensaio em `BEGIN...ROLLBACK`, **não** — fatiar grava os dados de teste no banco real.
   Nesse caso, junte as conferências num `SELECT` único com `UNION ALL`.
3. **`RAISE NOTICE` não aparece.** Um passo que se comunica só por NOTICE é um passo mudo aqui.

E uma armadilha de SQL que apareceu três vezes nas conferências herdadas do clone: ao juntar
`pg_proc` com `pg_namespace`, **prefixe tudo com `p.`** (`p.oid`, `p.proname`). Sem isso o `oid` é
ambíguo — existe nas duas tabelas — e a consulta morre com
`42702: column reference "oid" is ambiguous` antes de conferir coisa alguma.

> **Pendência aberta:** o `docs/27_niveis_de_acesso.sql` cria `public._backup_funcoes` **sem
> habilitar RLS**. O aviso do próprio Supabase pegou isso, e a tabela foi criada com RLS ligada e
> sem política (nega tudo pela API; o dono da tabela é isento, então os `INSERT` do script
> continuam funcionando). O script no repositório ainda não reflete isso — corrigir quando alguém
> mexer nele, e lembrar que ela guarda o código-fonte das RPCs, que não deve ficar legível pela
> chave anon do link público.

Os scripts SQL ficam em `docs/`. **A ordem importa** — rodar no SQL Editor do Supabase nesta sequência:

1. `supabase_setup.sql` — tabelas base e RLS (isolamento por `user_id`).
2. `public_booking_setup.sql` — os **4 RPCs** do link público: `get_public_salon`,
   `check_client_exists`, `create_public_booking` e `check_week_appointments`.
3. `supabase_cash_registers.sql` — tabela `cash_registers` e coluna `status` em `transactions`.
4. `supabase_fix_columns.sql` — `commission` em `professionals`, `user_id` em `cash_registers`
   (depende do passo 3: altera a tabela criada lá e substitui a política permissiva por uma por usuário).
5. `update_professionals_photo.sql` — `"photoUrl"` em `professionals`.
6. `add_business_avatar.sql` — `"avatarUrl"` em `business_info`.

### ⚠️ Falha conhecida do script base (descoberta em 01/08/2026)

O `supabase_setup.sql` cria `business_info` **sem a coluna `"avatarUrl"`**, mas duas partes do sistema
dependem dela. O sintoma inicial é o erro ao salvar os dados do estabelecimento com foto:
`Could not find the 'avatarUrl' column of 'business_info' in the schema cache` (`public/api.js` envia
`avatarUrl` no upsert). O sintoma grave é silencioso: `get_public_salon` lê `v_biz."avatarUrl"`, e como
plpgsql só resolve a coluna em tempo de execução, a função é criada sem erro mas **quebra na primeira
chamada real** — ou seja, o link público do cliente nunca funciona.

Por isso o passo 6 (`add_business_avatar.sql`) é obrigatório para todo cliente novo. As aspas em
`"avatarUrl"` são essenciais: sem elas o Postgres cria a coluna em minúsculas e o PostgREST não a encontra.

**Ideal:** incorporar essa coluna direto no `supabase_setup.sql` do projeto base, para que novos clientes
não repitam o problema.

### ⚠️ GRANT com assinatura errada derrubava o link público (descoberta em 03/08/2026)

**Sintoma:** o cliente percorria os 4 passos do link público normalmente, clicava em
*Confirmar Agendamento* e não acontecia nada — nenhuma tela de sucesso, nenhum agendamento
na agenda.

**Causa:** `create_public_booking` tem 8 parâmetros (o 8º é `p_birth text DEFAULT NULL`),
mas o `REVOKE`/`GRANT` no fim do `public_booking_setup.sql` listava só 7 `text`. O Postgres
resolve a assinatura pela lista **completa** de tipos — argumentos com `DEFAULT` contam —
então essas duas linhas falhavam com `42883 function ... does not exist`.

**Por que passou despercebido:** o SQL Editor do Supabase roda o script inteiro numa
transação. A falha na linha 292 desfazia tudo, inclusive as 4 funções. Mas o passo 5
(`update_professionals_photo.sql`) recria `get_public_salon` sozinho, com o `GRANT` correto —
então a página pública abria, carregava logo, serviços, profissionais e horários livres, e
só quebrava no último clique. Diagnóstico feito chamando os RPCs direto na API REST com a
anon key e um slug inexistente (não grava nada):

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/create_public_booking" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"p_slug":"__nao_existe__", ...}'
```

`get_public_salon` respondia `null` (existe, slug não encontrado); os outros três
respondiam `PGRST202 ... not found in the schema cache` (não existem).

**Correção:** assinaturas com 8 `text` no `REVOKE`/`GRANT` e `NOTIFY pgrst, 'reload schema'`
no fim do script. Junto disso, `showPublicBookingError()` em `public/app.js` passa a exibir a
falha **dentro da página pública**, acima do botão — antes só havia um toast no canto
inferior direito, que no celular passa despercebido e fazia a falha parecer "nada acontece".

### ⚠️ Modais cortados no mobile (corrigido em 04/08/2026)

**Sintoma:** ao abrir "Abrir Caixa do Dia" no celular, o modal aparecia pela metade e os
botões *Cancelar* / *Confirmar Abertura* ficavam atrás da barra do navegador.

Duas causas somadas em `public/index.css`:

1. `.modal-backdrop` usava só `height: 100vh` — o mesmo problema do botão Sair da sidebar.
   No mobile `100vh` mede a janela **sem** as barras do navegador, e como o modal é ancorado
   embaixo (`align-items: flex-end`), o rodapé caía atrás da barra. Resolvido com `100dvh`.
2. Vários modais envolvem `.modal-body` + `.modal-footer` num `<form>`, que é filho direto
   do `.modal-dialog`. O `.modal-dialog` é `flex-direction: column`, mas o `<form>` no meio
   era um bloco comum, então a coluna flex "quebrava" ali: o corpo não sabia qual altura
   podia ocupar e empurrava o rodapé para fora do diálogo. O CSS compensava com
   `max-height: calc(92vh - 132px)` no corpo — um chute da altura de cabeçalho + rodapé que
   errava sempre que o conteúdo fugia do previsto.

Agora `.modal-dialog > form` também é uma coluna flex, `.modal-body` é `flex: 1 1 auto` com
`min-height: 0` (obrigatório: sem ele um item flex se recusa a encolher abaixo do próprio
conteúdo), e cabeçalho/rodapé são `flex: 0 0 auto`. Não há mais número mágico.

**Como testar:** `testes/testa_modal.js` abre cada modal em viewport de celular e mede se
o rodapé está dentro da tela e se `elementFromPoint` entrega o clique ao botão. Duas
armadilhas do headless que já custaram diagnóstico errado: **medir antes da animação
terminar** (o diálogo nasce em `scale(0.9)` e dá folga falsa — o teste desliga as transições)
e **`window.innerHeight` mentir na emulação** (usar o retângulo do backdrop como referência).
Validado em 390×844, 390×740, 390×600 e 390×480.

### Fechamento de caixa travado por pagamento pendente (04/08/2026)

Antes o modal de fechamento apenas *avisava* que havia agendamentos sem pagamento e deixava
fechar assim mesmo. Agora **bloqueia**: o botão *Confirmar Fechamento* fica desabilitado
enquanto houver atendimento que já aconteceu e continua sem pagamento confirmado.

A regra vive numa função só, `pagamentosPendentesAte(momento)` em `public/app.js`, usada
tanto pelo painel *Confirmar Pagamentos* quanto pelo bloqueio. **Não duplicar essa regra:**
se as duas telas divergirem, o painel mostra um número e o caixa trava por outro, e o
usuário não tem como saber o que falta.

O que conta como pendente: atendimento cujo horário já passou, com `paymentStatus` diferente
de `paid`/`free` e `status` diferente de `cancelled`/`no_show`. Atendimentos ainda por vir
hoje **não** travam — aparecem como nota informativa. As saídas para destravar um atendimento
que nunca vai ser pago são marcá-lo como Cortesia, Faltou ou Cancelado, e o próprio aviso
diz isso.

A verificação é refeita no clique, não só na abertura do modal: entre abrir e clicar, um
atendimento pode passar da hora e virar pendente.

**Como testar:** `testes/testa_fechamento.js` cobre 5 cenários (passado pendente, futuro
pendente, tudo pago, pendência de ontem, cortesia) e confirma que o clique no botão travado
realmente não fecha o caixa — não basta checar `disabled`.

### "JWT issued at future" e a queda para lista vazia (04/08/2026)

**Sintoma:** ao abrir o sistema, toast vermelho
`Erro ao carregar dados da nuvem: JWT issued at future`.

O PostgREST recusou o token da sessão porque o `iat` dele estava à frente do relógio do
servidor da API. Verificado na época: a anon key é válida (`iat` de 30/07/2026, chamada
anônima devolve HTTP 200) e o relógio do Supabase batia com o real — ou seja, **não era a
chave da aplicação**, era o token daquela sessão de login. Causa mais provável: correção de
relógio no lado do Supabase depois que o token foi emitido, ou relógio do aparelho adiantado.
Login novo resolve.

**O problema maior que isso escondia:** o `loadAll` fazia `services || []` para cada tabela.
Quando uma consulta falhava, `r.data` vinha `null` e o app passava a rodar com **listas
vazias** — agenda zerada, nenhum cliente, nenhum serviço — avisando só por um toast que some
em segundos. Dá a impressão de que os dados sumiram da nuvem.

Agora, em `public/api.js`:

- `ehErroDeSessao(erro)` separa erro de token (vale renovar e tentar de novo) de erro comum
  (insistir não adianta).
- Ao detectar erro de sessão, o `loadAll` chama `refreshSession()` e **refaz a busca uma vez**.
- Se ainda falhar, cada tabela cai no **cache do localStorage**, não em `[]`. Melhor mostrar
  dado de ontem do que uma agenda vazia.
- A mensagem virou instrução: sair e entrar de novo, conferir data/hora automáticas do
  aparelho, e o aviso explícito de que o que está na tela é o último dado salvo localmente.

**Como testar:** `testes/testa_sessao.js` troca o cliente Supabase por um dublê que
devolve `PGRST301` e cobre os dois desfechos (renovação resolve / renovação falha), além da
classificação do erro.

### Data de competência x data de caixa (04/08/2026)

**Sintoma:** o dono confirmou pendências de pagamento do dia anterior, e elas não apareceram
no extrato do dia nem no saldo em gaveta.

**Causa:** `triggerFinancialLogging` gravava o lançamento com `date = data do atendimento`.
Confirmar hoje o pagamento de ontem criava uma transação datada de ontem — mas o dinheiro
entrou na gaveta hoje. Todos os filtros de caixa usavam `t.date`, então o valor sumia.

Agora a transação tem **duas datas, de propósito**:

| campo | significado | quem usa |
| --- | --- | --- |
| `date` | dia do atendimento (competência) | extrato do período, faturamento |
| `registradoEm` | instante em que o dinheiro mexeu | extrato do dia, saldo em gaveta, fechamento |

> ⚠️ `"registradoEm"` precisa existir na tabela `transactions` do Supabase, **com aspas**.
> Rodar `docs/add_transaction_timestamp.sql`. Sem a coluna, o upsert de transações falha —
> mesma armadilha do `avatarUrl`. Já incluída no `supabase_setup.sql` para clientes novos.

Lançamentos antigos ficam sem `registradoEm`, e `pertenceAoCaixa()` cai na regra por data
nesses casos, para não mudar saldo de caixa que o dono já conferiu.

**Funções compartilhadas** (`public/app.js`, bloco "BASE DE CÁLCULO DO FINANCEIRO"):
`momentoDoLancamento`, `atendimentoRealizado`, `comissaoDoAtendimento`, `pertenceAoCaixa`,
`resumoDaGaveta`. O saldo em gaveta estava calculado em **quatro** lugares diferentes; agora
só em `resumoDaGaveta`.

### Comissão zerada nos PDFs (04/08/2026)

O filtro exigia `status === 'done' && paymentStatus === 'paid'`. Quem confirma o pagamento
pelo painel *Confirmar Pagamentos* não volta na agenda para marcar "Concluído", então o
atendimento ficava `scheduled` + `paid` e **a comissão nunca entrava** — nem na tela, nem nos
PDFs. `atendimentoRealizado()` agora exige só pagamento confirmado (e não cancelado/faltou).

O extrato do dia não tinha seção de comissão nenhuma; ganhou uma, calculada **em cima dos
lançamentos da janela**, não casando atendimento com transação — casar por profissional e
data erra quando o mesmo profissional atende o mesmo cliente duas vezes no dia. Quando dá
zero, o PDF distingue "nenhum atendimento pago" de "nenhum profissional tem percentual
cadastrado".

### Janela do extrato do dia e extrato automático (04/08/2026)

`gerarExtratoDia()` cobria só `t.date === hoje`. Agora cobre **do último extrato emitido até
agora** (`janelaDoExtratoDia`, marcador em `localStorage['lexion_ultimo_extrato_dia']`), o que
garante que nada escape entre um extrato e o seguinte. O marcador só avança **depois** de
emitir, para que uma falha não perca o período.

Fechar o caixa emite o extrato sozinho, e nesse caso a janela é a **sessão inteira**
(abertura → fechamento), não o recorte desde o último extrato: o saldo em gaveta se refere à
sessão, e um recorte parcial não fecharia com esse saldo.

O nome do arquivo passou a incluir a hora. Dois extratos no mesmo dia tinham nome idêntico e
o segundo sobrescrevia o primeiro na pasta de downloads.

**Como testar:** `testes/testa_extrato.js`. Uma armadilha do headless: o Chrome recusa o
**segundo** download automático de uma mesma aba sem gesto do usuário — não adianta contar
arquivos no disco para os dois extratos seguidos. A suíte principal usa espião em
`baixarPdf`; `testa_auto.js` faz o fechamento como primeiro download e prova o arquivo real.

### Data de hoje fixa no código (04/08/2026)

`getRecallClients()` e `renderClients()` traziam `const today = new Date(2026, 6, 8)` — resto do
mostruário. O sistema achava que hoje era 8 de julho, quase um mês atrás, e isso contaminava a
métrica *Clientes p/ Retorno* do Dashboard e a classificação Em Dia / Atrasado da lista.

Pior que o atraso: `daysBetween()` usa `Math.abs`, então mede **distância, não sentido**. Um
cliente que cortou o cabelo hoje aparecia com "27 dias sem vir" e podia ser marcado como sumido.

Agora existe **`diasDesdeAVisita(ultimaVisita)`**, que conta a partir de agora e devolve `0`
para data futura — cenário real, porque dá para marcar como concluído um horário de amanhã.
Não usar `daysBetween` para "há quantos dias veio": ele continua útil onde a distância absoluta
é o que importa (intervalos entre visitas em `calculateClientStats`).

Cuidado ao testar: `daysSinceLast` pode ser **0** legitimamente. `daysSinceLast ? ... : ...`
manda quem veio hoje para o ramo de "sem visita" — comparar com `null` explicitamente.

### Regra de frequência de retorno

Duas fontes, com prioridade, unificadas em **`frequenciaDoCliente(client)`**:

1. `calculateClientStats().averageFrequency` — média real dos intervalos entre visitas
   concluídas. Exige **2 ou mais** visitas; abaixo disso é `null`.
2. `client.frequency` — campo do cadastro, que o formulário já entrega preenchido com **30**.

Ou seja: enquanto o cliente não tiver histórico, "A cada 30 dias" é o padrão do formulário, não
uma medição. Numa barbearia recém-lançada a coluna inteira mostra 30, e isso é esperado.

Um cliente é "Atrasado" quando `diasDesdeAVisita > frequenciaDoCliente`.

**Como testar:** `testes/testa_frequencia.js` — datas relativas a hoje, então não apodrece.

### Mensagem de aniversário (05/08/2026)

Era **fixa no código**, dentro do painel de aniversariantes — as outras duas mensagens já eram
editáveis e essa não. Agora sai de `mensagemDeAniversario()` e tem campo próprio em
**Configurações → Estabelecimento**, guardada em `businessInfo.whatsappBirthdayMessage`.

> ⚠️ Depende de `docs/add_whatsapp_messages.sql`. Sem ele, `"whatsappBirthdayMessage"` e
> `"whatsappBookingMessage"` não existem na tabela e as duas mensagens ficam **só no
> localStorage**: o dono edita no celular dele e o login da Lexion continua vendo o texto antigo.
> A lista `allowedCols` em `public/api.js` é o filtro — coluna que não estiver lá não sobe.

`escapeHTML` **não** entra nessas mensagens: o texto vai para a URL do WhatsApp (`encodeURIComponent`),
não para o HTML. Escapar transformaria `&` em `&amp;` dentro da mensagem enviada ao cliente.

**Um lugar só para editar.** O `#booking-msg-draft` da aba *Link de Agendamento* é `readonly`: ele
só espelha o modelo salvo nas Configurações. Antes era editável, mas o ajuste feito ali se perdia
no próximo `populateBookingDraft()` — o campo é repovoado toda vez que a aba é aberta. É `readonly`,
e **não** `disabled`, para o texto continuar selecionável e copiável.

### Tags das mensagens de WhatsApp

Existem **duas** mensagens configuráveis, e cada uma resolvia as próprias tags: a de
agendamento trocava `{dia}` e `{link}`, a de retorno só `{nome}`. O cliente sumido recebia
`{link}` escrito literalmente, sem link nenhum.

Agora as duas passam por **`aplicarTagsWhatsApp(texto, { nome })`**, que resolve `{nome}`,
`{dia}` e `{link}` (case-insensitive). **Não resolver tag fora dessa função** — tag que
funciona numa mensagem e não na outra é surpresa que chega ao cliente final.

Dois cuidados embutidos:

- O link sai de `getPublicBookingUrl(slug)`, não do texto do elemento `#biz-link-url`. A versão
  antiga dependia da tela de Configurações já estar renderizada.
- Sem slug cadastrado, `{link}` vira string vazia em vez de `https://dominio/`, que não leva a
  lugar nenhum. Mandar sem link é melhor do que mandar link quebrado, e um toast avisa.

**Como testar:** `testes/testa_tags_whatsapp.js` intercepta `window.open` e confere o texto
que realmente chega na URL do `wa.me`, nas duas mensagens.

### Recuperação de senha ("Esqueceu a senha?")

A tela de login tem **três painéis** no mesmo container, alternados por
`mostrarPainelAuth('login' | 'recuperar' | 'novaSenha')`:

1. `#auth-panel-login` — entrar
2. `#auth-panel-recover` — pedir o link por e-mail (`resetPasswordForEmail`)
3. `#auth-panel-nova-senha` — definir a senha nova (`updateUser`)

**A pegadinha do fluxo:** quem chega pelo link do e-mail volta **já com sessão válida**. Sem
tratamento, o boot veria "usuário autenticado" e o mandaria direto para o dashboard, sem nunca
pedir a senha nova. Por isso `DataService.estaEmRecuperacaoDeSenha()` é checado **antes** da
condição de autenticado em `DOMContentLoaded`.

A detecção é dupla, de propósito: leitura síncrona de `type=recovery` em `location.hash` (o
supabase-js limpa o hash logo depois) **e** o evento `PASSWORD_RECOVERY` do
`onAuthStateChange`, para o caso de o processamento do hash terminar depois do boot.

Depois de salvar, o app faz `logout()` e volta ao login. Entrar com a senha nova confirma na
hora que ela funciona, e evita duplicar toda a sequência de pós-login.

Decisões de segurança:

- A mensagem após pedir o link é sempre "Se este e-mail estiver cadastrado…", **mesmo quando o
  envio falha**. Diferenciar permitiria descobrir quais e-mails têm conta no sistema.
- Erro ao salvar a senha vira "O link pode ter expirado — peça um novo". O detalhe técnico só
  no console.

> ⚠️ **Dois passos manuais no Supabase, por cliente:**
>
> 1. **Authentication → URL Configuration**: `Site URL` e `Redirect URLs` (com `/**` no fim)
>    apontando para o domínio de produção. Sem isso o link do e-mail leva ao site errado.
> 2. **SMTP próprio** — em `Authentication → Emails → SMTP`
>    (`/dashboard/project/<ref>/auth/smtp`). **Não é opcional.**

**Por que o SMTP não é opcional.** O serviço de e-mail embutido do Supabase, segundo a própria
documentação, *"send messages only to pre-authorized addresses"* — ou seja, **só entrega para
membros da equipe do projeto** — com limite de **2 mensagens por hora** e sem garantia de
entrega (*"best-effort only"*).

O dono da barbearia não é membro da equipe Supabase da Lexion. Sem SMTP próprio ele **nunca**
recebe o e-mail de recuperação. Não é limite de volume, é bloqueio por destinatário.

> 🪤 **A armadilha do teste:** quem testa costuma ser o dono do projeto Supabase, que É membro
> da equipe — para ele o e-mail chega, e parece que está tudo certo. O teste que vale é com o
> e-mail do cliente. Some-se a isso que a tela mostra sucesso mesmo quando o envio falha (por
> decisão de segurança, para não revelar quais e-mails têm conta), e o resultado é uma falha
> completamente silenciosa dos dois lados.

**Como testar:** `testes/testa_recuperacao.js` troca o cliente Supabase por um dublê e
cobre os dois painéis, senhas diferentes, senha curta, link expirado e o caminho feliz — sem
enviar e-mail de verdade.

### Vários logins para a mesma barbearia (05/08/2026)

**Sintoma:** o dono criou um segundo usuário no Authentication e o sistema abriu vazio, como se
fosse outra barbearia.

**Causa:** era o comportamento correto do modelo antigo. A política era
`auth.uid() = user_id` em 8 tabelas, ou seja, cada linha pertencia ao **login** que a criou.
Login novo = conjunto de dados novo.

**Modelo atual:** a coluna `user_id` passou a significar **o salão dono do registro**, não o
login. A tabela `salon_members` diz a que salão cada login pertence, e as políticas comparam com
`salao_do_usuario()`.

O id do salão é o `user_id` do **dono**. Escolha deliberada: **nenhuma linha existente precisou
ser alterada** — os dados que já estavam lá continuam válidos como estão.

Detalhes que não podem ser perdidos:

- `salao_do_usuario()` é **SECURITY DEFINER**. Sem isso a consulta a `salon_members` dispararia
  a política da própria `salon_members`, que chamaria a função de novo: recursão infinita e erro
  em toda consulta do sistema.
- A função tem `COALESCE(..., auth.uid())`: login sem vínculo vira dono do próprio salão. É o
  que permitiu rodar a migração sem derrubar ninguém antes de cadastrar os vínculos.
- `salon_members.user_id` é PRIMARY KEY: um login pertence a exatamente um salão. Cada barbearia
  tem instância própria, então não existe caso de atender dois salões no mesmo banco.
- Vínculo **não é editável pelo app**: só há política de `SELECT` da própria linha. Cadastrar e
  mover vínculo é pelo SQL Editor, para que ninguém se mova para outro salão pelo navegador.

**No app** (`public/api.js`): `getUserId()` continua sendo a identidade do login, mas quem vai
para a coluna `user_id` agora é **`getTenantId()`**. `carregarVinculoDoSalao()` roda no `init()`
e no `login()`, antes de qualquer leitura ou gravação. **Não voltar a usar `getUserId()` em
gravação** — é isso que criava a barbearia paralela.

> ⚠️ **Níveis de acesso ainda NÃO existem.** A coluna `role` (`owner` / `staff`) já está gravada
> e o app expõe `getPapelNoSalao()` e `ehLoginConvidado()`, mas **nada é restringido**: qualquer
> login vinculado enxerga tudo, inclusive o financeiro completo. Pedido do cliente para depois:
> profissional vê a própria agenda e a própria comissão, sem o financeiro do salão.

**Como testar:** `testes/testa_multilogin.js` cobre dono, funcionário, migração não rodada e
logout — verificando o que realmente vai na coluna `user_id` ao gravar, não só o valor retornado.

### Tela de sucesso do agendamento (05/08/2026)

O passo 5 de `renderPhoneScreen()` é o **fim do caminho do cliente** e por isso **não tem botão**.
O "Novo Agendamento" que existia ali foi removido a pedido do cliente: convidava a agendar de novo
por engano, e cada toque a mais vira um horário fantasma na agenda da barbearia. **Não recolocar.**
No simulador das Configurações o reinício continua pelo ícone de recarregar do topo do celular
(`#btn-reset-phone`), então nada se perdeu ali.

O texto abaixo do título é dirigido ao cliente final, não ao operador. A versão antiga
("foi reservado e inserido na agenda… não é necessária nenhuma outra ação") descrevia o que o
sistema fez; a atual diz só o que a pessoa precisa saber: que está reservado e que chegue um
pouco antes. **O cliente pediu explicitamente que fosse curto** — as frases "não precisa
confirmar nada" e o pedido de aviso por WhatsApp em caso de cancelamento foram escritas e
depois retiradas a pedido dele. Não reintroduzir sem falar com ele.

O primeiro nome é normalizado antes de aparecer (`MARIA DA SILVA` → `Maria`): o campo é livre e o
cliente costuma digitar tudo em maiúsculas. Sem nome preenchido a frase começa em "Seu horário",
sem vírgula solta.

> `.pub-success-screen` usa `flex: 1 0 auto`, e **não** `height: 100%`. Com o rodapé da Lexion
> abaixo, os 100% valiam a altura inteira do container e empurravam o rodapé para fora da tela.

### Disponibilidade: funcionamento + folgas (05/08/2026)

Antes, a grade do link público era **fixa no código: 9h às 19h, de 30 em 30 minutos, todos os
dias, inclusive domingo** — só descontava o que já estava agendado. E o campo "Horário Geral de
Funcionamento" das Configurações era **decorativo**: os `<input>` nem tinham `id`, nada era salvo
e nada era lido. O cliente conseguia agendar em dia fechado.

**Depende de `docs/add_disponibilidade.sql`.** Sem ele o app continua funcionando (a tabela
ausente cai em lista vazia, como `cash_registers`), mas nada é bloqueado.

Duas regras, ambas em `public/app.js`, no bloco *BASE DE CÁLCULO DA DISPONIBILIDADE*:

- **`funcionamentoDoDia(dateStr)`** — lê `businessInfo.hours`, um objeto indexado pelo `getDay()`
  (`'0'` = domingo … `'6'` = sábado), com `{ aberto, abre, fecha }`. Sem nada salvo devolve
  `FUNCIONAMENTO_PADRAO` (9h-19h aberto), preservando o comportamento de quem já usava.
- **`profissionalBloqueado(profId, data, iniMin, fimMin)`** — lê `data.professionalBlocks`.
  `startTime` nulo significa o dia inteiro.

> **A regra vale nos dois lados, com pesos diferentes.** No **link público** ela é dura: a grade
> esconde o horário *e* `create_public_booking` recusa no servidor. No **lançamento manual** ela
> apenas **avisa** e salva assim mesmo — encaixe fora do expediente é decisão da barbearia, que
> às vezes atende um cliente antigo depois de fechar. No link não há ninguém para autorizar.
>
> ⚠️ **A validação no servidor não é redundante.** A grade roda no navegador do cliente e o
> endpoint público é anônimo: sem o `IF` dentro de `create_public_booking`, o bloqueio seria
> apenas visual e uma requisição montada à mão passaria.

Detalhes que já custaram tempo:

- **`new Date('2026-08-09')` é lido como UTC** e, no fuso do Brasil, cai no dia anterior — o
  sábado vira sexta. Por isso `diaDaSemanaDaData()` monta a data pelos componentes separados.
- **O atendimento inteiro precisa caber antes de fechar**, não só começar antes: um combo de
  60min às 15:30 terminaria 16:30 com a barbearia fechada. Vale na grade e no servidor.
- **`lerHorarioFuncionamento()` devolve `null`** quando a grade não está montada, e o
  salvamento então preserva o que havia. Sobrescrever com `{}` fecharia a agenda inteira de
  quem salvou os dados sem abrir aquela aba.
- **O motivo do bloqueio não é exposto no RPC público.** Pode ser pessoal ("médico", "velório") e
  a página é aberta a qualquer um.
- **Excluir bloqueio usa `DataService.deleteItem`**, e não o `saveData` normal: a gravação é
  `upsert` do array inteiro, que não apaga linha removida.

**Como testar:** `testes/testa_disponibilidade.js` cobre grade padrão, horário por dia,
serviço que ultrapassa o fechamento, dia fechado, bloqueio por faixa, bloqueio de dia inteiro,
bloqueio de outro profissional, a tela de Configurações e o modal.

### Encaixe: o cliente que chega sem hora marcada (18/08/2026)

Botão **"Chegou agora"**, no cabeçalho e na Agenda. Pede serviço, nome e WhatsApp, e encaixa
no primeiro horário livre do dia **entre todos os profissionais ativos** — quem está no balcão
não decide nada com o cliente esperando em pé. Arquivo: `public/encaixe.js`.

> **A regra de "que horário está livre" é UMA SÓ.** Ela vivia dentro do link público, na closure
> `checkSlotsForDate`. Saiu para `gradeDoProfissional()` e `primeiroHorarioLivre()`, em escopo
> global no `public/app.js` (bloco *BASE DE CÁLCULO DA DISPONIBILIDADE*), e **o link público
> passou a chamar a função extraída**. Duas cópias da conta viram duas respostas no dia em que
> alguém corrigir só uma.

O que muda entre os dois usos é **um parâmetro**:

| Uso | `opcoes.antecedenciaMin` | Por quê |
| --- | --- | --- |
| Link público | `120` (padrão) | O cliente ainda precisa se deslocar |
| Encaixe | `0` | A pessoa já está no balcão |

Detalhes que importam:

- Entra como `status: 'confirmed'` e `paymentStatus: 'pending'` — o cliente está na sala, não há
  o que confirmar depois. Vira agendamento normal: ocupa o slot e some do link público.
- **Telefone é a chave de quem já existe.** Mesmo número reaproveita o cliente em vez de duplicar,
  o que quebraria histórico, frequência de retorno e a busca da fila.
- Depois de encaixar, o modal **vira um painel de "pronto"** com o horário e um botão de WhatsApp.
  Isso destrói o formulário: `restaurarFormularioDoEncaixe()` guarda corpo e rodapé e **registra
  os listeners de novo** ao reabrir. Sem isso a segunda abertura quebra no primeiro `getElementById`.

**Como testar:** `testes/testa_encaixe.js`.

> ⚠️ **As seções 5 a 8 desse teste congelam o relógio às 09:00.** Elas exercitam o modal e
> precisam que exista vaga *agora*; sem congelar, o teste passava de manhã e falhava à noite —
> às 23h nenhum serviço de 40min cabe antes do fechamento, o encaixe é **corretamente** recusado,
> e a suíte acusava o código por um acerto dele.

### Produtos e estoque (18/08/2026)

Aba própria no menu (`Estoque`), entre Clientes e Financeiro, com badge de itens no mínimo.
Arquivos: `public/estoque.js`, `public/estoque.css`. Banco: `docs/add_produtos_e_estoque.sql`
(tabela `products` + o RPC da vitrine) e `docs/add_movimentacao_estoque.sql` (tabela
`stock_movements`, o RPC de movimento e as colunas de vínculo em `transactions`).

> ## ⚠️ A REGRA DE OURO
>
> **`registrarMovimento()` é a ÚNICA função que altera `stock`.** Financeiro, pagamento do
> atendimento e a tela de Estoque passam todos por ela, e cada chamada deixa uma linha no
> extrato com o motivo. Escrever `prod.stock` à mão em qualquer outro lugar recria as duas
> verdades que o extrato existe para eliminar.

Por que o RPC, e não `products.update(...)`:

- O `UPDATE` do RPC é **relativo** (`stock = stock - qtd`). Duas pessoas vendendo ao mesmo tempo
  — o dono no balcão e o barbeiro no celular — **somam** em vez de uma apagar a outra.
- O barbeiro **não tem escrita** em `products` pela RLS, mas precisa poder vender.
- Sem a migração o RPC devolve `{ ok: false }` e a baixa acontece localmente, mesmo caminho do
  resto do app.

Outras decisões que já têm motivo:

- **Nunca deixa negativo.** Vender mais do que o sistema registra **zera**. Estoque atrás do real
  é erro de inventário; travar a venda por causa dele deixaria o cliente esperando no balcão.
- **Na edição do produto o campo de quantidade some.** Trocar o número ali mudaria o saldo sem
  rastro. Para mexer: Entrada ou Saída. No cadastro novo o campo fica, como saldo de abertura.
- **Motivos são lista fechada.** Texto livre viraria "ajuste", "ajuste2", "correção" e nada
  agruparia depois.
- **Serviço e produto são DOIS lançamentos** no Financeiro. Misturar num valor só estragaria o
  faturamento por serviço, a comissão e a leitura de quanto sai em produto.
- **A comissão sai só do serviço.** O lançamento do produto carrega o `profId` (para saber quem
  vende), o que o torna candidato fácil a vazar para a comissão numa mudança futura. Os cálculos
  filtram por `category === 'Serviço'` — **manter esse filtro**.
- **A vitrine do link público nunca expõe quantidade.** O RPC `get_public_products` devolve só
  nome, categoria, preço e foto, e produto esgotado nem aparece. Não mudar a função para
  devolver `stock`.

> 🚫 **O painel "Quem compra produto" foi removido em 18/08/2026, a pedido do cliente** — ocupava
> metade da tela para uma leitura que a barbearia não usa. Saiu junto o código que só ele usava.
> **Não reintroduzir sem pedido.** O campo *"Quem comprou"* ficou: é ele que põe o nome do
> cliente na linha do extrato.

**Como testar:** `testes/testa_produtos.js` e `testes/testa_estoque.js`.

### Duas armadilhas da tela de pagamento (corrigidas em 18/08/2026)

O formulário do agendamento esconde metade dos campos conforme o modo (pagamento, horário,
criação). A validação do navegador não sabe disso, e **um campo obrigatório escondido e vazio
matava o "Salvar Pagamento" em silêncio** — o botão simplesmente parava de responder, sem erro
visível e sem como o usuário descobrir o motivo.

- O `<form id="form-appointment">` agora é **`novalidate`**, com a validação no JS dizendo o que
  falta. Pelo mesmo motivo, o campo de quantidade de produto **não tem `min`**: o piso de 1 é
  aplicado no `change`, no JS.
- `garantirOpcaoDoRegistro()` injeta uma opção com o id original quando o cliente, o serviço ou o
  profissional foi **excluído** depois do agendamento (`"Cliente excluído"`). Antes o `select`
  ficava vazio, travava o pagamento e o atendimento perdia o vínculo ao ser salvo.
- De quebra: `openEditAppointment` escrevia `"Confirmar Pagamento"` no título e **sobrescrevia com
  `"Agendamento"` três linhas depois**.

### Guia rápido — o "?" do rodapé (18/08/2026)

O crédito *"Desenvolvido por Lexion Consultoria"*, no rodapé da barra lateral, **é o botão**:
ganha um `?` e abre o guia. Quem tem dúvida procura no rodapé quem fez o sistema — é onde a
pessoa já olha, e não mais um ícone competindo com o menu. Arquivos: `public/ajuda.js`,
`public/ajuda.css`.

> **O conteúdo é DADO, não marcação.** Está em duas listas no topo do `ajuda.js`
> (`PRIMEIROS_PASSOS` e `DUVIDAS_FREQUENTES`), em português comum. **Ao montar um cliente novo é
> ali que se corta o que ele não usa**, sem mexer em HTML nenhum.

- 6 primeiros passos numerados — a ordem é real: serviço sem duração não monta grade, e grade sem
  horário de funcionamento não abre o link.
- 25 perguntas em 5 assuntos, agrupadas **pelo assunto e não pela tela**: quem tem a dúvida ainda
  não sabe em que tela ela mora.
- A busca varre a **resposta inteira**, não só o título. Quem procura "troco" ou "cerveja" não usa
  a palavra do cabeçalho, e devolver "nada encontrado" faria a pessoa concluir que o sistema não
  faz aquilo.
- **Contato do suporte em dois lugares**: um bloco no fim do guia e um link no rodapé do modal
  (`wa.me/5516997603600`). O bloco do fim vem depois de 25 perguntas; o rodapé é o único que não
  rola junto com o conteúdo.

⚠️ **Ao mexer numa tela, conferir se o guia ainda descreve a realidade.** A pergunta *"O que
significa 'Quem compra produto'?"* sobreviveu por engano à remoção do painel e passou a explicar
uma tela que não existia mais.

**Como testar:** `testes/testa_ajuda.js`.

### ⚠️ Migração que não rodou é funcionalidade que não existe (18/08/2026)

O `docs/add_niveis_de_acesso.sql` ficou **três semanas** sem ser executado no banco da Alabama.
O código dele estava em produção desde o commit `0f809b1`. Nesse período, a **fila do cliente**
não respondia e as **restrições de acesso do barbeiro não existiam na RLS** — e ninguém notou,
porque `public/api.js` cai para o `localStorage` sem reclamar quando um objeto não existe.

O sintoma só apareceu por acaso, semanas depois, ao rodar outro script:

```text
ERROR: 42883: function public.meu_papel() does not exist
```

Esse erro **não era do script que estava rodando** — era do script anterior, que nunca rodou.

**O que fazer:** ao terminar uma funcionalidade que tem SQL, rodar a migração **junto** com o
deploy do código, e conferir com `docs/diagnostico_banco.sql`. Ele lê o catálogo do Postgres e
mostra a cadeia inteira de uma vez, em vez de descobrir um buraco por erro.

> ⚠️ **Conferir o catálogo não é conferir a funcionalidade.** O diagnóstico diz que o objeto
> existe; só o teste no aparelho diz que a tela responde. As duas coisas.

### ⚠️ Armadilha: patch em ASCII come os acentos (18/08/2026)

As telas de Estoque foram montadas por scripts Python que escreviam o HTML em ASCII. O texto foi
para a tela **sem acento e sem cedilha** — "Movimentacoes", "Saida", "Preco", "Cartao de Credito",
"Nao identificado" —, e passou despercebido porque nenhum teste olha ortografia. Foram 28 trechos.

**Ao gerar HTML por script, escrever o texto acentuado** (arquivo `# -*- coding: utf-8 -*-`,
`io.open(..., encoding='utf-8')`). Para conferir depois, existe a receita usada na correção:
montar o vocabulário acentuado a partir do próprio projeto e acusar toda palavra só-ASCII que
tenha forma acentuada conhecida — foi assim que os 28 apareceram de uma vez.

### ⚠️ Armadilha: identidade git errada bloqueia o deploy em silêncio (10/09/2026)

Quatro commits seguidos (`104324c` a `b91d8bb`) foram enviados com sucesso ao GitHub, mas **nenhum
deles foi publicado** — o Vercel recusou todos com `"Deployment was blocked"`. `git push` sem erro
nenhum não quer dizer que o site atualizou.

**Causa:** a máquina que gerou os commits tinha `git config --global user.name/user.email` ainda
no valor de exemplo (`"Seu Nome" <seu.email@exemplo.com>`), nunca trocado pela identidade real. O
GitHub tentou casar aquele e-mail fake com alguma conta cadastrada e resolveu para um usuário sem
nenhuma relação com o projeto. Como o plano é **Hobby** (ver "Plano Hobby x uso comercial" acima),
ele não aceita deploy de quem não é colaborador reconhecido do projeto no Vercel — e bloqueia, sem
avisar em lugar nenhum além do próprio painel do Vercel (o `git push` retorna sucesso normalmente).

**Como perceber:** `git push` sozinho não prova que o site atualizou. Conferir o status real do
deploy:

```bash
gh api repos/lexionconsultoria/alabama_barbearia/commits/<sha>/status --jq '.state, .statuses[0].description'
```

`"failure"` + `"Deployment was blocked"` é este caso. Comparar com o `?v=` do `index.html` publicado
(`curl -s https://alabamabarbearia.com.br/index.html | grep -o '?v=[0-9]*'`) também denuncia — se
for menor que o do repositório, o deploy não pegou.

**Correção:** configurar a identidade certa (a mesma dos commits que sempre passaram, `Lexion
Consultoria <278407426+lexionconsultoria@users.noreply.github.com>`) e fazer um commit novo — nem
precisa mudar código, um commit vazio (`git commit --allow-empty`) já dispara um deploy novo, que
publica o estado ATUAL do `main` inteiro, não só o diff do commit que disparou. Os commits
bloqueados não precisam ser refeitos nem re-enviados.

```bash
git config --global user.name "Lexion Consultoria"
git config --global user.email "278407426+lexionconsultoria@users.noreply.github.com"
```

### ⚠️ Armadilha: exclusão de itens não pode depender de `saveData` (10/09/2026)

Ao tentar excluir uma transação na aba Financeiro ou descartar uma pendência antiga de caixa, a linha sumia momentaneamente da tela com toast de sucesso, mas voltava após o F5 ou qualquer nova sincronização com a nuvem.

**Causa:** `deleteTransaction(id)` e `descartarPendenciaAntiga(id)` apenas filtravam o array em memória (`data.transactions = data.transactions.filter(...)`) e chamavam `saveData(STATE_KEYS.TRANSACTIONS, data.transactions)`. Como `DataService.save` faz `upsert` das linhas do array no Supabase, o banco atualizava os registros restantes, **mas nunca deletava a linha removida**. Ao recarregar ou chamar `loadAll`, o Supabase devolvia a transação intacta.

**Correção:** toda exclusão precisa chamar explicitamente `await DataService.deleteItem('tabela', id)` (como já era feito para clientes, leads, serviços, profissionais e bloqueios). Foi adicionado tratamento com `try/catch` e rollback do array local caso ocorra erro no servidor.

### Ajustes Visuais e Identidade da Barbearia (10/09/2026)

1. **Alinhamento do telefone dos profissionais:** No card de profissionais em Configurações, o telefone e o nome eram `<span>` inline, fazendo o telefone quebrar de forma desordenada ao lado do nome (`<nome> 📞(DD) 9XXXX- \n XXXX`). Alterado `.item-config-title` para `display: block;` e `.item-config-subtitle` para `display: flex; gap: 6px; white-space: nowrap; margin-top: 4px;`.
2. **Fundo verde escuro e remoção do tom amarelado:** O fundo original era excessivamente claro e puxava para tons oliva desbotados (`#0D1612`, `#15211B`, `#1D2C25`), enquanto os textos estavam em bege (`#D7D2BD`) e as bordas eram amareladas. A paleta foi aprofundada para um verde escuro noturno nobre (`#07100B`, superfícies `#0D1A14` e `#13241D`), com textos em branco suave/nítido (`#F1F5F9` / `#F8FAFC`), textos secundários em cinza slate (`#94A3B8`), bordas neutras (`rgba(255, 255, 255, 0.08)`) e dourado refinado (`#C5A059` / `#D4AF67`), replicado em `index.css` e `auth.css`.
3. **Cache-busting:** Atualizado para `?v=44` em `index.html` e versão do sistema para `1.6.1` em `app.js`.

### Ajustes de Acesso e Vendas (v1.6.2 - 10/09/2026)

1. **Restrição da aba "Financeiro" para profissionais:**
   - Adicionado `'financeiro'` ao array `ABAS_SO_DO_DONO` em `public/app.js` (`['leads', 'configuracoes', 'financeiro']`).
   - Adicionada regra CSS em `public/index.css` ocultando seções e itens de menu para `body.acesso-barbeiro`.
   - Adicionado redirecionamento seguro em `switchTab` e `renderPageData` caso o profissional tente acessar a URL ou clique em atalho para abas restritas.
   - Os profissionais mantêm acesso normal à aba "Comissões" (onde acompanham suas comissões de forma recortada pela RLS).

2. **Acesso a TODOS os clientes pelo login dos profissionais:**
   - No frontend, o sistema já carregava `clients` sem filtro. O bloqueio ocorria no banco Supabase pela política RLS (`EXISTS (SELECT 1 FROM appointments a WHERE a."clientId" = clients.id AND a."profId" = public.meu_profissional())`).
   - Criada a migração `docs/29_libera_todos_clientes_para_profissionais.sql` que remove a política restritiva e cria as políticas de salão:
     - `SELECT`: Qualquer membro autenticado do salão vê todos os clientes cadastrados (`user_id = public.salao_do_usuario()`).
     - `INSERT`: Qualquer membro autenticado pode cadastrar novos clientes.
     - `UPDATE`: Qualquer membro autenticado pode editar dados dos clientes.
     - `DELETE`: Exclusão de clientes permanece restrita ao proprietário/administrador (`public.meu_papel() = 'owner'`).

3. **Operador da venda: "Administrador" em vez de "Dono":**
   - Na função `resolveSaleOperator(soldById)` em `public/vendas-base.js`, substituído o rótulo informal `'Dono'` pelo termo formal `'Administrador'` tanto na tabela da aba Vendas quanto no modal de detalhes da venda.
   - Adicionada checagem para `DataService.getTenantId()` e `membro.role === 'owner'` para cobrir vendas diretas pelo administrador.

4. **Harmonização visual do botão "Chegou agora":**
   - O botão estava com fundo verde esmeralda sólido (`#10b981`) e sombra pesada, destoando do restante do topo e competindo visualmente com o botão principal.
   - Reestilizado em `public/estoque.css` (`.btn-encaixe`) seguindo o modelo de botão secundário elegante da Lexion, adaptado para a paleta dourada da Alabama: fundo translúcido suave (`rgba(197, 160, 89, 0.12)`), borda fina dourada (`rgba(197, 160, 89, 0.35)`) e ícone/texto em dourado latão nobre (`#D4AF67`), harmonizando perfeitamente com o cabeçalho e sem competir com o botão principal sólido (+ Novo Agendamento).

5. **Versionamento e Cache:**
   - Versão do sistema atualizada para `1.6.2` em `public/app.js`.
   - Cache-busting atualizado para `?v=47` em `public/index.html`.

### Seleção Inteligente de Profissional no Encaixe ("Chegou agora") (v1.6.3 - 10/09/2026)

1. **Seletor de Profissional no Modal de Encaixe (`public/index.html` e `public/encaixe.js`):**
   - Adicionado dropdown de seleção de profissional `#encaixe-prof` no formulário rápido de "Chegou agora".
   - Opção padrão: `"Qualquer profissional (Mais rápido)"` para manter a agilidade de 1 clique caso o cliente que chegou não tenha preferência por barbeiro.
   - Popula dinamicamente apenas com os profissionais ativos da barbearia (`p.active`).
   - Se um barbeiro estiver logado no sistema (`DataService.ehBarbeiro()`), o select vem automaticamente pré-selecionado nele por conveniência operacional.

2. **Lógica de Busca e Fallback Automático com Sugestão (`public/encaixe.js`):**
   - **Caso 1 (Barbeiro selecionado com horário vago):** Busca vaga exclusivamente para ele (`primeiroHorarioLivre(hoje, duracao, { profId })`). Exibe o horário e o profissional diretamente.
   - **Caso 2 (Barbeiro selecionado sem horário hoje):** Se o barbeiro escolhido estiver lotado, o sistema busca automaticamente o próximo horário vago entre os demais profissionais da equipe (`primeiroHorarioLivre(hoje, duracao)`). Exibe um aviso visual âmbar (`⚠️ [Nome do Barbeiro] sem horário livre hoje.`) e logo abaixo sugere `Próximo disponível: HH:MM com [Outro Barbeiro]`, mantendo o botão de confirmação ativo para o recepcionista/balcão poder confirmar imediatamente sem fricção ou retrabalho.
   - **Caso 3 (Sem horário hoje em nenhum profissional):** Alerta que não há horários livres hoje para o serviço e desabilita o botão de confirmação.

3. **Estilização e Alertas (`public/estoque.css`):**
   - Classes `.encaixe-vaga.encaixe-vaga-sugerida`, `.encaixe-aviso-indisponivel` e `.encaixe-vaga-detalhe` para destacar a indisponibilidade do profissional solicitado e apresentar claramente a alternativa disponível.

4. **Versionamento e Cache:**
   - Versão do sistema atualizada para `1.6.3` em `public/app.js`.
   - Cache-busting atualizado para `?v=48` em `public/index.html`.

### Observação de performance

A logo do estabelecimento e as fotos dos profissionais são gravadas como **data URL em base64**
(`public/app.js`, no handler do `FileReader`). Uma imagem de 800 KB vira mais de 1 MB de texto trafegado
a cada salvamento. Orientar o cliente a subir imagens já reduzidas.
