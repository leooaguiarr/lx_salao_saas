-- ============================================================
-- MIGRAÇÃO: Foto dos Profissionais
-- Adiciona a coluna "photoUrl" na tabela professionals e recria
-- a função get_public_salon para expor a foto na página pública.
-- Cole e execute no SQL Editor do Supabase (idempotente).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Adiciona a coluna "photoUrl" (se ainda não existir)
-- ------------------------------------------------------------
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

-- Corrige nome da coluna caso o Postgres a tenha criado sem aspas
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='professionals' AND column_name='photourl') THEN
        ALTER TABLE professionals RENAME COLUMN photourl TO "photoUrl";
    END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Recria get_public_salon incluindo "photoUrl" no JSON
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

REVOKE ALL ON FUNCTION get_public_salon(text) FROM public;
GRANT EXECUTE ON FUNCTION get_public_salon(text) TO anon, authenticated;
