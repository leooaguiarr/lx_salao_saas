# Como trabalhar neste projeto

## O fluxo

O sistema está **em produção**, com salões usando todos os dias, e cada push
na `main` publica sozinho. Por isso:

1. Alterar o código.
2. Subir o servidor local e **ver funcionando**, inclusive na largura de
   celular (390px), que é onde o sistema é mais usado.
3. Rodar as ferramentas de verificação que tocam a área alterada.
4. **Mostrar ao Leonardo e esperar o aval** antes de commit e push, a menos
   que ele já tenha pedido para publicar.
5. Commit, push e **conferir em produção** que o deploy pegou.

## Mais de um agente ao mesmo tempo

Às vezes dois agentes (Claude, Gemini...) trabalham no repositório em
paralelo, cada um numa conversa. Para não pisar um no outro:

- **`git pull` antes de começar e de novo antes do push** (`git pull
  --rebase`). O outro pode ter publicado nesse meio-tempo.
- **Conflito no `?v=` do `index.html` é o mais comum.** Resolva ficando com o
  número mais alto dos dois lados **mais um**, em todas as tags.
- Commits pequenos e só com os arquivos da sua tarefa (`git add <arquivos>`,
  nunca `git add .`).
- Se a tarefa encostar em arquivo que o outro está mexendo, avise o Leonardo
  antes de seguir.

## Rodar

```powershell
node server.js              # http://localhost:8000  (landing em /, painel em /app)
$env:PORT=8123; node server.js   # outra porta, se a 8000 estiver ocupada
```

Sem `npm install`: não há dependências. O servidor local fala com o **banco
de produção** — ver a regra de ouro 2 no [LEIA-ME.md](LEIA-ME.md).

Um `node server.js` esquecido de outra sessão continua servindo código velho
na porta. Comportamento inexplicável → mate os processos `node` e suba de novo.

## Verificar (Chrome headless, sem dependências)

As ferramentas ficam em [ferramentas/](ferramentas/) e falam com o Chrome pelo
DevTools Protocol. Precisam do servidor rodando em outro terminal.

```powershell
# print de uma tela, em largura de celular, com relatório de transbordo
node instrucoes-ia/ferramentas/print.js http://localhost:8000/app saida.png 390

# o mesmo, mostrando o painel sem login e abrindo uma aba
node instrucoes-ia/ferramentas/print.js http://localhost:8000/app vendas.png 390 --painel --aba=vendas

# PWA: manifest, instalável, service worker, abre offline, link público sem manifest
node instrucoes-ia/ferramentas/pwa-test.js http://localhost:8000
```

- `--painel` esconde a tela de login e mostra o painel com os dados de exemplo
  do HTML. **Não faz login e não toca no banco** — serve para layout, não para
  comportamento.
- O `print.js` imprime `vw` (largura do viewport) e a lista de elementos que
  passam da borda. Em 390px, `vw` tem que dar 390.
- Os testes com dados reais (login, venda, caixa) **não estão automatizados**
  neste repositório. A Alabama tinha 28 (`lx_salao_alabama/testes/`), que
  injetavam dados falsos na memória do navegador em vez de usar o banco — é o
  modelo a seguir ao criar novos.

**Nunca use `--window-size` para simular celular.** No Windows o Chrome
headless tem piso de ~500px de janela e recorta a imagem, o que parece
conteúdo vazando. Já gerou relatório de bug que não existia. Use a emulação
(`Emulation.setDeviceMetricsOverride`), como as ferramentas fazem.

## Publicar

```bash
git push origin main     # dispara o deploy no Coolify
```

**Push recusado com 403?** A máquina pode estar autenticada no Git como
`lexionconsultoria`, que não tem permissão no repositório. O dono é
`leooaguiarr`. Se o `gh` tiver as duas contas (`gh auth status`), empurre com
a conta certa sem mexer na configuração global:

```bash
git -c credential.helper= \
    -c 'credential.helper=!f(){ echo username=leooaguiarr; echo "password=$(gh auth token --user leooaguiarr)"; }; f' \
    push origin main
```

**Push com sucesso não prova que o site atualizou.** Confira:

```bash
curl -s https://salao.lexionconsultoria.tech/app | grep -o '?v=[0-9]*' | head -1
```

Tem que bater com o `?v=` do `index.html` do repositório. O deploy leva
cerca de 1 minuto.

## Versões

- **`?v=` do `index.html`** (cache do navegador): subir em **todas** as tags,
  juntas, sempre que qualquer arquivo de `public/` mudar.
- **`VERSAO_DO_SISTEMA`** em `public/app.js` (aparece no rodapé do login):
  `MAIOR.MENOR.CORRECAO`. Funcionalidade nova sobe o `MENOR`; correção sobe a
  `CORRECAO`. Sobe junto com a entrega, antes do push.
- **`VERSAO`** em `public/sw.js`: só quando a lógica do service worker mudar.

## Commits

- Mensagem em **português**, no formato `tipo(área): resumo` (`feat`, `fix`,
  `style`, `refactor`, `docs`).
- O corpo explica **o porquê**: o sintoma, a causa, a decisão. Veja o
  `git log` — é o padrão do projeto.
- Não inclua no commit arquivos que não são da tarefa (ex.: `docs/imagens/`,
  que é local).

## Estilo de código

- **Português** em comentários, textos de tela, nomes de funções novas e
  mensagens. Chaves de dados e colunas herdadas estão em inglês (`clients`,
  `paymentStatus`): não "corrija" isso, renomear exige varrer tudo.
- **Comentário explica a decisão**, em blocos curtos e com o contexto do
  problema. Não remova comentários que documentam uma armadilha.
- HTML montado por template string. Texto que veio do usuário ou do banco não
  entra cru em `innerHTML`: use `textContent` ou o `textoSeguro()` do
  `topbar.js` / `sanitizePlainText()` do `app.js`.
- Visibilidade por `el.hidden = true/false`; cores só pelas variáveis CSS do
  tema.
- Arquivo novo para funcionalidade nova, carregado depois do `app.js`.
- Textos com acento e cedilha corretos. Script que gera HTML tem que gravar em
  UTF-8 — já saíram 28 trechos sem acento para produção por isso.

## Ao mexer numa tela, confira também

- O **guia rápido** (`public/ajuda.js`) ainda descreve a tela como ela é.
- O **perfil barbeiro**: a aba nova deve ou não estar em `ABAS_SO_DO_DONO`?
- O **plano**: o recurso é de todos ou deve ser travado no `saas-plan.js`?
- O **tema claro** e o **celular** (barra inferior, 390px).
- [FUNCIONALIDADES.md](FUNCIONALIDADES.md), se o usuário ganhou ou perdeu algo.
