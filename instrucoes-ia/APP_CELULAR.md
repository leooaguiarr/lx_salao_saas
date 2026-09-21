# O painel como aplicativo no celular

O painel é uma **PWA**: o mesmo sistema roda no navegador do computador e
instala como aplicativo no celular. Não há duas bases de código; todo deploy
atualiza os dois de uma vez.

## Instalar

- **Android (Chrome)**: menu lateral > **Instalar aplicativo**. Se o botão não
  aparecer, menu do Chrome (três pontos) > **Instalar aplicativo**.
- **iPhone (Safari)**: menu lateral > **Instalar aplicativo** mostra o passo a
  passo: Compartilhar > **Adicionar à Tela de Início**. O Chrome do iPhone não
  instala; tem que ser pelo Safari.
- **Computador**: Chrome e Edge também oferecem instalar em janela própria.

Instalado, abre em tela cheia direto no `/app`. Segurando o ícone, os atalhos
levam para **Agenda**, **Vendas** e **Clientes**.

O botão só aparece quando faz sentido: some quando o app já está instalado e
nunca aparece no link público de agendamento (`/<slug>`), para o cliente do
salão não instalar o painel por engano.

## Sem internet

A **interface** abre sem rede, pelo cache do service worker. Os **dados não**:
agenda, clientes e vendas vêm do Supabase a cada abertura. Diferente da Hiper
(Firestore, com cópia local), aqui não existe fila de gravação offline.

## No celular

Até 768px de largura, a navegação vira uma **barra inferior** com Início,
Agenda, Vendas, Clientes e Menu (que abre a lateral com o restante). As margens
respeitam o notch e a barra de gestos (`viewport-fit=cover` + `safe-area`).

## Notas técnicas

- `public/manifest.webmanifest` — nome, ícones, cores e atalhos.
- `public/sw.js` — cache da interface. Navegação é rede-primeiro; CSS/JS/fontes
  respondem do cache e revalidam em segundo plano. Nunca intercepta `/api/` nem
  o Supabase.
- `public/pwa.js` — registro do SW, botão de instalar e cor da barra de status
  acompanhando o tema claro/escuro.
- Ícones em `public/assets/icon-*.png` e `apple-touch-icon.png`, gerados do
  `logo_lexion_gold.png` sobre `#0A0A0B`. O `maskable` tem o logo menor porque o
  Android recorta as bordas.
- O servidor entrega `sw.js` e o manifest **sem cache**; com o `max-age` de um
  dia dos outros estáticos, um deploy só chegaria ao app no dia seguinte.
- **Ao mudar CSS/JS**, continue subindo o `?v=` no `index.html`, como sempre. O
  SW pega a versão nova e descarta a anterior sozinho.
- **Ao mudar a lógica do `sw.js`**, suba a constante `VERSAO` dentro dele.
- A instalação exige HTTPS (produção já tem); em `localhost` funciona para teste.
