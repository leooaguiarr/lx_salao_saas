-- ============================================================================
-- 10 — O LINK PÚBLICO HERDA O TEMA DO SALÃO
-- ============================================================================
-- O link de agendamento é a cara do salão para o cliente final: passa a usar
-- o mesmo tema do painel (instrucoes-ia/DESIGN_E_TEMAS.md). A cor da marca
-- (primary_color) e o nicho já saíam daqui; faltava o `theme`.
--
-- A função é a mesma da migração 06, com UMA linha a mais ('theme'). Nada
-- sobre a carteira de clientes sai por aqui — as regras da 06 continuam.
--
-- Sem esta migração o link funciona e usa o tema padrão do nicho do salão.
--
-- Seguro rodar mais de uma vez.
-- ============================================================================

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
            -- especialista); tema e cor da marca, a aparência (migração 10).
            'business_type', v_biz.business_type,
            'primary_color', v_biz.primary_color,
            'theme', v_biz.theme
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

-- Conferência: tem que devolver uma linha com ok = true.
SELECT pg_get_functiondef('public.get_public_salon(text)'::regprocedure) LIKE '%''theme''%' AS ok;
