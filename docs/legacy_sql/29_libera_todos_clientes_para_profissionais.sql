-- ============================================================================
-- SCRIPT 29: LIBERA VISUALIZAÇÃO DE TODOS OS CLIENTES PARA OS PROFISSIONAIS
-- ============================================================================
-- Objetivo:
-- Permitir que os profissionais do salão consigam visualizar e acessar todos os
-- clientes cadastrados no estabelecimento, independente de já terem atendido
-- aquele cliente anteriormente ou não.
--
-- Regras de Negócio:
-- 1. SELECT: Qualquer membro do salão autenticado pode ver todos os clientes do salão.
-- 2. INSERT: Qualquer membro do salão autenticado pode cadastrar clientes.
-- 3. UPDATE: Qualquer membro do salão autenticado pode editar clientes do salão.
-- 4. DELETE: Somente o Dono / Administrador pode excluir clientes do salão.
-- ============================================================================

BEGIN;

-- 1. Garante que RLS está habilitado
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- 2. Remove políticas anteriores (tanto da migração unificada quanto granular)
DROP POLICY IF EXISTS "Acesso por salao" ON public.clients;
DROP POLICY IF EXISTS "Leitura dos proprios clientes" ON public.clients;
DROP POLICY IF EXISTS "Alteracao dos proprios clientes" ON public.clients;
DROP POLICY IF EXISTS "Leitura de clientes do salao" ON public.clients;
DROP POLICY IF EXISTS "Insercao por salao" ON public.clients;
DROP POLICY IF EXISTS "Alteracao de clientes do salao" ON public.clients;
DROP POLICY IF EXISTS "Exclusao do dono" ON public.clients;

-- 3. Criação das novas políticas

-- Leitura: Qualquer membro do salão (dono ou profissional vinculado) vê toda a base do salão
CREATE POLICY "Leitura de clientes do salao" ON public.clients
    FOR SELECT
    USING (user_id = public.salao_do_usuario());

-- Inserção: Qualquer membro do salão pode criar novos clientes
CREATE POLICY "Insercao por salao" ON public.clients
    FOR INSERT
    WITH CHECK (user_id = public.salao_do_usuario());

-- Atualização: Qualquer membro do salão pode atualizar dados dos clientes do salão
CREATE POLICY "Alteracao de clientes do salao" ON public.clients
    FOR UPDATE
    USING (user_id = public.salao_do_usuario())
    WITH CHECK (user_id = public.salao_do_usuario());

-- Exclusão: Restrita ao Dono / Administrador
CREATE POLICY "Exclusao do dono" ON public.clients
    FOR DELETE
    USING (user_id = public.salao_do_usuario() AND public.meu_papel() = 'owner');

COMMIT;
