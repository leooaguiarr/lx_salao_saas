# Alabama Barbearia — Sistema de Gestão e Agendamento

## Documento completo de funcionalidades

**Versão documentada:** 1.5.0  
**Tipo de sistema:** aplicação web responsiva para barbearias e salões  
**Acesso público:** [alabamabarbearia.com.br](https://alabamabarbearia.com.br)  
**Desenvolvimento:** Lexion Consultoria

---

## 1. Visão geral

O sistema da Alabama Barbearia reúne, em um único ambiente, as principais atividades necessárias para administrar a rotina do estabelecimento. Ele permite organizar a agenda, cadastrar clientes, controlar profissionais, acompanhar comissões, registrar receitas e despesas, abrir e fechar o caixa, controlar produtos e estoque e oferecer agendamento on-line ao cliente final.

O painel administrativo foi projetado para funcionar tanto no computador quanto no celular. Já o cliente da barbearia utiliza um link público de agendamento, sem precisar criar uma conta ou instalar aplicativo.

### Principais objetivos

- Centralizar a operação diária da barbearia.
- Reduzir conflitos e espaços ociosos na agenda.
- Facilitar o agendamento pelo próprio cliente.
- Acompanhar atendimentos, pagamentos e comissões.
- Controlar entradas, saídas e saldo em caixa.
- Organizar vendas de produtos e movimentações de estoque.
- Melhorar o relacionamento e a recorrência dos clientes.
- Oferecer informações rápidas para tomada de decisão.

---

## 2. Perfis de uso

### Proprietário ou administrador

Possui a visão geral do estabelecimento e pode administrar agenda, clientes, profissionais, serviços, estoque, caixa, dados financeiros e configurações.

### Profissional ou barbeiro

Pode possuir acesso individual vinculado ao próprio cadastro profissional. Esse perfil permite consultar sua agenda e suas informações de comissão, respeitando as restrições definidas para a equipe e sem liberar as configurações administrativas do estabelecimento.

### Cliente final

Acessa o link público sem login para consultar serviços, escolher profissional, selecionar data e horário, realizar o agendamento e acompanhar sua posição na fila.

---

## 3. Dashboard — visão rápida da operação

O Dashboard apresenta os dados mais importantes do dia em uma tela resumida.

### Indicadores principais

- Quantidade de agendamentos do dia.
- Previsão financeira dos atendimentos agendados.
- Valor efetivamente recebido no dia.
- Quantidade de clientes que estão no período de retorno.

### Acompanhamento da rotina

- Lista dos próximos atendimentos.
- Diferenciação visual entre compromissos de hoje e futuros.
- Acesso rápido aos dados e ações de cada atendimento.
- Painel de pagamentos que ainda precisam ser confirmados.

### Relacionamento com clientes

- Recomendações de clientes que estão há mais tempo sem retornar.
- Atalho para a lista completa de clientes atrasados.
- Painel de próximos aniversariantes.
- Envio de mensagem de aniversário por WhatsApp.

### Alertas de estoque

- Painel automático de produtos que chegaram à quantidade mínima.
- O alerta aparece apenas quando existe algum item que precisa de atenção.
- Atalho direto para a área de Estoque.
- Contador de itens em nível mínimo no menu principal.

---

## 4. Agenda e gestão de atendimentos

A Agenda organiza os horários da barbearia e distribui os atendimentos entre os profissionais.

### Visualizações disponíveis

- Agenda diária.
- Agenda semanal.
- Agenda mensal.
- Navegação entre datas anteriores e futuras.
- Colunas individuais por profissional na visualização diária.
- Seletor de profissional adaptado para celular.

### Cadastro e edição de agendamentos

- Criação manual de um novo agendamento.
- Seleção de cliente, serviço, profissional, data e horário.
- Cadastro rápido de um novo cliente durante o agendamento.
- Edição de atendimentos já existentes.
- Preservação do vínculo histórico mesmo quando um cliente, serviço ou profissional antigo tiver sido excluído.
- Aviso ao operador quando um horário manual estiver fora do expediente ou durante uma indisponibilidade.
- Possibilidade de o operador confirmar e salvar o horário excepcional mesmo após o aviso.

### Situações do atendimento

O atendimento pode ser acompanhado por estados como:

- Agendado.
- Confirmado.
- Aguardando.
- Em atendimento.
- Concluído.
- Faltou.
- Cancelado.

Essas situações influenciam a agenda, a fila pública, as pendências de pagamento e os cálculos financeiros.

### Pagamento do atendimento

- Confirmação do pagamento diretamente pelo atendimento.
- Registro da forma de pagamento.
- Marcação de atendimento como cortesia.
- Identificação de pagamentos pendentes.
- Possibilidade de adicionar produtos consumidos ou comprados durante o atendimento.
- Criação de lançamentos financeiros separados para serviço e produto.
- Baixa automática dos produtos selecionados no estoque.

---

## 5. Encaixe — “Chegou agora”

O recurso “Chegou agora” atende clientes que chegam à barbearia sem horário marcado.

### Funcionamento

- Solicita serviço, nome e WhatsApp do cliente.
- Procura automaticamente o primeiro horário livre do dia.
- Considera todos os profissionais ativos.
- Seleciona o profissional que ficará disponível primeiro.
- Respeita duração do serviço, horário de funcionamento, horários ocupados e indisponibilidades.
- Não exige a antecedência de duas horas aplicada ao link público, pois o cliente já está no estabelecimento.
- Reaproveita o cadastro quando o WhatsApp informado já pertence a um cliente.
- Evita duplicidade de clientes e preserva o histórico de relacionamento.

### Após o encaixe

- O atendimento entra imediatamente como confirmado e com pagamento pendente.
- O horário passa a ficar ocupado na agenda e deixa de aparecer no agendamento público.
- O sistema informa o horário e o profissional escolhidos.
- É disponibilizado um botão para contato pelo WhatsApp.
- O cliente pode acompanhar sua vez por meio do link público da barbearia.

---

## 6. Fila de atendimento para o cliente

O cliente pode consultar sua posição usando o mesmo link público da barbearia.

### Recursos da fila

- Identificação pelo número de WhatsApp.
- Exibição da posição do cliente na fila.
- Informação de horário e profissional.
- Atualização conforme o profissional avança o atendimento entre aguardando, em atendimento e concluído.
- Mensagens como “Você é o próximo”, conforme a situação.
- Proteção da privacidade: nomes e telefones de outros clientes nunca são exibidos.
- Exibição da vitrine de produtos enquanto o cliente espera.

---

## 7. Link público de agendamento

Cada estabelecimento possui um endereço público próprio, que pode ser divulgado pelo WhatsApp, Instagram, site ou outros canais.

### Experiência do cliente

- Acesso sem login e sem instalação de aplicativo.
- Interface otimizada para celular.
- Exibição da identidade visual e dos dados da barbearia.
- Escolha do serviço desejado.
- Escolha do profissional.
- Seleção de data.
- Consulta dos horários realmente disponíveis.
- Preenchimento dos dados necessários do cliente.
- Confirmação do agendamento.
- Entrada do novo horário na agenda administrativa em tempo real.
- Tela final simples, confirmando que o horário foi reservado.

### Regras automáticas de disponibilidade

- Considera o horário de funcionamento de cada dia da semana.
- Não oferece horários em dias marcados como fechados.
- Considera a duração completa do serviço.
- Impede que um atendimento ultrapasse o horário de fechamento.
- Oculta horários já ocupados.
- Respeita folgas e bloqueios parciais ou integrais dos profissionais.
- Exibe apenas profissionais e serviços ativos.
- Exige duas horas de antecedência para novos agendamentos públicos.
- Valida as regras também no servidor, evitando reservas inválidas por manipulação da página.
- Impede agendamentos duplicados ou conflitantes.

### Validações e proteção de dados

- Verificação de cliente já cadastrado.
- Limitação de agendamentos repetidos conforme as regras da operação.
- Mensagens de erro apresentadas dentro da própria página pública.
- Exposição somente das informações necessárias para o agendamento.
- Nenhum dado da carteira de clientes é disponibilizado publicamente.
- Motivos de indisponibilidade dos profissionais permanecem privados.

### Simulador administrativo

- Prévia, dentro do painel, da experiência que o cliente terá no celular.
- Botão para copiar o endereço público.
- Mensagem pronta para divulgação no WhatsApp.
- Reinício da simulação por um controle próprio, sem incentivar o cliente final a criar agendamentos repetidos.

---

## 8. Cadastro e relacionamento com clientes

O módulo de Clientes funciona como uma visão de relacionamento e histórico.

### Cadastro do cliente

- Nome.
- Número de WhatsApp.
- Data de nascimento.
- Frequência estimada de retorno.
- Observações sobre preferências, serviços ou atendimentos anteriores.

### Consulta e organização

- Busca por nome ou WhatsApp.
- Filtro por clientes recorrentes.
- Filtro por clientes novos.
- Filtro por clientes atrasados ou “sumidos”.
- Exibição da frequência de retorno.
- Data do último atendimento.
- Situação do retorno.
- Total gasto pelo cliente.

### Visão “Cliente 360°”

- Resumo do relacionamento com o cliente.
- Histórico de atendimentos.
- Dados de frequência e recorrência.
- Total gasto.
- Observações cadastradas.
- Atalho para criar um novo agendamento.
- Ações de contato pelo WhatsApp.

### Frequência e recuperação de clientes

- Cálculo da frequência média com base no histórico quando existem visitas suficientes.
- Uso da frequência configurada manualmente enquanto ainda não há histórico adequado.
- Identificação automática de clientes que ultrapassaram o período esperado de retorno.
- Recomendações no Dashboard para recuperar clientes afastados.
- Mensagem de retorno personalizável com preenchimento automático de informações.

### Aniversariantes

- Lista dos próximos aniversários.
- Mensagem de parabéns personalizável.
- Uso automático do primeiro nome, nome do estabelecimento e link de agendamento.
- Envio pelo WhatsApp a partir do painel.

---

## 9. Gestão de serviços

### Recursos

- Cadastro de serviços oferecidos.
- Definição do nome e descrição.
- Definição do preço.
- Definição da duração em minutos.
- Ativação ou desativação do serviço.
- Controle da visibilidade no link público.
- Edição e exclusão de serviços.

A duração cadastrada é utilizada para calcular a ocupação real da agenda e os horários disponíveis no link público.

---

## 10. Gestão de profissionais

### Cadastro e administração

- Nome do profissional.
- Foto de perfil.
- Percentual de comissão.
- Ativação ou desativação.
- Agenda individual.
- Histórico preservado quando o profissional é desativado.
- Remoção automática do profissional inativo das novas opções de agendamento.

### Disponibilidade individual

- Cadastro de folgas de dia inteiro.
- Bloqueio de faixas específicas de horário.
- Registro de um motivo interno para o bloqueio.
- Listagem e exclusão das indisponibilidades cadastradas.
- Aplicação dos bloqueios na agenda pública e no encaixe automático.
- O cliente não vê o motivo informado.

### Comissões

- Cálculo com base no percentual de cada profissional.
- Comissão diária.
- Projeção mensal.
- Filtro financeiro por profissional.
- Inclusão nos extratos em PDF.
- Comissão calculada somente sobre serviços pagos.
- Produtos vendidos ficam fora do cálculo de comissão.

---

## 11. Financeiro

O módulo Financeiro consolida o faturamento dos serviços, vendas de produtos, despesas, comissões e movimentações do caixa.

### Filtros e indicadores

- Período de hoje.
- Últimos sete dias.
- Últimos trinta dias.
- Filtro geral ou por profissional.
- Total de entradas.
- Total de saídas.
- Saldo ou lucro líquido.
- Projeção de faturamento do dia.
- Gastos do dia.
- Comissão diária por profissional.
- Projeção mensal de comissão.
- Quantidade de agendamentos do profissional.

### Lançamentos financeiros

- Registro manual de entradas.
- Registro manual de saídas e despesas.
- Categorias de movimentação.
- Descrição do lançamento.
- Forma de pagamento.
- Associação opcional a um profissional.
- Histórico completo de transações.
- Exclusão de lançamentos quando permitido.
- Identificação de lançamentos pendentes.

### Formas de pagamento

- Registro da forma utilizada em cada transação.
- Resumo dos valores por método de pagamento.
- Separação do dinheiro físico para cálculo do saldo em gaveta.

### Análises

- Histórico de movimentações.
- Faturamento por serviço.
- Distribuição por método de pagamento.
- Comparação de entradas, saídas e resultado líquido.
- Análise geral ou individual por profissional.

### Data do serviço e data do recebimento

O sistema diferencia duas informações:

- **Data de competência:** quando o atendimento aconteceu, usada no faturamento e nos relatórios por período.
- **Data do movimento de caixa:** quando o dinheiro efetivamente entrou ou saiu, usada no saldo da gaveta e no fechamento.

Assim, um atendimento realizado ontem e pago hoje aparece corretamente no faturamento de ontem e no movimento de caixa de hoje.

---

## 12. Caixa do dia

### Abertura

- Abertura do caixa no início do expediente.
- Registro do valor inicial de troco.
- Indicação visual de caixa aberto ou fechado.
- Cálculo contínuo do saldo em gaveta.

### Operação

- Entradas e saídas em dinheiro vinculadas à sessão do caixa.
- Recebimentos em dinheiro feitos com o caixa fechado ficam pendentes para não apresentar um saldo físico incorreto.
- Acompanhamento de faturamento, despesas e saldo.

### Fechamento

- Fechamento da sessão diária.
- Bloqueio do fechamento quando existem atendimentos já realizados e ainda sem pagamento definido.
- Lista das pendências que precisam ser resolvidas.
- Possibilidade de resolver a pendência confirmando o pagamento ou marcando o atendimento como cortesia, falta ou cancelamento.
- Atendimentos futuros não bloqueiam o fechamento.
- Geração automática do extrato da sessão ao fechar o caixa.

---

## 13. Relatórios e extratos em PDF

### Extrato do dia

- Situação e saldo do caixa.
- Movimentações desde o último extrato emitido.
- Entradas e saídas da janela correspondente.
- Comissões separadas por profissional.
- Geração automática no fechamento do caixa.
- No fechamento, o relatório cobre toda a sessão, da abertura ao encerramento.

### Extrato por período

- Geração para hoje, sete dias ou trinta dias.
- Respeito ao profissional selecionado no filtro.
- Visão geral com comissão e valor líquido do estabelecimento por profissional.
- Visão detalhada dos atendimentos quando um profissional específico é escolhido.
- Nome de arquivo com período, profissional, estabelecimento, data e horário para evitar substituição acidental.

### Consistência dos valores

- Os PDFs utilizam as mesmas regras de cálculo exibidas na tela.
- Pagamentos pendentes não entram em faturamento, gastos ou lucro realizados.
- Comissões são calculadas somente sobre serviços efetivamente pagos.

---

## 14. Produtos e estoque

### Cadastro de produtos

- Nome do produto.
- Categoria.
- Preço de custo.
- Preço de venda.
- Quantidade inicial.
- Quantidade mínima para alerta de reposição.
- Foto otimizada para exibição no celular.
- Ativação ou desativação.
- Controle de visibilidade na vitrine pública.

### Controle de saldo

- Entrada de mercadoria.
- Saída de produto.
- Venda.
- Compra ou reposição.
- Uso interno.
- Perda, quebra ou vencimento.
- Acerto de inventário.
- Registro obrigatório do motivo da movimentação.
- Histórico com data, quantidade, motivo e vínculos relacionados.
- O estoque nunca fica negativo; quando a saída ultrapassa o saldo registrado, o sistema zera o item.

### Rastreabilidade

- Toda alteração de quantidade passa por uma movimentação registrada.
- A edição do cadastro não permite sobrescrever silenciosamente o saldo de um produto existente.
- Operações simultâneas somam ou subtraem quantidades sem uma venda apagar a outra.
- Possibilidade de identificar o profissional que realizou a venda.
- Campo opcional para informar o cliente que comprou.

### Integração com o Financeiro

- Venda de produto registrada como entrada financeira.
- Compra de mercadoria pode gerar uma saída financeira automaticamente.
- O operador pode escolher quando uma movimentação de estoque deve ou não afetar o caixa.
- Venda feita junto do atendimento gera dois lançamentos: um de serviço e outro de produto.
- Produtos não entram no cálculo da comissão do serviço.

### Formas de registrar uma venda

- Durante a confirmação do pagamento de um atendimento.
- Em **Estoque → Saída → Venda**.
- Em **Financeiro → Entrada → Venda de Produto**.

Todos os caminhos utilizam a mesma regra de movimentação e mantêm estoque e financeiro sincronizados.

### Vitrine pública

- Exibição de produtos ativos e disponíveis no link público.
- Apresentação de foto, nome, categoria e preço.
- Produto esgotado deixa de aparecer.
- A quantidade em estoque nunca é mostrada ao público.
- A vitrine pode aparecer na fila e na tela de sucesso do agendamento.

---

## 15. Configurações do estabelecimento

### Identidade e contato

- Nome da barbearia.
- Foto de perfil ou logomarca.
- Endereço completo.
- WhatsApp para contato.
- Perfil do Instagram.
- Endereço personalizado do link público por meio de um slug.

### Horário de funcionamento

- Configuração individual para cada dia da semana.
- Definição dos horários de abertura e fechamento.
- Marcação de dias fechados.
- Aplicação automática na grade pública.
- Validação de que o serviço inteiro termina antes do fechamento.

### Mensagens personalizáveis de WhatsApp

- Mensagem de retorno para clientes afastados.
- Mensagem de divulgação do link de agendamento.
- Mensagem de aniversário.
- Tags automáticas como `{nome}`, `{dia}`, `{salao}` e `{link}`.
- Geração do link a partir do domínio real do sistema, inclusive quando houver domínio próprio.

---

## 16. Integração com WhatsApp

O sistema prepara mensagens e abre a conversa no WhatsApp, reduzindo o trabalho de copiar dados manualmente.

### Usos disponíveis

- Divulgação do link público de agendamento.
- Recuperação de clientes que estão atrasados para retornar.
- Mensagens de aniversário.
- Contato após um encaixe.
- Contato a partir do cadastro ou histórico do cliente.

### Personalização automática

- Primeiro nome do cliente.
- Dia da semana.
- Nome da barbearia.
- Link público correto do estabelecimento.

---

## 17. Guia rápido e suporte

O sistema possui um guia de ajuda integrado, aberto pelo botão de interrogação no rodapé da barra lateral.

### Conteúdo do guia

- Sequência de primeiros passos para configurar e começar a usar o sistema.
- Dúvidas frequentes sobre agenda e atendimento.
- Dúvidas sobre dinheiro e caixa.
- Orientações sobre produtos e estoque.
- Instruções para o link público.
- Informações sobre acesso e recuperação de senha.

### Busca e suporte

- Pesquisa por palavras em títulos e respostas completas.
- Resultados organizados por assunto.
- Contato direto com o suporte da Lexion Consultoria pelo WhatsApp.

---

## 18. Login, acesso e recuperação de senha

### Autenticação

- Entrada por e-mail e senha.
- Sessão autenticada para o painel administrativo.
- Separação dos dados por estabelecimento.
- Suporte a múltiplos usuários vinculados à mesma barbearia.
- Perfis de proprietário e profissional.

### Recuperação de senha

- Link “Esqueceu a senha?” na tela de entrada.
- Solicitação de recuperação por e-mail.
- Criação de uma nova senha por meio de link seguro.
- Saída automática após a troca, permitindo testar a nova senha em um novo login.
- Mensagens que não revelam se determinado e-mail está ou não cadastrado.

---

## 19. Segurança, privacidade e continuidade

### Proteção dos dados

- Dados armazenados na nuvem.
- Isolamento das informações por estabelecimento.
- Controle de acesso aplicado também no banco de dados.
- Funções públicas limitadas somente ao necessário para agendamento, fila e vitrine.
- Clientes públicos não recebem acesso à lista de clientes, dados financeiros ou informações internas.
- Quantidades de estoque e motivos de indisponibilidade não são expostos.

### Continuidade em falhas de conexão

- O aparelho mantém uma cópia local dos dados já carregados.
- Se ocorrer uma falha temporária de sessão, o sistema tenta renovar o acesso e buscar os dados novamente.
- Caso a nuvem continue indisponível, o sistema apresenta os últimos dados locais em vez de exibir listas vazias.
- O usuário recebe uma orientação clara para sair, entrar novamente e conferir a data e hora do aparelho.

### Privacidade

- Aviso de privacidade dentro do sistema.
- Uso dos dados limitado à organização da agenda, atendimento, relacionamento e pagamentos.
- Possibilidade de o cliente solicitar correção, atualização ou exclusão de seus dados diretamente ao estabelecimento.

---

## 20. Experiência em celular

- Interface responsiva para computador e smartphone.
- Menu lateral adaptado para telas pequenas.
- Agenda com troca de profissional própria para celular.
- Modais com rolagem e botões acessíveis mesmo com as barras do navegador móvel.
- Link público desenvolvido prioritariamente para uso no celular.
- Uso de altura dinâmica da tela para evitar que ações importantes fiquem escondidas.
- Prévia administrativa que reproduz a experiência do cliente no smartphone.

---

## 21. Funcionamento técnico resumido

- Aplicação web sem necessidade de instalação.
- Front-end em HTML, CSS e JavaScript.
- Banco de dados, autenticação e regras de segurança no Supabase.
- Hospedagem como site estático na Vercel.
- Atualização automática da produção após publicação aprovada no repositório principal.
- Rotas públicas personalizadas para cada estabelecimento.
- Funcionamento sem etapa de build, mantendo a publicação leve e direta.

---

## 22. Funcionalidades atualmente pausadas

Os seguintes módulos possuem estruturas ou código no projeto, mas estão ocultos da navegação e não devem ser apresentados como recursos ativos nesta versão:

- Central de mensagens e automações.
- Kanban de leads e conversão comercial.

Esses módulos poderão ser retomados futuramente, após definição das regras de uso, validação e liberação formal.

---

## 23. Diferenciais do sistema

- Agendamento público sem cadastro ou aplicativo.
- Agenda, clientes, financeiro, caixa e estoque integrados.
- Encaixe automático para quem chega sem horário.
- Fila pública com privacidade dos demais clientes.
- Disponibilidade calculada pela duração real de cada serviço.
- Controle de folgas e bloqueios por profissional.
- Separação correta entre faturamento do serviço e venda de produto.
- Comissão aplicada somente ao serviço.
- Dupla leitura de data: competência do atendimento e movimento real do caixa.
- Fechamento protegido contra pagamentos esquecidos.
- PDFs coerentes com os números apresentados na tela.
- Alertas automáticos de retorno, aniversário e estoque mínimo.
- Mensagens personalizáveis para WhatsApp.
- Vitrine pública sem exposição do saldo interno de estoque.
- Acesso individual por profissional e separação segura dos dados.
- Cópia local para reduzir o impacto de falhas temporárias de conexão.
- Guia de ajuda integrado ao próprio sistema.

---

## 24. Resumo final

O sistema da Alabama Barbearia cobre o ciclo completo da operação:

1. O estabelecimento configura serviços, equipe, horários, produtos e identidade visual.
2. O cliente agenda sozinho pelo link público ou é incluído pelo operador.
3. Quem chega sem horário pode ser encaixado automaticamente.
4. A equipe acompanha a agenda e atualiza o andamento dos atendimentos.
5. O cliente acompanha sua posição na fila sem visualizar dados de terceiros.
6. O pagamento alimenta o Financeiro e calcula a comissão do profissional.
7. Produtos vendidos baixam do estoque e geram lançamentos separados.
8. Entradas, despesas e dinheiro físico compõem o caixa do dia.
9. O fechamento verifica pendências e gera um extrato em PDF.
10. O Dashboard reúne agenda, faturamento, retornos, aniversários e alertas de reposição.

O resultado é uma plataforma integrada para organizar o atendimento, reduzir tarefas manuais, melhorar o relacionamento com os clientes e dar ao proprietário uma visão clara da operação da barbearia.

---

<sub>Documento preparado a partir das funcionalidades implementadas e ativas na versão 1.5.0 do sistema Alabama Barbearia.</sub>
