-- ============================================================
-- LINK PÚBLICO DE AGENDAMENTO + CORREÇÕES DE SINCRONIZAÇÃO
-- Cole e execute no SQL Editor do Supabase (pode rodar mais de
-- uma vez sem problema — todas as etapas são idempotentes).
-- ============================================================

-- ------------------------------------------------------------
-- 1. CORREÇÃO: renomear colunas para camelCase
-- O setup original criou colunas sem aspas (clientId virou
-- clientid), mas o app envia camelCase — por isso a
-- sincronização de agendamentos/clientes/transações falhava
-- silenciosamente.
-- ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='clientid') THEN
        ALTER TABLE appointments RENAME COLUMN clientid TO "clientId";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='serviceid') THEN
        ALTER TABLE appointments RENAME COLUMN serviceid TO "serviceId";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='profid') THEN
        ALTER TABLE appointments RENAME COLUMN profid TO "profId";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='paymentstatus') THEN
        ALTER TABLE appointments RENAME COLUMN paymentstatus TO "paymentStatus";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='paymentmethod') THEN
        ALTER TABLE appointments RENAME COLUMN paymentmethod TO "paymentMethod";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='lastvisit') THEN
        ALTER TABLE clients RENAME COLUMN lastvisit TO "lastVisit";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='photourl') THEN
        ALTER TABLE clients RENAME COLUMN photourl TO "photoUrl";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='paymentmethod') THEN
        ALTER TABLE transactions RENAME COLUMN paymentmethod TO "paymentMethod";
    END IF;
END $$;

-- ------------------------------------------------------------
-- 2. CORREÇÃO: unicidade de business_info por usuário
-- O app usa upsert com onConflict: 'user_id', que exige uma
-- constraint UNIQUE (sem ela o salvamento falhava).
-- ------------------------------------------------------------
-- Remove duplicatas mantendo a mais recente
DELETE FROM business_info a USING business_info b
WHERE a.user_id = b.user_id AND a.created_at < b.created_at;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_info_user_id_key') THEN
        ALTER TABLE business_info ADD CONSTRAINT business_info_user_id_key UNIQUE (user_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_business_info_slug ON business_info (slug);

-- ------------------------------------------------------------
-- 3. FUNÇÃO PÚBLICA: dados do salão pelo slug
-- Chamada pela página pública de agendamento (sem login).
-- SECURITY DEFINER: passa por cima do RLS, mas expõe SOMENTE
-- o que a página precisa (nunca dados de clientes).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_public_salon(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_biz record;
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
            'avatarUrl', v_biz."avatarUrl"
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
              AND a.date >= to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
        ), '[]'::jsonb)
    );
END;
$$;

-- ------------------------------------------------------------
-- 3.5. FUNÇÃO PÚBLICA: Checar se o cliente já existe pelo telefone
-- Útil para saber se precisamos pedir a data de nascimento no frontend
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_client_exists(p_slug text, p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_exists boolean;
BEGIN
    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;
    
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM clients WHERE user_id = v_user_id AND phone = p_phone
    ) INTO v_exists;

    RETURN v_exists;
END;
$$;

-- ------------------------------------------------------------
-- 4. FUNÇÃO PÚBLICA: criar agendamento pelo link
-- Valida serviço/profissional/horário e grava cliente,
-- agendamento e lead na conta do salão dono do slug.
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

    IF NOT EXISTS (SELECT 1 FROM services WHERE id = p_service_id AND user_id = v_biz.user_id AND active) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Serviço inválido.');
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
-- 5. FUNÇÃO PÚBLICA: Checar se o cliente já tem agendamento na semana
-- Retorna os agendamentos existentes do telefone na mesma semana ISO
-- para que o frontend exiba um aviso (sem bloquear).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_week_appointments(p_slug text, p_phone text, p_date text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_client_id text;
    v_target_date date;
    v_week_start date;
    v_week_end date;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_user_id FROM business_info
    WHERE slug = p_slug ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('hasAppointments', false);
    END IF;

    SELECT id INTO v_client_id FROM clients
    WHERE user_id = v_user_id AND phone = p_phone LIMIT 1;
    IF v_client_id IS NULL THEN
        RETURN jsonb_build_object('hasAppointments', false);
    END IF;

    v_target_date := p_date::date;
    v_week_start := v_target_date - (extract(isodow FROM v_target_date)::int - 1);
    v_week_end := v_week_start + 6;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', a.date, 'time', a.time, 'serviceId', a."serviceId"
    )), '[]'::jsonb)
    INTO v_result
    FROM appointments a
    WHERE a.user_id = v_user_id
      AND a."clientId" = v_client_id
      AND a.status IS DISTINCT FROM 'cancelled'
      AND a.date::date BETWEEN v_week_start AND v_week_end;

    RETURN jsonb_build_object(
        'hasAppointments', jsonb_array_length(v_result) > 0,
        'appointments', v_result
    );
END;
$$;

-- ------------------------------------------------------------
-- 6. Permissões: as funções podem ser chamadas sem login (anon)
-- ------------------------------------------------------------
-- ATENÇÃO: a assinatura precisa listar TODOS os argumentos, inclusive os que
-- têm DEFAULT. create_public_booking tem 8 parâmetros (o último é p_birth).
-- Listar só 7 faz o Postgres não encontrar a função e abortar o script inteiro,
-- deixando o link público sem o RPC de confirmação do agendamento.
REVOKE ALL ON FUNCTION get_public_salon(text) FROM public;
REVOKE ALL ON FUNCTION create_public_booking(text, text, text, text, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION check_client_exists(text, text) FROM public;
REVOKE ALL ON FUNCTION check_week_appointments(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION get_public_salon(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_public_booking(text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_client_exists(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_week_appointments(text, text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. Recarrega o cache de schema do PostgREST
-- Sem isso as funções novas só ficam visíveis para a API depois
-- de alguns minutos (ou de um restart do projeto).
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
