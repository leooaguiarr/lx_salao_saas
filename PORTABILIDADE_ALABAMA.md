# Portabilidade para a Alabama Barbearia

Documento previsto na Fase H (`docs/PLANO_IMPLEMENTACAO_EVOLUCAO_VENDAS.md`, item 7): o mapa para
levar a Evolução de Vendas e os Níveis de Acesso — validados e testados neste clone
(`dashboard_salao` / projeto Supabase `awrslpvpwazdjyaeogdc`) — para o sistema real em produção,
a **Alabama Barbearia** (repositório `lexionconsultoria/alabama_barbearia`, projeto Supabase
`ekyonsvyeydfjxdytiyu`, `alabamabarbearia.com.br`).

Escrito em 09/09/2026, comparando os dois repositórios diretamente (não por suposição).

---

## 1. Por que este documento existe antes de qualquer código

A Alabama está em produção real, com a barbearia trabalhando nela todos os dias. O handoff dela
tem uma regra explícita desde 06/08/2026: **nada vai para o ar sem rodar localmente e sem o aval
do Leonardo antes do commit.** E o banco é o mesmo em local e produção — não existe ambiente de
teste separado lá.

Isso muda o método de trabalho em relação a este clone, onde cada fase podia ser testada e
corrigida livremente. Na Alabama, cada migration precisa ser **ensaiada em `BEGIN … ROLLBACK`
contra o banco real antes de ser aplicada de verdade** — exatamente como foi feito aqui na
auditoria da Fase H (`docs/AUDITORIA_FASE_H.md`, seção 6, para o script 27) — porque não há uma
cópia descartável do banco para errar primeiro.

## 2. O achado que redefine o tamanho do trabalho

A Alabama **não tem a Evolução de Vendas**. Comparando os dois repositórios:

| | Este clone (`dashboard_salao`) | Alabama (`lx_salao_alabama`) |
| --- | --- | --- |
| Arquitetura do front-end | Modular: `public/js/01-…` a `28-recibo.js`, `public/css/01-…` a `23-fidelidade.css` | **Monolítica de propósito**: `app.js` único (~5.700 linhas), `index.css` único |
| Versão | Fase H em andamento | `v1.5.0` |
| Tabelas de venda (`sales`, `sale_items`, `sale_payments`, `sale_commissions`, `receivables*`, `loyalty_*`) | Existem, testadas (Fases A-G) | **Não existem** |
| Abas Vendas / Comissões / Crediário / Fidelidade / Recibo | Existem | **Não existem** |
| Níveis de acesso | `27_niveis_de_acesso.sql` + `28_acesso_do_profissional.sql`, com self-service de criação de login pelo dono (Edge Function `acesso-profissional`) | `add_niveis_de_acesso.sql` — versão mais simples, sem Vendas, sem self-service de login (vínculo é manual, por SQL) |

**Consequência prática: não é possível portar "só os níveis de acesso".** O script `27` desta
sessão altera `sales`, lê `sale_commissions` e `loyalty_programs` — tabelas que só existem depois
da Evolução de Vendas. A camada de acesso que acabamos de validar na tela é construída **por
cima** dela, não ao lado.

### A boa notícia: a fundação é compatível

Comparando script a script, a Alabama já tem o equivalente exato dos scripts **01 a 13** deste
clone — confirmado pelo `docs/diagnostico_banco.sql` dela em 19/08/2026 (zero pendências: nenhuma
tabela, função ou coluna faltando, nenhuma assinatura duplicada):

| Este clone | Alabama | Status na Alabama |
| --- | --- | --- |
| `01_supabase_setup.sql` | `supabase_setup.sql` | ✅ |
| `02_public_booking_setup.sql` | `public_booking_setup.sql` | ✅ |
| `03_cash_registers.sql` | `supabase_cash_registers.sql` | ✅ |
| `04_fix_columns.sql` | `supabase_fix_columns.sql` | ✅ |
| `05_professionals_photo.sql` | `update_professionals_photo.sql` | ✅ |
| `06_business_avatar.sql` | `add_business_avatar.sql` | ✅ |
| `07_transaction_timestamp.sql` | `add_transaction_timestamp.sql` | ✅ |
| `08_multi_login_por_salao.sql` | `multi_login_por_salao.sql` | ✅ |
| `09_whatsapp_messages.sql` | `add_whatsapp_messages.sql` | ✅ |
| `10_disponibilidade.sql` | `add_disponibilidade.sql` | ✅ |
| `11_niveis_de_acesso_e_fila.sql` | `add_niveis_de_acesso.sql` | ✅ (versão própria, sem Vendas) |
| `12_produtos_e_estoque.sql` | `add_produtos_e_estoque.sql` | ✅ |
| `13_movimentacao_de_estoque.sql` | `add_movimentacao_estoque.sql` | ✅ |

