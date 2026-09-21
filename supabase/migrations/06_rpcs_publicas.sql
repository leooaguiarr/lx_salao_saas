-- ============================================================================
-- 06 — RPCs DO AGENDAMENTO PÚBLICO (+ correções de schema)
-- ============================================================================
-- POR QUE ESTE ARQUIVO EXISTE
--
-- A página pública de agendamento não fala com as tabelas: ela chama funções
-- SECURITY DEFINER que devolvem só o necessário para agendar. Quando o projeto
-- virou SaaS multi-tenant, o 00_MASTER_ALL_IN_ONE.sql consolidou as migrations
-- 01 a 04 e essas funções ficaram de fora — elas só existiam nos scripts
-- avulsos que hoje estão em docs/legacy_sql/.
--
-- Resultado no ar: o front chama, o PostgREST responde PGRST202 (função não
-- encontrada), o catch engole o erro e o cliente vê "Link de agendamento não
-- encontrado". O link público está fora do ar por falta destas funções.
--
-- O QUE MUDA EM RELAÇÃO AOS SCRIPTS ANTIGOS
--
-- As tabelas do schema SaaS usam os mesmos nomes de coluna dos scripts antigos
-- (user_id como dono, "profId", "clientId", "paymentStatus"), então a lógica de
-- negócio foi preservada. O que este arquivo NÃO faz é dar a `anon` acesso
-- direto a tabela nenhuma: tudo continua passando pelas funções.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PARTE 1 — Correções de schema que o front já espera
-- ----------------------------------------------------------------------------

-- Folga de dia inteiro: a tela envia startTime e endTime nulos
-- (app.js, salvarIndisponibilidade) e o master criou as duas colunas como NOT
-- NULL. Hoje, marcar "dia inteiro" falha no banco. A leitura já trata nulo como
-- dia inteiro (profissionalBloqueado, em app.js).
ALTER TABLE public.professional_blocks ALTER COLUMN "startTime" DROP NOT NULL;
ALTER TABLE public.professional_blocks ALTER COLUMN "endTime"   DROP NOT NULL;

-- Mensagem de cobrança do crediário: está na lista de colunas que o front envia
-- (api.js) mas nunca foi criada no schema SaaS. Sem ela, o PostgREST recusa o
-- registro INTEIRO do estabelecimento quando o campo vem preenchido.
ALTER TABLE public.business_info
    ADD COLUMN IF NOT EXISTS "whatsappChargeMessage" TEXT;

-- ----------------------------------------------------------------------------
-- PARTE 2 — Freio contra varredura
-- ----------------------------------------------------------------------------
-- As funções abaixo respondem sem login. Sem um teto, qualquer um pode varrer
-- números de telefone para descobrir quem é cliente de qual salão e a que horas
-- estará lá. O balde é por IP e por finalidade.

CREATE TABLE IF NOT EXISTS public.limite_publico (
    balde    TEXT        NOT NULL,
    janela   TIMESTAMPTZ NOT NULL,
    chamadas INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (balde, janela)
);

