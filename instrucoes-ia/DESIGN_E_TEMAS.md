# Design e temas — decisão de 25/09/2026

Leonardo não gostou das cores nem do layout do painel. Esta página guarda a
direção aprovada e os valores exatos para implementar. **Nada disto está no
código ainda** — é a especificação do próximo trabalho.

Protótipo navegável (8 telas, privado na conta do Leonardo):
<https://claude.ai/artifact/QUxn2Few2eZ7FjHF7M6ZxQ>

## O problema que originou a mudança

1. **Painel e landing eram dois produtos visuais.** Painel preto com dourado e
   Plus Jakarta Sans; landing off-white com caramelo, verde floresta e Manrope.
   Quem se cadastrava caía numa tela que parecia outro sistema. Decisão do
   Leonardo: **a landing também é protótipo**, então a identidade nova nasce no
   painel e a landing é refeita depois para acompanhar.
2. **Defeitos de layout que nenhuma paleta resolve** (detalhados abaixo).

## A arquitetura: três eixos, não nove temas

Nove temas independentes seriam nove conjuntos de tokens validados em doze
telas. O custo não é estético, é funcional: texto que some, borda que
desaparece, status que perde a cor. Em vez disso:

| Eixo | Opções | O que define | Custo de manter |
| --- | --- | --- | --- |
| **Base** | claro, escuro | superfícies, texto, bordas | 2 |
| **Personalidade** | Clássica, Refinada, Clean | fonte, raio de canto, densidade, peso | 3 |
| **Acento** | 9+ | uma cor e seus derivados | ~0 |

O salão vê nove nomes comerciais; o sistema guarda três campos. Um tema novo é
uma linha de configuração, não um arquivo de CSS.

### As três personalidades

| | Fonte de título | Fonte de texto | Raio | Sensação |
| --- | --- | --- | --- | --- |
| **Clássica** (barbearia) | Instrument Serif | Karla | 4px | oficina, peso, tradição |
| **Refinada** (salão) | Outfit 600 | Outfit | 12px | comercial, leve |
| **Clean** (estética) | Manrope 800 | Manrope | 20px | clínica, respiro, sem bordas nos cards |

### Os nove temas

**Barbearia — personalidade Clássica**

| Nome | Base | Fundo | Superfície | Elevado | Acento | Texto |
| --- | --- | --- | --- | --- | --- | --- |
| Oldschool | escura | `#17130F` | `#201A14` | `#2A2219` | `#C8862F` | `#F2EAE0` / `#A99781` |
| Aço | escura | `#131417` | `#1C1E22` | `#24272C` | `#9BA7B4` | `#EDF0F3` |
| Navalha | clara | `#F3F1EC` | `#FFFFFF` | `#EDEAE3` | `#8C3A2E` | `#1E1B18` |

**Salão de beleza — personalidade Refinada**

| Nome | Base | Fundo | Superfície | Elevado | Acento | Texto |
| --- | --- | --- | --- | --- | --- | --- |
| Rosé | clara | `#FBF7F5` | `#FFFFFF` | `#F6EEEA` | `#A0455C` | `#2A211F` / `#8A7069` |
| Botânico | clara | `#F7F6F1` | `#FFFFFF` | `#EFEFE7` | `#5F7A4A` | `#23261F` |
| Noir Chic | escura | `#141216` | `#1E1A1F` | `#272229` | `#D08BA0` | `#F4EFF1` |

**Estética e spa — personalidade Clean**

| Nome | Base | Fundo | Superfície | Elevado | Acento | Texto |
| --- | --- | --- | --- | --- | --- | --- |
| Sereno | clara | `#F4F8F6` | `#FFFFFF` | `#EAF1ED` | `#2F6B54` | `#1B2A24` / `#6F847A` |
| Areia | clara | `#F8F5F1` | `#FFFFFF` | `#F0EAE3` | `#A2603C` | `#2A231D` |
| Clínico | clara | `#F4F6F9` | `#FFFFFF` | `#E9EEF4` | `#1F5C73` | `#16202A` |