`salon_members`, `meu_papel()`, `meu_profissional()` e `salao_do_usuario()` já existem na Alabama
com os mesmos nomes e o mesmo contrato — vieram da mesma linhagem de scripts. **A fundação de
multi-login e RLS por salão não precisa ser refeita.**

⚠️ **Risco já registrado no handoff da própria Alabama, e que continua valendo para qualquer
migration nova:** `salon_members.role` tem `DEFAULT 'staff'`. Um login inserido sem passar pelo
fluxo que semeia `'owner'` cai como `staff` sem `professional_id` e **não enxerga nada** depois de
qualquer RLS nova entrar em vigor. Conferir antes de cada migration:

```sql
SELECT u.email, m.role, m.professional_id
FROM public.salon_members m
JOIN auth.users u ON u.id = m.user_id
ORDER BY m.role, u.email;
```

---

## 3. Decisão de arquitetura — precisa ser tomada antes de escrever código

A Alabama ficou monolítica **de propósito**, para não misturar reorganização de arquivo com
funcionalidade nova. Portar a Evolução de Vendas força a escolha entre duas rotas, e nenhuma das
duas é puramente técnica — envolve risco e tempo, então é decisão do Leonardo:

| Rota | O que significa | Vantagem | Risco |
| --- | --- | --- | --- |
| **A. Levar os módulos como estão** (`22-vendas-base.js` … `28-recibo.js`, `19-vendas.css` … `23-fidelidade.css`, mais `index.html`) | Alabama passa a ter dois estilos de arquivo: o `app.js` antigo e os módulos novos carregados depois | Reaproveita o código já testado nas Fases A-G sem reescrever nada | Quebra a regra que a própria Alabama registrou ("misturar reorganização com funcionalidade nova é caça de agulha no palheiro") — mas aqui a reorganização já está pronta e testada, não é feita ao vivo |
| **B. Reimplementar dentro do `app.js`** | A lógica de Vendas/Comissões/Crediário/Fidelidade é reescrita nas convenções atuais da Alabama (tudo num arquivo, ou em `estoque.js`/`encaixe.js`/`ajuda.js` como ela já faz para features pontuais) | Mantém a Alabama num estilo só | Reescrever ~7 arquivos e ~1.500 linhas testadas é trabalho novo, com chance de introduzir bugs que a suíte de testes já provou não existir na versão modular |

**Recomendação, mas a decisão é do Leonardo:** Rota A. O argumento da Alabama contra misturar
reorganização com funcionalidade nova vale para reorganizar *ao vivo*, num sistema em produção —
não é o caso aqui, porque a reorganização já aconteceu neste clone e já foi testada. Forçar tudo
de volta para um `app.js` de ~7.000 linhas é reintroduzir o problema que a divisão em módulos veio
resolver, bem na hora de adicionar a parte mais complexa do sistema até agora.

---

## 4. Ordem de execução

### 4.1 Banco de dados — Evolução de Vendas (Fases A-G)

Copiar os arquivos e rodar no SQL Editor do projeto Supabase da Alabama (`ekyonsvyeydfjxdytiyu`),
**cada um ensaiado primeiro em `BEGIN … ROLLBACK`** contra o banco real, na ordem:

