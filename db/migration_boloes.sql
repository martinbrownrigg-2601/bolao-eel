-- =====================================================================
-- BolãoEEL — Migration adicional: bolões com convite
-- Idempotente. Execute no SQL Editor depois da migration_inicial.sql.
-- =====================================================================

-- 1. Campos extras em boloes
alter table public.boloes add column if not exists is_publico boolean not null default false;

-- 2. Trigger: criador vira membro automaticamente
create or replace function public.adicionar_criador_como_membro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.membros_bolao (bolao_id, usuario_id)
  values (new.id, new.criador_id)
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists boloes_after_insert_membro on public.boloes;
create trigger boloes_after_insert_membro
  after insert on public.boloes
  for each row execute function public.adicionar_criador_como_membro();

-- 3. RPC: entrar em bolão por código (security definer evita expor membros_bolao)
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
  select id into v_bolao_id from public.boloes where upper(codigo_convite) = upper(_codigo);
  if v_bolao_id is null then
    raise exception 'Código de convite inválido.' using errcode = 'P0002';
  end if;
  insert into public.membros_bolao (bolao_id, usuario_id)
  values (v_bolao_id, v_uid)
  on conflict do nothing;
  return v_bolao_id;
end; $$;

revoke all on function public.entrar_bolao_por_codigo(text) from public;
grant execute on function public.entrar_bolao_por_codigo(text) to authenticated;

-- 4. Ajuste de policies: SELECT em boloes — só membros ou se for público
drop policy if exists "boloes_select_autenticado" on public.boloes;
drop policy if exists "boloes_select_membro_ou_publico" on public.boloes;
create policy "boloes_select_membro_ou_publico" on public.boloes
  for select to authenticated using (
    is_publico = true
    or auth.uid() = criador_id
    or exists (select 1 from public.membros_bolao mb where mb.bolao_id = id and mb.usuario_id = auth.uid())
  );

-- 5. Membros: SELECT apenas se o usuário é membro do mesmo bolão (ou criador)
drop policy if exists "membros_select_autenticado" on public.membros_bolao;
drop policy if exists "membros_select_mesmo_bolao" on public.membros_bolao;
create policy "membros_select_mesmo_bolao" on public.membros_bolao
  for select to authenticated using (
    auth.uid() = usuario_id
    or exists (
      select 1 from public.membros_bolao mb2
      where mb2.bolao_id = membros_bolao.bolao_id and mb2.usuario_id = auth.uid()
    )
    or exists (
      select 1 from public.boloes b
      where b.id = membros_bolao.bolao_id and (b.is_publico = true or b.criador_id = auth.uid())
    )
  );

-- 6. View pública de pontuação por usuário (soma de palpites)
create or replace view public.v_pontuacao_usuario as
  select usuario_id, coalesce(sum(pontos_ganhos), 0)::int as pontos_total,
         count(*) filter (where pontos_ganhos is not null)::int as jogos_pontuados,
         count(*)::int as palpites_total
  from public.palpites
  group by usuario_id;

grant select on public.v_pontuacao_usuario to authenticated;