-- RLS ligada e NENHUMA política: no Postgres isso significa "nega tudo". Quem
-- escreve aqui é a função abaixo, que por ser SECURITY DEFINER não passa pela
-- RLS. Ninguém alcança esta tabela pela API.
ALTER TABLE public.limite_publico ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.checar_limite(
    p_nome   TEXT,
    p_max    INTEGER,
    p_janela INTERVAL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ip       TEXT;
    v_balde    TEXT;
    v_inicio   TIMESTAMPTZ;
    v_chamadas INTEGER;
    v_segundos NUMERIC;
BEGIN
    -- Atrás do Coolify e do Kong, o endereço real do visitante é o PRIMEIRO da
    -- lista do x-forwarded-for; os seguintes são os proxies do caminho.
    v_ip := trim(split_part(
        COALESCE(
            current_setting('request.headers', true)::json ->> 'x-forwarded-for',
            'sem-ip'
        ), ',', 1));

    IF v_ip = '' THEN
        v_ip := 'sem-ip';
    END IF;

    v_balde := p_nome || ':' || v_ip;

    -- Janela fixa: o tempo é fatiado em blocos e cada bloco tem a própria
    -- contagem. Menos preciso que janela deslizante, e não exige uma linha por
    -- chamada — para segurar varredura, resolve.
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

    -- Faxina preguiçosa: uma chamada em cada cem varre o que venceu. Evita uma
    -- rotina agendada só para isto e a tabela não cresce sem parar.
    IF random() < 0.01 THEN
        DELETE FROM public.limite_publico WHERE janela < now() - interval '2 hours';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.checar_limite(TEXT, INTEGER, INTERVAL) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- PARTE 3 — Dados do salão pelo slug
-- ----------------------------------------------------------------------------
-- Devolve o que a página precisa para montar a grade e NADA sobre a carteira de
-- clientes. Os horários ocupados saem sem nome e sem telefone de ninguém: só
-- profissional, data, hora e situação, que é o necessário para riscar o horário
-- da lista de livres.

CREATE OR REPLACE FUNCTION public.get_public_salon(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_biz  record;
    v_hoje TEXT := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
BEGIN
    SELECT * INTO v_biz FROM business_info
    WHERE slug = p_slug
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'businessInfo', jsonb_build_object(
            'name', v_biz.name, 'slug', v_biz.slug, 'phone', v_biz.phone,
            'instagram', v_biz.instagram, 'address', v_biz.address,
            'avatarUrl', v_biz."avatarUrl",
            -- Sem hours a página não teria como saber o dia de fechamento nem a
            -- faixa de funcionamento, e ofereceria horário que o salão recusa.
            'hours', v_biz.hours,
            -- O nicho muda o vocabulário da página (barbeiro/cabeleireiro(a)/
            -- especialista) e a cor da marca.
            'business_type', v_biz.business_type,
            'primary_color', v_biz.primary_color
        ),
        'services', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', s.id, 'name', s.name, 'price', s.price,
                'duration', s.duration, 'active', s.active
            ) ORDER BY s.name)
            FROM services s WHERE s.user_id = v_biz.user_id AND s.active
        ), '[]'::jsonb),
        'professionals', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.id, 'name', p.name, 'active', p.active,
                'photoUrl', p."photoUrl"
            ) ORDER BY p.name)
            FROM professionals p WHERE p.user_id = v_biz.user_id AND p.active
        ), '[]'::jsonb),
        'bookedSlots', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'profId', a."profId", 'date', a.date, 'time', a.time, 'status', a.status
            ))
            FROM appointments a
            WHERE a.user_id = v_biz.user_id
              AND a.status IS DISTINCT FROM 'cancelled'
              AND a.date >= v_hoje
        ), '[]'::jsonb),
        -- Indisponibilidades futuras. O MOTIVO NÃO SAI DAQUI: pode ser pessoal
        -- ("médico", "velório") e esta página é aberta a qualquer um.
        'blocks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'profId', b."profId", 'date', b.date,
                'startTime', b."startTime", 'endTime', b."endTime"
            ))
            FROM professional_blocks b
            WHERE b.user_id = v_biz.user_id
              AND b.date >= v_hoje
        ), '[]'::jsonb)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- PARTE 4 — Vitrine de produtos
-- ----------------------------------------------------------------------------
-- A quantidade em estoque NÃO sai daqui. O público vê o que está à venda, não
-- quanto resta: saldo é informação de operação, e de concorrente.

CREATE OR REPLACE FUNCTION public.get_public_products(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'name', p.name,
                   'category', p.category,
                   'price', p.price,
                   'photoUrl', p."photoUrl"
               ) ORDER BY p.category NULLS LAST, p.name)
        FROM products p
        WHERE p.user_id = v_user_id
          AND p.active
          AND p.stock > 0
    ), '[]'::jsonb);