| # | Script | Fase |
| --- | --- | --- |
| 14 | `14_vendas_base.sql` | A — tabelas `sales`, `sale_items`, `sale_payments` |
| 15 | `15_finalizacao_venda.sql` | B — RPC `finalizar_venda` |
| 16 | `16_politicas_por_comando.sql` | fecha o `DELETE` do profissional nas tabelas novas |
| 17 | `17_limite_das_consultas_publicas.sql` | limite por endereço no link público |
| 18 | `18_remove_agendamento_antigo.sql` | remove o RPC do fluxo antigo de pagamento |
| 19 | `19_revoke_anon_das_rpcs_internas.sql` | fecha `anon` nas RPCs internas |
| 20 | `20_fechamento_de_caixa.sql` | C — conferência no fechamento |
| 21 | `21_comissoes.sql` | D — razão de comissões |
| 22 | `22_fecha_anon_nas_internas_restantes.sql` | fecha `anon` nas RPCs restantes |
| 23 | `23_crediario.sql` | E — parcelas e recebimento |
| 24 | `24_corrige_source_crediario.sql` | correção de bug do 23 (sem ela, receber parcela falha) |
| 25 | `25_fidelidade.sql` | F — clube de pontos |
| 26 | `26_mensagens_editaveis.sql` | mensagens de cobrança e de meta atingida editáveis |

> ⚠️ **Achado 1 da Fase H se repete aqui.** `25_fidelidade.sql` cria `clients."loyaltyEnrolled"`
> com `ADD COLUMN IF NOT EXISTS ... DEFAULT true`. Como a Alabama nunca teve essa coluna, o
> `DEFAULT true` vale desde o início — não há o problema encontrado no clone (lá a coluna já
> existia com `DEFAULT false` de uma versão anterior do script, e `ADD COLUMN IF NOT EXISTS` não
> corrige default de coluna existente). Ainda assim, **conferir depois de rodar**:
> `SELECT "loyaltyEnrolled", count(*) FROM clients GROUP BY 1;` — todo cliente existente da
> Alabama deve entrar como `true`.

Conferência sugerida ao final (adaptar a consulta de `docs/AUDITORIA_FASE_H.md` seção 5): soma dos
itens = total da venda, soma dos pagamentos = recebido, nenhuma comissão gerada por produto.

### 4.2 Banco de dados — Níveis de acesso novo

Só depois do bloco 4.1 estar aplicado e conferido:

| # | Script | O que faz |
| --- | --- | --- |
| 27 | `27_niveis_de_acesso.sql` | `sales.sold_by`; leitura de vendas e fidelidade por salão inteiro; trava do atendimento de outro profissional |
| 28 | `28_acesso_do_profissional.sql` | `professionals.email`; leitura do quadro do salão para o self-service de criação de login |

⚠️ **A Alabama já tem `add_niveis_de_acesso.sql` próprio.** Antes de rodar o `27`, comparar as
políticas que ele recria (`sales`, `sale_items`, `sale_payments`, `loyalty_programs`) com o que já
existe — o objetivo é **somar**, não duplicar uma política equivalente com nome diferente. O script
27 deste clone foi escrito assumindo a RLS de `appointments`/`clients`/`transactions` exatamente
como o script 11 a deixou; como a Alabama rodou o próprio equivalente (`add_niveis_de_acesso.sql`),
confirmar que o formato das políticas é o mesmo antes de aplicar o patch de `finalizar_venda` e
`resgatar_fidelidade` (as âncoras do `27` precisam casar com o texto exato da função que está
rodando — o mesmo cuidado do item "Alterar uma RPC existente" no handoff deste clone).

### 4.3 Edge Function

Publicar `acesso-profissional` no projeto Supabase da Alabama:

```bash
supabase functions deploy acesso-profissional --project-ref ekyonsvyeydfjxdytiyu
```

Ou pelo painel, colando o conteúdo de `supabase/functions/acesso-profissional/index.ts`. Sem ela,
o cadastro do profissional funciona normalmente — só o botão "Liberar acesso" não responde. A
Alabama hoje vincula `professional_id` manualmente por SQL (documentado no fim do
`add_niveis_de_acesso.sql` dela); a Edge Function substitui esse passo manual pelo fluxo de tela.

### 4.4 Código — front-end

Depende da decisão da seção 3.

**Se Rota A (levar os módulos):**

- Copiar `public/js/22-vendas-base.js` até `28-recibo.js` e `public/css/19-vendas.css` até
  `23-fidelidade.css` para a Alabama.
- Em `index.html`, acrescentar as tags `<script>`/`<link>` novas **depois** das existentes,
  seguindo a mesma ordem numérica — a Alabama já tem essa regra documentada para os próprios
  arquivos (`estoque.js`, `encaixe.js`, `ajuda.js` carregados depois do `app.js`).
