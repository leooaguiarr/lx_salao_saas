# Plano de Implementação - Fotos dos Profissionais

Este plano visa adicionar a capacidade de cadastrar e exibir a foto de cada profissional. A foto será exibida tanto no painel administrativo quanto no fluxo de agendamento do cliente (link público).

---

## Modificações Propostas

### 1. Banco de Dados & Scripts Supabase

Precisamos adicionar o campo `"photoUrl"` na tabela de profissionais e atualizar a função RPC que fornece os dados para a página pública.

#### [NEW] [update_professionals_photo.sql](file:///c:/Users/44209076813/Documents/Antigravity/dashboard_salao/docs/update_professionals_photo.sql)
- Criação de script SQL de migração para o usuário executar no SQL Editor do Supabase:
  - Adiciona a coluna `"photoUrl"` na tabela `professionals`.
  - Recria a função `get_public_salon` para expor o campo `"photoUrl"` no JSON retornado.

#### [MODIFY] [supabase_setup.sql](file:///c:/Users/44209076813/Documents/Antigravity/dashboard_salao/docs/supabase_setup.sql)
- Adição da coluna `"photoUrl" TEXT` na tabela `professionals` para que novas instalações já iniciem com essa coluna.

#### [MODIFY] [public_booking_setup.sql](file:///c:/Users/44209076813/Documents/Antigravity/dashboard_salao/public_booking_setup.sql)
- Atualização da função `get_public_salon` para incluir `'photoUrl', p."photoUrl"` no objeto JSON retornado para o client-side.

---

### 2. Interface de Configuração (Administrativo)

Permite ao administrador cadastrar e editar o link da foto de cada profissional.

#### [MODIFY] [public/index.html](file:///c:/Users/44209076813/Documents/Antigravity/dashboard_salao/public/index.html)
- Inclusão do campo de input `prof-photo-url` no modal de profissional (`modal-professional`):
  ```html
  <div class="form-group">
      <label for="prof-photo-url">URL da Foto</label>
      <input type="text" id="prof-photo-url" class="form-control" placeholder="Ex: /assets/carlos_barber.png ou https://...">
  </div>
  ```

#### [MODIFY] [public/app.js](file:///c:/Users/44209076813/Documents/Antigravity/dashboard_salao/public/app.js)
- **Dados Iniciais (Mock):** Adição de URLs de fotos reais (`/assets/carlos_barber.png` e `/assets/felipe_barber.png`) para os profissionais Carlos e Felipe que vêm como dados de exemplo.
- **Abertura do Modal:** Populagem do campo `prof-photo-url` no `openEditProfessional(id)`.
- **Salvamento:** Captura e gravação do valor do campo `prof-photo-url` na submissão do formulário.
- **Renderização no Painel:** Ajuste na função `renderConfig()` para desenhar o avatar circular do profissional na lista de profissionais ativos nas Configurações.

---

### 3. Tela de Agendamento do Cliente (Página Pública)

Exibe a foto do profissional no fluxo de agendamento móvel.

#### [MODIFY] [public/app.js](file:///c:/Users/44209076813/Documents/Antigravity/dashboard_salao/public/app.js)
- **Passo 2 (Seleção do Profissional):** Na renderização da tela de escolha do profissional (`renderPhoneScreen`), substitui o ícone genérico (`fa-user`) pela imagem real (`<img>`) do profissional se a propriedade `photoUrl` estiver presente e populada.
- Adiciona um visualizador de placeholder caso não haja foto cadastrada.

---

## Plano de Verificação

### Teste Manual local
1. Abra a aba de Configurações -> Profissionais.
2. Cadastre uma foto ou valide que as fotos padrões do Carlos e do Felipe aparecem corretamente como avatares circulares ao lado de seus nomes.
3. Clique em "Visualizar Link de Agendamento" ou simule a tela do celular do cliente.
4. No Passo 2 de escolha do profissional, verifique que aparecem os cartões contendo a foto redonda de cada barbeiro e seus respectivos nomes.
5. Selecione um profissional com foto, avance e conclua um agendamento fictício.