As cores de status são as mesmas em todos, e mudam só entre base clara e
escura: pago `#2E7256` / `#7FB08A`; a confirmar `#9A5B16` / `#D9954B`;
a pagar, neutro do tema.

## Quanta liberdade o salão tem

Decidido com o Leonardo em 25/09/2026:

1. **Nicho** (escolhido no cadastro) **sugere o tema inicial** — o salão abre o
   sistema já com a cara dele, sem passar por tela de escolha.
2. **Tema**: escolhe entre os nove. Os três do nicho dele aparecem primeiro e
   maiores; os outros seis ficam abaixo, menores, sob "Outros estilos". Nada
   impede usar o tema de outro nicho.
3. **Acento**: paleta curada de ~7 cores por tema, visível. O seletor de cor
   livre fica atrás do botão **"Usar a cor da minha marca"** — a maioria nunca
   abre; quem tem identidade própria consegue.
4. **O acento não muda fundo nem superfície.** É o que impede uma combinação
   ilegível. O rótulo na tela diz isso em voz alta.
5. Toda cor escolhida passa por `ThemeManager.escurecerAteLer()`, que já existe
   e ajusta o tom até alcançar contraste de leitura preservando o matiz.
6. Tema alterado no acento se chama **"Oldschool (personalizado)"**, com um
   botão "Voltar ao padrão".

**O link público herda o tema** (cor e personalidade): é a cara do salão para o
cliente final. Isso exige `get_public_salon` devolver o tema — o comentário no
fim de `supabase/migrations/06_rpcs_publicas.sql` já previa esse pedido.

## O que muda no layout, além da cor

Vale para todos os temas; consertar uma vez melhora as nove aparências.

1. **Hierarquia**: o número é a razão da tela existir. Rótulo em 10px maiúsculo
   acima, número em 32px, e uma referência ao lado ("14 · de 18 vagas") — 14
   sozinho não diz se o dia foi bom.
2. **Cor com significado**: hoje os quatro ícones dos indicadores usam azul,
   azul, verde e vermelho sem critério, gastando o verde e o vermelho que
   significam pago e atrasado no resto do sistema. Cor só onde carrega sentido.
3. **Densidade**: o card "Próximos Atendimentos" ocupa 40% da tela para dizer
   que não há nada. No mesmo espaço cabem sete atendimentos com cliente,
   serviço, profissional, valor e situação. Quem usa está em pé, entre dois
   clientes.
4. **Ações repetidas**: "Chegou agora" e "Novo Agendamento" no cabeçalho, e
   "Chegou agora" e "Agendar Horário" logo abaixo na Agenda. Fica um par só.
5. **Contraste**: rótulos como "Agendamentos Hoje" ficam em ~3,1:1. Todo tema
   novo passa pelo teste de contraste antes de entrar, como foi feito com o
   claro e o escuro.
6. **Na Agenda a barra lateral recolhe para 60px** (só ícones): ali cada pixel
   é coluna de profissional. E as vagas livres viram convite ("livre · 14:30"),
   não buraco mudo.

## Por onde começar a implementar

1. **Uma base nova** com os defeitos de layout resolvidos, num tema só.
2. **As três personalidades** sobre essa base (fonte, raio, densidade).
3. **Os nove acentos**, cada um validado por teste de contraste.
4. **Migração**: `business_info` precisa de `theme_personalidade` e
   `theme_acento` além do `theme` que já existe (hoje só guarda claro/escuro).
   Aproveitar para pôr `primary_color` e `business_type` na `allowedCols` do
   `api.js` — **as duas colunas existem no banco mas o painel nunca as envia**,
   então a cor e o nicho configurados na tela não persistem hoje.
5. **`get_public_salon`** devolvendo o tema.
6. **A landing refeita** na mesma linguagem. Combinar antes com o Gemini, que
   trabalhou nela por último.
