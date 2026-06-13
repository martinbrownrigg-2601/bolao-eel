-- =====================================================================
-- BolãoEEL — Palpites extras: Artilheiro + Seleção Campeã
-- Prazo fixo: 13/06/2026 às 15h (Brasília / UTC-3) = 18:00 UTC
-- Execute DEPOIS de migration_jogadores.sql.
-- =====================================================================

begin;

-- -----------------------------------------------------------------------
-- 1. Tabela palpites_extras
-- -----------------------------------------------------------------------
create table if not exists public.palpites_extras (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  bolao_id       uuid not null references public.boloes(id) on delete cascade,
  artilheiro_id  uuid references public.jogadores(id) on delete set null,
  campeao_id     uuid references public.selecoes(id) on delete set null,
  pontos_ganhos  int,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (usuario_id, bolao_id)
);

-- -----------------------------------------------------------------------
-- 2. Trigger de atualizado_em (mesmo padrão de palpites)
-- -----------------------------------------------------------------------
create or replace function public.touch_palpite_extra()
  returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end; $$;

drop trigger if exists palpites_extras_touch on public.palpites_extras;
create trigger palpites_extras_touch
  before update on public.palpites_extras
  for each row execute function public.touch_palpite_extra();

-- -----------------------------------------------------------------------
-- 3. Função de prazo (retorna true se ainda está aberto para palpites)
-- -----------------------------------------------------------------------
create or replace function public.palpites_extras_abertos()
  returns boolean language sql stable as $$
  select now() < '2026-06-13 18:00:00+00'::timestamptz;
$$;

-- -----------------------------------------------------------------------
-- 4. RLS
-- -----------------------------------------------------------------------
alter table public.palpites_extras enable row level security;

-- Usuário lê seus próprios palpites (sempre)
drop policy if exists "usuario le proprio" on public.palpites_extras;
create policy "usuario le proprio" on public.palpites_extras
  for select using (auth.uid() = usuario_id);

-- Após o prazo, membros do mesmo bolão veem os palpites dos outros
drop policy if exists "membros do bolao apos prazo" on public.palpites_extras;
create policy "membros do bolao apos prazo" on public.palpites_extras
  for select using (
    not public.palpites_extras_abertos()
    and exists (
      select 1 from public.membros_bolao mb
      where mb.bolao_id = palpites_extras.bolao_id
        and mb.usuario_id = auth.uid()
    )
  );

-- Admin lê tudo
drop policy if exists "admin le tudo" on public.palpites_extras;
create policy "admin le tudo" on public.palpites_extras
  for select using (
    exists (select 1 from public.perfis where id = auth.uid() and is_admin)
  );

-- Inserir se prazo aberto
drop policy if exists "inserir se aberto" on public.palpites_extras;
create policy "inserir se aberto" on public.palpites_extras
  for insert with check (
    auth.uid() = usuario_id
    and public.palpites_extras_abertos()
  );

-- Atualizar se prazo aberto
drop policy if exists "atualizar se aberto" on public.palpites_extras;
create policy "atualizar se aberto" on public.palpites_extras
  for update using (auth.uid() = usuario_id)
  with check (public.palpites_extras_abertos());

-- -----------------------------------------------------------------------
-- 5. RPC admin: calcular pontos extras
-- -----------------------------------------------------------------------
create or replace function public.calcular_pontos_extras(
  _artilheiro_real_id uuid,
  _campeao_real_id    uuid
) returns void language plpgsql security definer as $$
begin
  if not exists (
    select 1 from public.perfis where id = auth.uid() and is_admin
  ) then
    raise exception 'acesso negado';
  end if;

  update public.palpites_extras set
    pontos_ganhos = (
      case when artilheiro_id = _artilheiro_real_id then 15 else 0 end
      + case when campeao_id  = _campeao_real_id    then 15 else 0 end
    );
end;
$$;

-- -----------------------------------------------------------------------
-- 6. View atualizada de pontuação (inclui pontos extras)
-- -----------------------------------------------------------------------
create or replace view public.v_pontuacao_usuario as
  select
    p.usuario_id,
    (
      coalesce(sum(p.pontos_ganhos), 0)
      + coalesce((
          select pe.pontos_ganhos
          from public.palpites_extras pe
          where pe.usuario_id = p.usuario_id
          limit 1
        ), 0)
    )::int as pontos_total,
    count(*) filter (where p.pontos_ganhos is not null)::int as jogos_pontuados,
    count(*)::int as palpites_total
  from public.palpites p
  group by p.usuario_id;

grant select on public.v_pontuacao_usuario to authenticated;
grant select on public.palpites_extras to authenticated;
grant execute on function public.palpites_extras_abertos() to authenticated;
grant execute on function public.calcular_pontos_extras(uuid, uuid) to authenticated;

commit;
