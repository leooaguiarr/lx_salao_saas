-- ============================================================
-- MENSAGENS EDITAVEIS: COBRANCA DE PARCELA E AVISO DE FIDELIDADE
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTE SCRIPT FAZ
--
-- Duas mensagens que ate agora estavam escritas no meio do codigo passam a
-- ser configuraveis pelo dono, na aba Configuracoes:
--
--   COBRANCA     — o texto que sai no botao de WhatsApp da parcela do
--                  crediario (Dashboard e aba Crediario). Ate a Fase G ele
--                  era uma string fixa em `26-crediario.js`: o dono nao tinha
--                  como mudar o tom, nem incluir a chave PIX do salao.
--   FIDELIDADE   — o aviso de que o cliente bateu a meta e ja pode resgatar o
--                  beneficio. Nao existia: a tela mostrava "Beneficio
--                  disponivel" e o balcao tinha que lembrar de avisar.
--
-- POR QUE CADA UMA MORA NUMA TABELA DIFERENTE
--
-- A de cobranca vai para `business_info`, junto das outras tres mensagens de
-- WhatsApp do salao (retorno, agendamento, aniversario) — mesmo lugar, mesma
-- convencao de nome em camelCase entre aspas.
--
-- A de fidelidade vai para `loyalty_programs`, porque ela fala do CLUBE: cita
-- a meta e o beneficio, que sao campos daquela mesma linha. Se o dono desliga
-- o programa ou muda o beneficio, o texto que acompanha esta ao lado do que
-- mudou, e nao numa tabela separada onde ninguem lembraria de revisar.
--
-- POR QUE AS DUAS SAO NULLABLE, E NAO `NOT NULL DEFAULT`
--
-- Esta e a licao que o `loyaltyEnrolled` da Fase F cobrou caro. O
-- `DataService.save()` grava estas tabelas por upsert do objeto/array inteiro,
-- e o PostgREST NAO aplica o DEFAULT da coluna quando a chave chega ausente
-- num lote em que outra linha a tem — ele grava `null` explicito, e um
-- `NOT NULL` transforma isso em erro de gravacao no meio de uma operacao que
-- nao tem nada a ver com mensagem nenhuma.
--
-- Coluna nullable + texto padrao no JS (o mesmo padrao ja usado por
-- `whatsappBirthdayMessage` e por `MSG_ANIVERSARIO_PADRAO`) nao tem essa
-- armadilha: `null` aqui significa "o dono nunca editou", e a tela mostra o
-- modelo de fabrica.

-- ------------------------------------------------------------
-- 1. Mensagem de cobranca de parcela do crediario
-- ------------------------------------------------------------
-- Tags resolvidas pelo front (aplicarTagsWhatsApp, em `06-clientes.js`):
--   {nome} {salao} {link} — as de sempre, valem em qualquer mensagem
--   {parcela} {valor} {vencimento} — especificas desta
ALTER TABLE public.business_info
    ADD COLUMN IF NOT EXISTS "whatsappChargeMessage" text;

COMMENT ON COLUMN public.business_info."whatsappChargeMessage" IS
    'Modelo da cobranca de parcela por WhatsApp. NULL = usa o padrao do front.';

-- ⚠️ Ao criar um campo novo em business_info, some a coluna aqui E na lista
-- `allowedCols` de `public/api.js`. Coluna que nao esta na lista vira campo so
-- de localStorage: fica no navegador de quem editou e nunca aparece para os
-- outros logins da barbearia.

-- ------------------------------------------------------------
-- 2. Mensagem de meta atingida do clube de fidelidade
-- ------------------------------------------------------------
-- Tags resolvidas pelo front:
--   {nome} {salao} {link} — as de sempre
--   {beneficio} {pontos} {meta} {clube} — especificas desta
ALTER TABLE public.loyalty_programs
    ADD COLUMN IF NOT EXISTS reward_message text;

COMMENT ON COLUMN public.loyalty_programs.reward_message IS
    'Aviso de meta atingida enviado por WhatsApp. NULL = usa o padrao do front.';

-- Nenhuma politica nova: as duas tabelas ja tem RLS de dono desde os scripts
-- anteriores (business_info no 01/11, loyalty_programs no 25), e coluna nova
-- entra dentro da politica que ja existe.

-- ============================================================
-- CONFERENCIA — rode depois e confira o resultado
-- ============================================================
-- Espera-se DUAS linhas, as duas com is_nullable = 'YES'.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (
        (table_name = 'business_info'    AND column_name = 'whatsappChargeMessage') OR
        (table_name = 'loyalty_programs' AND column_name = 'reward_message')
       )
 ORDER BY table_name;
