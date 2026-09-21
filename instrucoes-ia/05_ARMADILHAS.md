# Armadilhas conhecidas

Cada item já custou tempo. Leia antes de repetir. Ao cair numa nova, anote
aqui (data, sintoma, causa, o que fazer).

## Dados e banco

- **Excluir não pode depender do `saveData`.** O `save` é upsert do array: a
  linha tirada do array continua no banco e volta no próximo carregamento.
  Toda exclusão chama `await DataService.deleteItem('tabela', id)`.
- **Upsert em lote grava `NULL` onde falta a chave.** Coluna `NOT NULL` nova
  numa tabela salva por `saveData` precisa de normalização no `api.js` (como
  `normalizaFidelidade` e `normalizaServico`), senão o lote inteiro falha.
- **Coluna que não existe no banco derruba o registro inteiro** (`PGRST204`).
  Campo novo de `business_info` entra na migração **e** na lista `allowedCols`
  do `api.js`.
- **Migração que não rodou é funcionalidade que não existe — e ninguém vê.** O
  `api.js` cai para o `localStorage` sem reclamar quando uma tabela, coluna ou
  RPC falta. Na Alabama, um script ficou três semanas sem rodar e a restrição
  de acesso do barbeiro simplesmente não existia. No SaaS, as RPCs do link
  público ficaram fora do `00_MASTER` e o link caiu (corrigido pela 06). Suspeita
  aberta do mesmo tipo: ver risco 2 em
  [01_PRODUTO_E_ESTADO.md](01_PRODUTO_E_ESTADO.md).
- **O ciclo leve devolve `undefined` de propósito** para `business_info`,
  `professionals` e `products`. Trocar por `[]`/`{}` zera a agenda sem erro.
- **O `saveData` limpa todo texto que grava** (`sanitizeForStorage`): tira `<`
  e `>`, troca caracteres de controle e **junta espaços e quebras de linha num
  espaço só**. Um campo que precise guardar quebra de linha não pode passar por
  ele sem adaptação.
- **Fotos são base64 dentro do banco.** Imagem de 800 KB vira mais de 1 MB de
  texto em cada carga completa. Oriente a subir imagens reduzidas.
- **Comentários citam `docs/NN_*.sql`**, mas esses arquivos estão em
  `docs/legacy_sql/`. O schema vigente é o de `supabase/migrations/`.

## Regras de negócio que parecem bug, mas não são

- **A transação tem duas datas.** `date` é a competência (dia do atendimento,
  usada no faturamento); `registradoEm` é quando o dinheiro mexeu (usada no
  caixa e na gaveta). Pagar hoje um atendimento de ontem aparece no faturamento
  de ontem e no caixa de hoje.
- **Comissão só sobre serviço pago.** Os cálculos filtram
  `category === 'Serviço'`. O lançamento de produto carrega `profId` (para saber
  quem vendeu) e vazaria para a comissão se o filtro sair.
- **Uma regra, um lugar.** Pendência de pagamento é só
  `pagamentosPendentesAte()`; saldo da gaveta é só `resumoDaGaveta()`;
  frequência de retorno é só `frequenciaDoCliente()`. Duplicar faz duas telas
  mostrarem números diferentes.
- **"Há quantos dias veio" usa `diasDesdeAVisita()`**, nunca `daysBetween()`,
  que devolve distância absoluta (um cliente de hoje aparecia com 27 dias). E
  `0` é valor válido: compare com `null`, não com falsy.
- **Estoque nunca fica negativo**: a saída maior que o saldo zera o item.

## Tela e navegador

- **`hidden` perde para `display` do CSS.** O projeto **não** tem uma regra
  global `[hidden] { display: none }`. Elemento com `display: flex/grid/block`
  na própria classe precisa de `.classe[hidden] { display: none; }` — é o padrão
  dos CSS do projeto. Aconteceu com o botão "Instalar aplicativo" em
  21/09/2026, e o teste só pegou quando passou a olhar `getComputedStyle`.
- **`100vh` no celular ignora as barras do navegador.** Rodapé de modal, botão
  Sair e fim da página ficavam escondidos. Use `100dvh`.
- **Campo obrigatório escondido trava o formulário em silêncio.** O formulário
  de agendamento é `novalidate`, com a validação no JS dizendo o que falta. Não
  ponha `required` em campo que some conforme o modo.
- **Abas no hash (`#vendas`), nunca no caminho** — o caminho é o slug do link
  público. Rota nova do painel entra em `ROTAS_INTERNAS` (e na cópia do
  `<head>` do `index.html`).
- **Rótulo do link público não pode ter domínio fixo.** Ele é montado a partir
  de `location.host` (`updatePublicUrlLabels`).
- **`minimum-scale=1` na viewport é intencional.** Durante o carregamento algo
  passa um instante da largura da tela, e o Chrome do celular reduzia o zoom e
  não voltava: página 9px mais larga, "solta" para o lado. Não remova.
- **Ao mudar uma tela, confira o guia rápido** (`ajuda.js`). Já sobrou pergunta
  explicando painel que tinha sido removido.

## Ferramentas e ambiente

- **Chrome headless com `--window-size` mente** no Windows (piso de ~500px).
  Use emulação pelo DevTools Protocol, como as [ferramentas/](ferramentas/).
- **O headless também mede errado com barra de rolagem clássica** e ao medir
  antes da animação de um modal terminar. Desconfie de "estouro" de poucos
  pixels: confira com `clientWidth` e reaplicando a emulação.
- **`python` no Windows abre a Microsoft Store** e trava o comando. Use `node`
  para scripts.
- **Heredoc do Bash come barras invertidas.** Arquivo com `\` escrito por
  `cat <<'EOF'` sai corrompido. Use a ferramenta de escrita de arquivo.
- **Push com 403**: conta errada no Git. Ver [04_COMO_TRABALHAR.md](04_COMO_TRABALHAR.md).
- **Push com sucesso não é deploy com sucesso.** Confira o `?v=` em produção.
- **Os avisos "LF will be replaced by CRLF"** do Git no Windows são inofensivos.
- **Servidor fantasma**: um `node server.js` antigo continua servindo código
  velho na porta. Mate os processos `node` antes de concluir que "não mudou".