END;
$$;

-- ----------------------------------------------------------------------------
-- PARTE 5 — "Esse número já é cliente daqui?"
-- ----------------------------------------------------------------------------
-- Existe para a página pedir a data de nascimento só a quem ainda não é
-- cliente. Sem ela, todo mundo digitaria a data em todo agendamento, e atrito
-- no formulário público custa agendamento perdido. É o dado menos sensível dos
-- três, e o limite abaixo é que resolve o abuso.

CREATE OR REPLACE FUNCTION public.check_client_exists(p_slug TEXT, p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_exists  BOOLEAN;
BEGIN
    PERFORM public.checar_limite('existe', 40, interval '10 minutes');

    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM clients WHERE user_id = v_user_id AND phone = p_phone
    ) INTO v_exists;

    -- Número que não é cliente conta num balde mais apertado: é assim que a
    -- varredura se denuncia, porque ela erra quase todas.
    IF NOT v_exists THEN
        PERFORM public.checar_limite('busca_sem_resultado', 12, interval '10 minutes');
    END IF;

    RETURN v_exists;
END;
$$;

-- ----------------------------------------------------------------------------
-- PARTE 6 — Quantos horários a pessoa já tem na semana
-- ----------------------------------------------------------------------------
-- Devolve só a CONTAGEM. A versão antiga devolvia data, hora e serviço de cada
-- horário — ou seja, a agenda da pessoa, entregue a quem digitasse o número
-- dela. A contagem basta para o aviso "você já tem horário nesta semana".
--
-- 'appointments' continua no retorno, sempre vazio, porque versões antigas da
-- página liam esse campo: assim um deploy pela metade não quebra a tela.