- Trazer os blocos de HTML novos (checkout, comissões, crediário, fidelidade, recibo, painéis de
  acesso do profissional) do `index.html` deste clone.
- **Subir o `?v=` de toda tag `<script>`/`<link>` do `index.html` da Alabama** — regra dela mesma,
  sem isso o navegador do cliente serve o arquivo velho.

**Se Rota B (reimplementar):** este documento não prescreve como, porque a decisão de arquitetura
vem primeiro — nesse caso, o trabalho de fase A a G se repete na Alabama, só que dentro das
convenções dela, e cada fase precisa do mesmo ciclo de testes que teve aqui.

### 4.5 O que NÃO copiar

Igual ao aviso já registrado em `docs/historico/PORTAR_PARA_O_PROJETO_RAIZ.md` para a portabilidade
anterior — vale de novo, e no sentido contrário (daqui para a Alabama, não para a raiz genérica):

| Não copiar | Motivo |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` de `public/api.js` | A Alabama aponta para `ekyonsvyeydfjxdytiyu`, não para o projeto deste clone |
| Identidade visual (`--primary`, logos, `<title>`, textos "Lexion" genéricos) | A Alabama já tem a própria marca aplicada |
| `docs/historico/AGENT_HANDOFF.md` deste clone | É o diário deste ambiente de teste. A Alabama tem o dela — registrar lá o que for aplicado |
| `docs/PLANO_IMPLEMENTACAO_EVOLUCAO_VENDAS.md`, `docs/AUDITORIA_FASE_H.md` | São documentos do processo de validação, não do produto — ficam aqui como histórico |

---

## 5. Checklist de RLS antes de liberar para uso real

Repetir, contra o banco da Alabama, o que a auditoria da Fase H fez aqui
(`docs/AUDITORIA_FASE_H.md`, seções 2 e 3):

- [ ] Todas as tabelas novas (`sales`, `sale_items`, `sale_payments`, `sale_commissions`,
      `receivables`, `receivable_installments`, `receivable_payments`, `loyalty_movements`,
      `loyalty_programs`) com RLS **ligada**.
- [ ] Testar isolamento trocando o JWT: `owner` da Alabama vê tudo dela; um segundo salão
      fictício (se houver algum outro cliente Lexion no mesmo projeto — confirmar que não há) não
      vê nada da Alabama; `anon` não vê nada das tabelas de venda.
- [ ] Staff (barbeiro) vê só as próprias comissões e as próprias linhas de financeiro — nunca as
      de outro profissional.
- [ ] Caixa e Crediário continuam fechados para o staff (`meu_papel() = 'owner'` no `SELECT`).
- [ ] Nenhuma RPC de venda, comissão, crediário ou fidelidade responde a `anon`.

## 6. Plano de rollback

Como local e produção compartilham o mesmo banco na Alabama, o rollback tem duas frentes:

- **Banco:** cada script 14-28 é idempotente e não usa `DROP TABLE`. Se algo sair errado depois de
  aplicado, o caminho não é desfazer a migration — é corrigir com um script novo, pequeno,
  seguindo a mesma regra deste clone ("Estratégia de migrations", `docs/PLANO_IMPLEMENTACAO_EVOLUCAO_VENDAS.md`
  seção 5). Por isso o ensaio em `BEGIN … ROLLBACK` **antes** de aplicar de verdade é a proteção
  real, não o rollback depois.
- **Código:** a Vercel mantém o build anterior no ar até um novo deploy ter sucesso — um
  `git revert` do commit problemático e um novo push restaura o comportamento anterior sem
  precisar desfazer nada no banco (as tabelas novas ficam ali, sem uso, até a próxima tentativa).

## 7. Pendências que ficam abertas aqui no clone (não bloqueiam a Alabama)

Registradas em `docs/historico/AGENT_HANDOFF.md`, continuam as mesmas depois deste documento:

- 2 dos 30 cenários obrigatórios ainda não automatizados na suíte deste clone (#6 — pix + dinheiro
  dividido; #16 — 100% crediário).
- A matriz completa dos 30 cenários (mapeamento cenário → teste) ainda não foi redigida.

Nenhuma delas impede começar a Rota A/B na Alabama — são lacunas de documentação/cobertura de
teste deste ambiente de validação, não bugs conhecidos.
