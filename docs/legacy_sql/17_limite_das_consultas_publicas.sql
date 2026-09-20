-- ============================================================
-- LIMITE E RECORTE DAS CONSULTAS PÚBLICAS
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O QUE ESTAVA ABERTO
--
-- Três RPCs do link público usam o TELEFONE como chave de acesso, sem nada que
-- prove que o número é de quem está perguntando:
--
--   check_client_exists(slug, phone)          -> "esse número é cliente daqui?"
--   check_week_appointments(slug, phone, data) -> data, hora e serviço dos
--                                                 horários da pessoa na semana
--   get_public_queue(slug, phone)              -> horário, situação e o
--                                                 profissional de quem está
--                                                 na fila AGORA
--
-- Todas com GRANT para `anon`, ou seja: chamáveis por qualquer pessoa com a
-- chave que vai no navegador de todo mundo. Com o telefone de alguém — que
-- qualquer um tem — dava para saber se a pessoa frequenta a barbearia, quando
-- ela vai e se ela está lá neste momento. Varrendo faixas de 11 9xxxx-xxxx,
-- dava para reconstruir a carteira de clientes do salão.
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. Um limitador de chamadas por IP, com um balde separado para as consultas
--      que NÃO ENCONTRAM nada — que é a assinatura da varredura.
--   2. check_week_appointments passa a devolver só QUANTOS horários existem,
--      sem data, sem hora e sem serviço.
--   3. get_public_queue para de devolver o nome do profissional.
--
-- POR QUE LIMITAR AS FALHAS, E NÃO AS CHAMADAS
--
-- A fila é consultada DENTRO do salão, e o salão tem um Wi-Fi só: limitar
-- chamadas por IP barraria os próprios clientes esperando na cadeira. Já quem
-- varre números erra quase todas as tentativas, enquanto o cliente legítimo
-- acerta o próprio telefone de primeira. Limitar o erro pega o ataque sem
-- encostar em quem está usando o sistema de verdade.
--
-- ⚠️ ESTE SCRIPT NÃO RECRIA create_public_booking. Ela é a função mais
-- retrabalhada do projeto (scripts 02 e 10) e recriá-la a partir de outro
-- arquivo já derrubou o link público uma vez. O limite de agendamentos criados
-- por IP fica como pendência, num script próprio e com teste — ver o fim
-- deste arquivo.

-- ------------------------------------------------------------
-- 1. O contador
-- ------------------------------------------------------------
-- Janela fixa: o tempo é fatiado em blocos de tamanho p_janela e cada bloco tem
-- a própria contagem. É menos preciso que uma janela deslizante e não precisa
-- guardar uma linha por chamada — para segurar varredura, resolve.
CREATE TABLE IF NOT EXISTS public.limite_publico (
    balde    text        NOT NULL,
    janela   timestamptz NOT NULL,
    chamadas integer     NOT NULL DEFAULT 1,
    PRIMARY KEY (balde, janela)
);