CREATE OR REPLACE FUNCTION public.check_week_appointments(p_slug TEXT, p_phone TEXT, p_date TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id    UUID;
    v_client_id  TEXT;
    v_target     DATE;
    v_week_start DATE;
    v_week_end   DATE;
    v_quantidade INTEGER;
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

-- ----------------------------------------------------------------------------
-- PARTE 7 — Fila de espera do cliente
-- ----------------------------------------------------------------------------
-- Quem espera precisa saber o próprio horário e quantos estão na frente. Por
-- isso a fila sai só com horário e situação: nome e telefone dos outros
-- clientes nunca entram no retorno, e o nome do profissional também não — o
-- cliente já sabe com quem marcou, e é o único campo que diria algo a mais.

CREATE OR REPLACE FUNCTION public.get_public_queue(p_slug TEXT, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id   UUID;
    v_client_id TEXT;
    v_hoje      TEXT := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
    v_meu       record;
    v_fila      JSONB;
    v_posicao   INT;
BEGIN
    -- Teto alto de propósito: a tela se atualiza sozinha a cada 30 segundos e o
    -- salão inteiro consulta pelo mesmo Wi-Fi. Quem passa daqui não é cliente
    -- esperando.
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

-- ----------------------------------------------------------------------------
-- PARTE 8 — Criar o agendamento
-- ----------------------------------------------------------------------------
-- As mesmas regras que a tela aplica são refeitas AQUI, e não por desconfiança
-- do front: a página é pública e o corpo da requisição pode ser montado à mão.
-- Validar só no navegador significa não validar.

CREATE OR REPLACE FUNCTION public.create_public_booking(
    p_slug TEXT, p_name TEXT, p_phone TEXT,
    p_service_id TEXT, p_prof_id TEXT,
    p_date TEXT, p_time TEXT, p_birth TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_biz       record;
    v_prof_id   TEXT;
    v_client_id TEXT;
    v_appt_id   TEXT;
    v_duracao   INT;
    v_inicio    INT;   -- minutos desde a meia-noite
    v_fim       INT;
    v_dia_semana TEXT;
    v_dia       JSONB;
    v_abre      INT;
    v_fecha     INT;
BEGIN
    -- Teto por IP: sem isto, um laço cria agendamento até lotar a agenda do
    -- salão. É baixo porque agendar é ato raro, não navegação.
    PERFORM public.checar_limite('agendar', 10, interval '10 minutes');

    IF COALESCE(trim(p_name), '') = '' OR COALESCE(trim(p_phone), '') = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Nome e WhatsApp são obrigatórios.');
    END IF;
    IF p_date IS NULL OR p_time IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Selecione data e horário.');
    END IF;
    IF p_date < to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Não é possível agendar em uma data passada.');
    END IF;

    SELECT * INTO v_biz FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Salão não encontrado.');
    END IF;

    SELECT duration INTO v_duracao FROM services
    WHERE id = p_service_id AND user_id = v_biz.user_id AND active;
    IF v_duracao IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Serviço inválido.');
    END IF;

    v_inicio := (split_part(p_time, ':', 1))::int * 60 + (split_part(p_time, ':', 2))::int;
    v_fim := v_inicio + v_duracao;

    -- ---- o salão abre nesse dia, nesse horário? ----
    -- extract(dow) devolve 0=domingo..6=sábado, igual ao getDay() do JavaScript,
    -- que é como a tela de Configurações grava o objeto hours.
    v_dia_semana := extract(dow FROM p_date::date)::int::text;
    v_dia := COALESCE(v_biz.hours, '{}'::jsonb) -> v_dia_semana;

    IF v_dia IS NOT NULL THEN
        IF COALESCE((v_dia ->> 'aberto')::boolean, true) = false THEN
            RETURN jsonb_build_object('ok', false, 'error', 'O estabelecimento não abre neste dia.');
        END IF;

        v_abre  := (split_part(COALESCE(v_dia ->> 'abre',  '09:00'), ':', 1))::int * 60
                 + (split_part(COALESCE(v_dia ->> 'abre',  '09:00'), ':', 2))::int;
        v_fecha := (split_part(COALESCE(v_dia ->> 'fecha', '19:00'), ':', 1))::int * 60
                 + (split_part(COALESCE(v_dia ->> 'fecha', '19:00'), ':', 2))::int;

        -- v_fim > v_fecha é proposital: o atendimento inteiro precisa caber
        -- antes de fechar, não apenas começar antes.
        IF v_inicio < v_abre OR v_fim > v_fecha THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Horário fora do funcionamento do estabelecimento.');
        END IF;
    END IF;

    -- 'any' = primeiro ativo em ordem alfabética, igual à lista que a página mostra.
    IF p_prof_id IS NULL OR p_prof_id = 'any' THEN
        SELECT id INTO v_prof_id FROM professionals
        WHERE user_id = v_biz.user_id AND active ORDER BY name LIMIT 1;
    ELSE
        SELECT id INTO v_prof_id FROM professionals
        WHERE id = p_prof_id AND user_id = v_biz.user_id AND active LIMIT 1;
    END IF;
    IF v_prof_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Profissional indisponível.');
    END IF;

    -- ---- o profissional bloqueou esse horário? ----
    -- Sobreposição de faixas: (inicioA < fimB) E (fimA > inicioB).
    -- "startTime" nulo significa o dia inteiro.
    IF EXISTS (
        SELECT 1 FROM professional_blocks b
        WHERE b.user_id = v_biz.user_id
          AND b."profId" = v_prof_id
          AND b.date = p_date
          AND (
                b."startTime" IS NULL
                OR (
                    v_inicio < ((split_part(COALESCE(b."endTime", '23:59'), ':', 1))::int * 60
                              + (split_part(COALESCE(b."endTime", '23:59'), ':', 2))::int)
                    AND v_fim > ((split_part(b."startTime", ':', 1))::int * 60
                              + (split_part(b."startTime", ':', 2))::int)
                )
              )
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'O profissional não está disponível neste horário.');
    END IF;

    -- Horário já ocupado? (protege contra reserva dupla)
    IF EXISTS (
        SELECT 1 FROM appointments
        WHERE user_id = v_biz.user_id AND "profId" = v_prof_id
          AND date = p_date AND time = p_time
          AND status IS DISTINCT FROM 'cancelled'
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Este horário acabou de ser reservado. Escolha outro.');
    END IF;

    -- Reaproveita o cliente pelo telefone, ou cadastra um novo. Evita duplicar a
    -- ficha de quem já é cliente e preserva o histórico de relacionamento.
    SELECT id INTO v_client_id FROM clients
    WHERE user_id = v_biz.user_id AND phone = p_phone LIMIT 1;
    IF v_client_id IS NULL THEN
        v_client_id := 'cli-' || (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint;
        INSERT INTO clients (id, user_id, name, phone, birth, frequency, "lastVisit", notes)
        VALUES (v_client_id, v_biz.user_id, trim(p_name), p_phone, p_birth, 30, p_date,
                'Cliente cadastrado automaticamente pelo link público.');
    END IF;

    v_appt_id := 'appt-' || (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint;
    INSERT INTO appointments (id, user_id, "clientId", "serviceId", "profId", date, time, status, "paymentStatus", notes)
    VALUES (v_appt_id, v_biz.user_id, v_client_id, p_service_id, v_prof_id, p_date, p_time,
            'scheduled', 'pending', 'Agendado pelo link público do cliente.');

    INSERT INTO leads (id, user_id, name, phone, source, stage, notes, date)
    VALUES ('lead-' || (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint,
            v_biz.user_id, trim(p_name), p_phone, 'website', 'scheduled',
            'Agendou pelo link público para ' || p_date || ' às ' || p_time || 'h.',
            to_char(now(), 'YYYY-MM-DD'));

    RETURN jsonb_build_object('ok', true, 'appointmentId', v_appt_id, 'profId', v_prof_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- PARTE 9 — Permissões
-- ----------------------------------------------------------------------------
-- ATENÇÃO: a assinatura precisa listar TODOS os argumentos, inclusive os que
-- têm DEFAULT. Listar 7 em vez de 8 em create_public_booking faz o Postgres não
-- achar a função e aborta o script inteiro (erro 42883) — isso já derrubou o
-- link público neste projeto antes.

REVOKE ALL ON FUNCTION public.get_public_salon(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_products(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_client_exists(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_week_appointments(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_queue(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_public_booking(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_public_salon(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_products(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_client_exists(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_week_appointments(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_queue(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_booking(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- PARTE 10 — Recarrega o cache de schema do PostgREST
-- ----------------------------------------------------------------------------
-- Sem isto as funções novas só aparecem para a API depois de alguns minutos ou
-- de um restart do container.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- CONFERÊNCIA (rode depois, trocando pelo slug real de um salão)
-- ============================================================================
--
-- 1. As seis funções existem:
--
--    SELECT proname FROM pg_proc
--    WHERE proname IN ('get_public_salon','create_public_booking','get_public_queue',
--                      'get_public_products','check_client_exists','check_week_appointments')
--    ORDER BY proname;
--    -- tem que devolver 6 linhas
--
-- 2. O salão responde, com horário de funcionamento e bloqueios:
--
--    SELECT get_public_salon('SEU-SLUG') #> '{businessInfo,hours}' AS funcionamento,
--           get_public_salon('SEU-SLUG') -> 'blocks'               AS bloqueios;
--
-- 3. A grade NÃO vaza cliente (tem que vir só profId, date, time e status):
--
--    SELECT jsonb_object_keys(get_public_salon('SEU-SLUG') -> 'bookedSlots' -> 0);
--
-- 4. A vitrine não expõe saldo (não pode aparecer 'stock'):
--
--    SELECT get_public_products('SEU-SLUG');
--
-- 5. Slug que não existe devolve NULL, não erro:
--
--    SELECT get_public_salon('slug-que-nao-existe') IS NULL;
-- ============================================================================
