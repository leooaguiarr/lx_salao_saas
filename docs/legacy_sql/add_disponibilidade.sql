-- ============================================================
-- HORÁRIO DE FUNCIONAMENTO + INDISPONIBILIDADE DO PROFISSIONAL
-- Cole e execute no SQL Editor do Supabase.
-- Pode rodar mais de uma vez sem problema.
-- ============================================================
--
-- O PROBLEMA
--
-- A grade de horários do link público era FIXA no código: 9h às 19h, de 30 em
-- 30 minutos, TODOS OS DIAS — inclusive domingo. Ela só descontava o que já
-- estava agendado. Na prática:
--
--   - o campo "Horário Geral de Funcionamento" das Configurações era decorativo:
--     nada era salvo e nada era lido;
--   - o cliente conseguia agendar em dia fechado;
--   - não havia como o profissional bloquear uma folga, um médico ou uma viagem.
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. Cria a tabela professional_blocks (as indisponibilidades).
--   2. Faz get_public_salon devolver o horário de funcionamento e os bloqueios.
--   3. Faz create_public_booking RECUSAR no servidor um horário fechado ou
--      bloqueado.
--
-- ⚠️ O passo 3 não é opcional. A grade de horários roda no navegador do
-- cliente e serve para a tela; quem garante a regra é o servidor. O endpoint
-- público é anônimo e aceita qualquer requisição — sem a validação aqui, o
-- bloqueio seria apenas visual.

-- ------------------------------------------------------------
-- 1. Tabela das indisponibilidades
-- ------------------------------------------------------------
-- Um registro = um profissional indisponível numa data.
--   "startTime" NULL  -> o dia inteiro
--   "startTime"/"endTime" preenchidos -> apenas aquela faixa
CREATE TABLE IF NOT EXISTS public.professional_blocks (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    "profId"    TEXT NOT NULL,
    date        TEXT NOT NULL,          -- YYYY-MM-DD
    "startTime" TEXT,                   -- HH:MM  (NULL = dia inteiro)
    "endTime"   TEXT,
    reason      TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prof_blocks_lookup
    ON public.professional_blocks (user_id, "profId", date);

-- RLS igual ao das outras tabelas: o acesso é por SALÃO, não por login.
-- (ver docs/multi_login_por_salao.sql)
ALTER TABLE public.professional_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso por salao" ON public.professional_blocks;
CREATE POLICY "Acesso por salao" ON public.professional_blocks
    FOR ALL
    USING (user_id = public.salao_do_usuario())
    WITH CHECK (user_id = public.salao_do_usuario());

-- ------------------------------------------------------------
-- 2. get_public_salon passa a devolver horário e bloqueios
-- ------------------------------------------------------------
-- A coluna business_info.hours já existia no setup original, mas nunca havia
-- sido usada. Agora guarda o funcionamento por dia da semana, no formato:
--
--   { "0": {"aberto": false, "abre": "09:00", "fecha": "19:00"},   <- domingo
--     "1": {"aberto": true,  "abre": "09:00", "fecha": "19:00"},
--     ...
--     "6": {"aberto": true,  "abre": "09:00", "fecha": "15:00"} }  <- sábado
--
-- As chaves são o getDay() do JavaScript: 0 = domingo ... 6 = sábado.
CREATE OR REPLACE FUNCTION get_public_salon(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_biz record;
    v_hoje text := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD');
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
            -- Sem isto a página pública não teria como saber o dia de fechamento.
            'hours', v_biz.hours
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
        -- Só o necessário para montar a grade de horários livres:
        'bookedSlots', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'profId', a."profId", 'date', a.date, 'time', a.time, 'status', a.status
            ))
            FROM appointments a
            WHERE a.user_id = v_biz.user_id
              AND a.status IS DISTINCT FROM 'cancelled'
              AND a.date >= v_hoje
        ), '[]'::jsonb),
        -- Indisponibilidades futuras. O MOTIVO NÃO É EXPOSTO: pode ser pessoal
        -- ("médico", "velório") e a página pública é aberta a qualquer um.
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

-- ------------------------------------------------------------
-- 3. create_public_booking recusa dia fechado e horário bloqueado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_public_booking(
    p_slug text, p_name text, p_phone text,
    p_service_id text, p_prof_id text,
    p_date text, p_time text, p_birth text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_biz record;
    v_prof_id text;
    v_client_id text;
    v_appt_id text;
    v_duracao int;
    v_inicio int;      -- minutos desde a meia-noite
    v_fim int;
    v_dia_semana text;
    v_dia jsonb;
    v_abre int;
    v_fecha int;
BEGIN
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

    -- Início e fim do atendimento, em minutos desde a meia-noite
    v_inicio := (split_part(p_time, ':', 1))::int * 60 + (split_part(p_time, ':', 2))::int;
    v_fim := v_inicio + v_duracao;

    -- ---- o salão abre nesse dia, e nesse horário? ----
    -- extract(dow) devolve 0=domingo..6=sábado, igual ao getDay() do JavaScript.
    v_dia_semana := extract(dow FROM p_date::date)::int::text;
    v_dia := COALESCE(v_biz.hours, '{}'::jsonb) -> v_dia_semana;

    IF v_dia IS NOT NULL THEN
        IF COALESCE((v_dia ->> 'aberto')::boolean, true) = false THEN
            RETURN jsonb_build_object('ok', false, 'error', 'A barbearia não abre neste dia.');
        END IF;

        v_abre  := (split_part(COALESCE(v_dia ->> 'abre',  '09:00'), ':', 1))::int * 60
                 + (split_part(COALESCE(v_dia ->> 'abre',  '09:00'), ':', 2))::int;
        v_fecha := (split_part(COALESCE(v_dia ->> 'fecha', '19:00'), ':', 1))::int * 60
                 + (split_part(COALESCE(v_dia ->> 'fecha', '19:00'), ':', 2))::int;

        -- v_fim > v_fecha e proposital: o atendimento inteiro precisa caber
        -- antes de fechar, não apenas começar antes.
        IF v_inicio < v_abre OR v_fim > v_fecha THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Horário fora do funcionamento da barbearia.');
        END IF;
    END IF;

    -- Resolve o profissional ('any' = primeiro ativo, em ordem alfabética,
    -- igual à lista mostrada na página pública)
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

    -- Reaproveita o cliente pelo telefone, ou cadastra um novo
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

-- ------------------------------------------------------------
-- 4. Permissões
-- ------------------------------------------------------------
-- ATENÇÃO: a assinatura precisa listar TODOS os argumentos, inclusive os que
-- têm DEFAULT. Listar 7 em vez de 8 faz o Postgres não achar a função e aborta
-- o script inteiro — foi o que já derrubou o link público uma vez.
REVOKE ALL ON FUNCTION get_public_salon(text) FROM public;
REVOKE ALL ON FUNCTION create_public_booking(text, text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION get_public_salon(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_public_booking(text, text, text, text, text, text, text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Recarrega o cache de schema do PostgREST
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- CONFERÊNCIA
-- ------------------------------------------------------------
-- Tem que devolver 'blocks' e 'hours' (mesmo que vazios/nulos):
--
--   SELECT get_public_salon('agendamento') -> 'blocks'  AS bloqueios,
--          get_public_salon('agendamento') #> '{businessInfo,hours}' AS funcionamento;
--
-- E a tabela nova tem que existir com RLS ligada:
--
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'professional_blocks';