-- Ninguém fala com esta tabela pela API: RLS ligada e NENHUMA política, que no
-- Postgres significa "nega tudo". Quem escreve é a função abaixo, que é
-- SECURITY DEFINER e por isso não passa pela RLS.
ALTER TABLE public.limite_publico ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. O limitador
-- ------------------------------------------------------------
-- Estoura a exceção quando o balde passa do teto. As RPCs abaixo chamam esta
-- função; quem estourar recebe o erro no lugar da resposta.
CREATE OR REPLACE FUNCTION public.checar_limite(
    p_nome   text,
    p_max    integer,
    p_janela interval
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ip       text;
    v_balde    text;
    v_inicio   timestamptz;
    v_chamadas integer;
    v_segundos numeric;
BEGIN
    -- O PostgREST expõe os cabeçalhos da requisição. Atrás da Vercel e do
    -- Supabase, o endereço real do visitante é o PRIMEIRO da lista do
    -- x-forwarded-for; os seguintes são os proxies do caminho.
    v_ip := trim(split_part(
        COALESCE(
            current_setting('request.headers', true)::json ->> 'x-forwarded-for',
            'sem-ip'
        ), ',', 1));

    IF v_ip = '' THEN
        v_ip := 'sem-ip';
    END IF;

    v_balde := p_nome || ':' || v_ip;

    -- Início do bloco de tempo atual.
    v_segundos := extract(epoch FROM p_janela);
    v_inicio := to_timestamp(floor(extract(epoch FROM now()) / v_segundos) * v_segundos);

    INSERT INTO public.limite_publico AS l (balde, janela, chamadas)
    VALUES (v_balde, v_inicio, 1)
    ON CONFLICT (balde, janela) DO UPDATE
        SET chamadas = l.chamadas + 1
    RETURNING l.chamadas INTO v_chamadas;

    IF v_chamadas > p_max THEN
        RAISE EXCEPTION 'limite_de_consultas'
            USING HINT = 'Muitas consultas seguidas. Espere alguns minutos e tente de novo.';
    END IF;

    -- Faxina preguiçosa: uma chamada em cada cem varre o que já venceu. Evita
    -- uma rotina agendada só para isto, e a tabela não cresce sem parar.
    IF random() < 0.01 THEN
        DELETE FROM public.limite_publico WHERE janela < now() - interval '2 hours';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.checar_limite(text, integer, interval) FROM public;
-- Só as RPCs SECURITY DEFINER chamam esta função, e elas rodam como o dono.
-- `anon` não precisa — e não deve — poder chamá-la direto.

-- ------------------------------------------------------------
-- 3. check_client_exists — mantida, agora com limite
-- ------------------------------------------------------------
-- A função continua existindo de propósito. É ela que faz a página pedir a data
-- de nascimento só para quem ainda não é cliente; removê-la obrigaria TODO
-- mundo a digitar a data em todo agendamento, e atrito no formulário público
-- custa agendamento perdido. O que ela responde ("esse número já é cliente
-- daqui") é o dado menos sensível dos três — o limite resolve o abuso.
CREATE OR REPLACE FUNCTION check_client_exists(p_slug text, p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_exists  boolean;
BEGIN
    -- Teto largo: o cliente legítimo chama uma ou duas vezes por agendamento.
    PERFORM public.checar_limite('cliente_existe', 60, interval '10 minutes');

    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM clients WHERE user_id = v_user_id AND phone = p_phone
    ) INTO v_exists;

    -- Número que não é cliente conta no balde das falhas: é assim que a
    -- varredura se denuncia, porque ela erra quase todas.
    IF NOT v_exists THEN
        PERFORM public.checar_limite('busca_sem_resultado', 12, interval '10 minutes');
    END IF;

    RETURN v_exists;
END;
$$;

-- ------------------------------------------------------------
-- 4. check_week_appointments — só a contagem
-- ------------------------------------------------------------
-- Antes devolvia a lista com data, hora e serviço de cada horário. Isso é a
-- agenda da pessoa, entregue a quem digitasse o número dela.
--
-- Agora devolve só QUANTOS horários existem na semana. É o suficiente para o
-- aviso que a tela mostra ("você já tem horário nesta semana, quer continuar?")
-- e não serve de nada para quem está pescando.
--
-- 'appointments' continua no retorno, sempre vazio, porque versões antigas da
-- página liam esse campo — assim um deploy pela metade não quebra a tela.
CREATE OR REPLACE FUNCTION check_week_appointments(p_slug text, p_phone text, p_date text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id    uuid;
    v_client_id  text;
    v_target     date;
    v_week_start date;
    v_week_end   date;
    v_quantidade integer;
BEGIN
    PERFORM public.checar_limite('semana', 60, interval '10 minutes');

    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('hasAppointments', false, 'quantidade', 0, 'appointments', '[]'::jsonb);
    END IF;

    SELECT id INTO v_client_id FROM clients
    WHERE user_id = v_user_id AND phone = p_phone LIMIT 1;
    IF v_client_id IS NULL THEN
        PERFORM public.checar_limite('busca_sem_resultado', 12, interval '10 minutes');
        RETURN jsonb_build_object('hasAppointments', false, 'quantidade', 0, 'appointments', '[]'::jsonb);
    END IF;

    v_target     := p_date::date;
    v_week_start := v_target - (extract(isodow FROM v_target)::int - 1);
    v_week_end   := v_week_start + 6;

    SELECT count(*) INTO v_quantidade
    FROM appointments a
    WHERE a.user_id = v_user_id
      AND a."clientId" = v_client_id
      AND a.status IS DISTINCT FROM 'cancelled'
      AND a.date::date BETWEEN v_week_start AND v_week_end;

    RETURN jsonb_build_object(
        'hasAppointments', v_quantidade > 0,
        'quantidade', v_quantidade,
        'appointments', '[]'::jsonb
    );
END;
$$;

-- ------------------------------------------------------------
-- 5. get_public_queue — sem o nome do profissional
-- ------------------------------------------------------------
-- O resto do retorno é a razão de a função existir e não dá para recortar sem
-- matar a tela: quem espera precisa saber o próprio horário e quantos estão na
-- frente. O nome do profissional sai porque é o único campo que não faz falta
-- (o cliente sabe com quem marcou) e que diz algo a mais sobre ele.
--
-- O que já era certo continua: não devolve nome nem telefone de mais ninguém
-- da fila, só horário e situação.
CREATE OR REPLACE FUNCTION get_public_queue(p_slug text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id   uuid;
    v_client_id text;
    v_hoje      text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
    v_meu       record;
    v_fila      jsonb;
    v_posicao   int;
BEGIN
    -- Teto alto de propósito: a tela se atualiza sozinha a cada 30 segundos, e
    -- o salão inteiro consulta pelo mesmo Wi-Fi. Quem passa daqui não é
    -- cliente esperando.
    PERFORM public.checar_limite('fila', 600, interval '10 minutes');

    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('encontrado', false);
    END IF;

    SELECT id INTO v_client_id FROM clients
    WHERE user_id = v_user_id AND phone = p_phone LIMIT 1;
    IF v_client_id IS NULL THEN
        PERFORM public.checar_limite('busca_sem_resultado', 12, interval '10 minutes');
        RETURN jsonb_build_object('encontrado', false);
    END IF;

    SELECT a.id, a.time, a."profId", a.status
    INTO v_meu
    FROM appointments a
    WHERE a.user_id = v_user_id
      AND a."clientId" = v_client_id
      AND a.date = v_hoje
      AND a.status NOT IN ('cancelled', 'no_show', 'done')
    ORDER BY a.time
    LIMIT 1;

    IF NOT FOUND THEN
        PERFORM public.checar_limite('busca_sem_resultado', 12, interval '10 minutes');
        RETURN jsonb_build_object('encontrado', false);
    END IF;

    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'time'), '[]'::jsonb)
    INTO v_fila
    FROM (
        SELECT jsonb_build_object(
                   'time', a.time,
                   'status', a.status,
                   'sou_eu', a.id = v_meu.id
               ) AS x
        FROM appointments a
        WHERE a.user_id = v_user_id
          AND a."profId" = v_meu."profId"
          AND a.date = v_hoje
          AND a.status NOT IN ('cancelled', 'no_show', 'done')
    ) sub;

    SELECT count(*) INTO v_posicao
    FROM appointments a
    WHERE a.user_id = v_user_id
      AND a."profId" = v_meu."profId"
      AND a.date = v_hoje
      AND a.status NOT IN ('cancelled', 'no_show', 'done')
      AND a.time < v_meu.time;

    RETURN jsonb_build_object(
        'encontrado', true,
        'meuHorario', v_meu.time,
        'meuStatus', v_meu.status,
        'pessoasNaFrente', v_posicao,
        'fila', v_fila
    );
END;
$$;

-- ------------------------------------------------------------
-- 6. Permissões
-- ------------------------------------------------------------
-- As assinaturas precisam bater EXATAMENTE, incluindo argumentos com DEFAULT.
-- Assinatura errada aqui derruba o script inteiro com erro 42883 e o link
-- público fica sem o RPC — já aconteceu neste projeto.
REVOKE ALL ON FUNCTION check_client_exists(text, text) FROM public;
REVOKE ALL ON FUNCTION check_week_appointments(text, text, text) FROM public;
REVOKE ALL ON FUNCTION get_public_queue(text, text) FROM public;
GRANT EXECUTE ON FUNCTION check_client_exists(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_week_appointments(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_queue(text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CONFERÊNCIA
-- ============================================================
--
-- 1. As três funções continuam de pé, com a assinatura certa:
--
--      SELECT proname, pronargs FROM pg_proc
--      WHERE proname IN ('check_client_exists','check_week_appointments','get_public_queue');
--
--    Esperado: 2, 3 e 2 argumentos.
--
-- 2. A semana não devolve mais horário nenhum (troque pelo slug e por um
--    telefone real que TENHA agendamento na semana):
--
--      SELECT check_week_appointments('agendamento', '(11) 98888-7777', '2026-08-21');
--
--    Tem que vir "quantidade" preenchido e "appointments": []. Se aparecer data
--    ou serviço, a função antiga ainda está no ar.
--
-- 3. A fila não devolve mais o profissional:
--
--      SELECT get_public_queue('agendamento', '(11) 98888-7777') ? 'profissional';
--
--    Tem que ser `false`.
--
-- 4. O limite morde. Rode 13 vezes seguidas com um número que não existe:
--
--      SELECT check_client_exists('agendamento', '(11) 90000-0000');
--
--    A partir da 13ª tem que estourar 'limite_de_consultas'. No SQL Editor não
--    há cabeçalho de IP, então todas caem no balde 'sem-ip' — o que serve para
--    o teste. Para zerar e testar de novo:
--
--      DELETE FROM public.limite_publico;
--
-- 5. A tabela do contador não pode ser acessível pela API:
--
--      SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'limite_publico';
--
--    relrowsecurity tem que ser `true`, e não pode existir política nenhuma:
--
--      SELECT count(*) FROM pg_policies WHERE tablename = 'limite_publico';  -- 0
--
-- ============================================================
-- PENDÊNCIA CONHECIDA
-- ============================================================
--
-- create_public_booking continua SEM limite por IP. Dá para lotar a agenda de
-- um salão com agendamentos falsos, ou marcar horário no nome de terceiros com
-- o telefone deles.
--
-- Não foi feito aqui porque exigiria recriar a função inteira a partir de outro
-- arquivo (a versão vigente é a do script 10, com horário de funcionamento e
-- bloqueios), e é exatamente o tipo de mudança que os scripts 10, 12 e 13
-- alertam ter derrubado o link público uma vez.
--
-- Quando for feito, o formato é o mesmo daqui, no topo da função:
--
--     PERFORM public.checar_limite('agendou', 10, interval '1 hour');
--
-- e o script precisa copiar a versão vigente por inteiro, conferir
-- `pronargs = 8` e testar um agendamento de verdade antes de entregar.
