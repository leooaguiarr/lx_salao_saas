# Instruções para agentes de IA — comece por aqui

Esta pasta é o **único lugar** com o que um agente precisa saber para mexer no
Lexion Salão sem quebrar nada. O trabalho acontece em mais de uma máquina e em
várias conversas; tudo que não dá para deduzir lendo o código está aqui.

**Responda sempre em português do Brasil.**

## Ordem de leitura

| Arquivo | Quando ler |
| --- | --- |
| [01_PRODUTO_E_ESTADO.md](01_PRODUTO_E_ESTADO.md) | Sempre. O que é o sistema, o que está no ar, o que falta, os riscos abertos e o **checklist de lançamento** (Asaas de volta para produção e limpeza do banco). |
| [02_ARQUITETURA.md](02_ARQUITETURA.md) | Sempre, antes de editar código. Arquivos, fluxo de dados, rotas, papéis e planos. |
| [03_BANCO_DE_DADOS.md](03_BANCO_DE_DADOS.md) | Antes de tocar em tabela, coluna, RLS, RPC ou em qualquer `save`/`upsert`. |
| [04_COMO_TRABALHAR.md](04_COMO_TRABALHAR.md) | Sempre. Rodar, testar, publicar, commit e estilo de código. |
| [05_ARMADILHAS.md](05_ARMADILHAS.md) | Sempre. Cada item já custou horas; leia antes de repetir. |
| [06_HISTORICO.md](06_HISTORICO.md) | Para entender por que algo é do jeito que é. |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | Referência de tudo que o sistema faz, na visão do usuário. |
| [DESIGN_E_TEMAS.md](DESIGN_E_TEMAS.md) | **Antes de mexer em cor, fonte, espaçamento ou layout**, no painel ou na landing. Traz a direção aprovada em 25/09/2026, os nove temas com os valores exatos e o que muda no layout. Ainda não implementado. |
| [APP_CELULAR.md](APP_CELULAR.md) | Ao mexer em PWA, service worker, manifest ou layout do celular. |
| [legado/AGENT_HANDOFF_ALABAMA.md](legado/AGENT_HANDOFF_ALABAMA.md) | Consulta. O diário do sistema de origem, com o porquê de muitas regras de negócio. |

Ferramentas de verificação (Chrome headless, sem dependências) estão em
[ferramentas/](ferramentas/).

Os arquivos `CLAUDE.md`, `AGENTS.md` e `GEMINI.md` da raiz só apontam para
cá — cada ferramenta de IA procura um nome diferente. Não coloque conteúdo
neles; escreva nesta pasta.

## As cinco regras de ouro

1. **Push na `main` é deploy em produção.** O Coolify publica sozinho a cada
   push, e há salões usando o sistema. Teste local primeiro, mostre ao Leonardo
   e só publique com o aval dele.
2. **O banco local é o banco de produção.** Não existe Supabase de teste: o
   `localhost` fala com o mesmo banco dos clientes. Testar localmente protege o
   código, não os dados. Nada de cadastro, exclusão ou agendamento "de teste"
   logado num salão real.
3. **Mudou arquivo em `public/`? Suba o `?v=` de todas as tags do
   `index.html`** (todas juntas, mesmo número). Sem isso o navegador serve o
   arquivo velho e o trabalho "não aparece".
4. **SQL novo não roda sozinho.** Não há acesso direto ao banco: o SQL é colado
   à mão no Supabase Studio. Código que depende de coluna ou função nova só pode
   ir ao ar junto com a migração aplicada — senão a funcionalidade falha em
   silêncio (ver [05_ARMADILHAS.md](05_ARMADILHAS.md)).
5. **Comente o porquê, não o quê.** O código é todo comentado em português
   explicando a decisão. Siga o mesmo padrão e não apague comentários que
   explicam uma armadilha.

## Ao terminar uma sessão

Se a sessão mudou algo relevante, **atualize esta pasta antes do commit final**:

- [01_PRODUTO_E_ESTADO.md](01_PRODUTO_E_ESTADO.md): estado atual, próximos
  passos e riscos.
- [06_HISTORICO.md](06_HISTORICO.md): uma linha com a data e o que mudou.
- [05_ARMADILHAS.md](05_ARMADILHAS.md): toda armadilha nova que custou tempo.
- [FUNCIONALIDADES.md](FUNCIONALIDADES.md): se o usuário ganhou ou perdeu algo.

Documentação desatualizada é pior que nenhuma: o próximo agente confia nela.
