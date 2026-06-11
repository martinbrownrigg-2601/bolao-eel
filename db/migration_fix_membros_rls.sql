-- =====================================================================
-- BolãoEEL — Fix: recursão infinita na RLS de membros_bolao
-- Idempotente. Execute no SQL Editor depois de migration_boloes.sql.
--
-- Problema: a policy "membros_select_mesmo_bolao" fazia um subselect na
-- própria tabela membros_bolao, o que dispara a policy recursivamente:
--   ERROR: infinite recursion detected in policy for relation "membros_bolao"
-- Sintoma: o usuário entra no bolão (RPC security definer funciona), mas a
-- tela do bolão falha ao carregar a lista de membros.
--
-- Solução (padrão recomendado pelo Supabase): mover a checagem de "sou
-- membro deste bolão?" para uma função security definer, que não re-aplica
-- a RLS de membros_bolao ao ser avaliada dentro da policy.
-- =====================================================================

-- 1. Função auxiliar: o usuário é membro do bolão informado?
create or replace function public.eh_membro_bolao(_bolao_id uuid, _uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membros_bolao
    where bolao_id = _bolao_id and usuario_id = _uid
  );
$$;

revoke all on function public.eh_membro_bolao(uuid, uuid) from public;
grant execute on function public.eh_membro_bolao(uuid, uuid) to authenticated;

-- 2. Recria a policy de SELECT em membros_bolao sem auto-referência direta
drop policy if exists "membros_select_autenticado" on public.membros_bolao;
drop policy if exists "membros_select_mesmo_bolao" on public.membros_bolao;
create policy "membros_select_mesmo_bolao" on public.membros_bolao
  for select to authenticated using (
    auth.uid() = usuario_id
    or public.eh_membro_bolao(membros_bolao.bolao_id, auth.uid())
    or exists (
      select 1 from public.boloes b
      where b.id = membros_bolao.bolao_id
        and (b.is_publico = true or b.criador_id = auth.uid())
    )
  );

-- 3. A policy de SELECT em boloes tinha o mesmo padrão de subselect em
--    membros_bolao; usa a mesma função para evitar problemas e ficar consistente.
drop policy if exists "boloes_select_autenticado" on public.boloes;
drop policy if exists "boloes_select_membro_ou_publico" on public.boloes;
create policy "boloes_select_membro_ou_publico" on public.boloes
  for select to authenticated using (
    is_publico = true
    or auth.uid() = criador_id
    or public.eh_membro_bolao(id, auth.uid())
  );

-- 4. Recria a RPC de entrada com nomes de coluna explícitos no INSERT.
--    A versão anterior podia disparar:
--      ERROR: column "v_uid" of relation "membros_bolao" does not exist
--    quando o parser tratava a variável como nome de coluna. Aqui usamos a
--    forma INSERT ... SELECT com colunas-alvo qualificadas, sem ambiguidade.
create or replace function public.entrar_bolao_por_codigo(_codigo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bolao_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Você precisa estar logado.' using errcode = '28000';
  end if;

  select b.id into v_bolao_id
  from public.boloes b
  where upper(b.codigo_convite) = upper(_codigo);

  if v_bolao_id is null then
    raise exception 'Código de convite inválido.' using errcode = 'P0002';
  end if;

  insert into public.membros_bolao as mb (bolao_id, usuario_id)
  select v_bolao_id, v_uid
  on conflict (bolao_id, usuario_id) do nothing;

  return v_bolao_id;
end; $$;

revoke all on function public.entrar_bolao_por_codigo(text) from public;
grant execute on function public.entrar_bolao_por_codigo(text) to authenticated;
