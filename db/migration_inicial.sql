-- =====================================================================
-- BolãoEEL — Migration completa (PostgreSQL / Supabase)
-- Execute este arquivo no SQL Editor do seu projeto Supabase externo.
-- Idempotente: pode ser rodado várias vezes sem erro.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. perfis
-- =====================================================================
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_usuario text unique not null,
  nome_exibicao text,
  avatar_url text,
  is_admin boolean not null default false,
  criado_em timestamptz not null default now()
);

grant select on public.perfis to anon, authenticated;
grant insert, update on public.perfis to authenticated;
grant all on public.perfis to service_role;

alter table public.perfis enable row level security;

drop policy if exists "perfis_select_publico" on public.perfis;
create policy "perfis_select_publico" on public.perfis for select using (true);

drop policy if exists "perfis_update_proprio" on public.perfis;
create policy "perfis_update_proprio" on public.perfis
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "perfis_insert_proprio" on public.perfis;
create policy "perfis_insert_proprio" on public.perfis
  for insert with check (auth.uid() = id);

create or replace function public.eh_admin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.perfis where id = _uid), false);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  v_nome := coalesce(new.raw_user_meta_data->>'nome_usuario', split_part(new.email, '@', 1));
  while exists (select 1 from public.perfis where nome_usuario = v_nome) loop
    v_nome := v_nome || floor(random() * 1000)::text;
  end loop;
  insert into public.perfis (id, nome_usuario) values (new.id, v_nome);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 2. selecoes
-- =====================================================================
create table if not exists public.selecoes (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  nome text not null,
  bandeira text,
  grupo text
);

grant select on public.selecoes to anon, authenticated;
grant all on public.selecoes to service_role;
alter table public.selecoes enable row level security;

drop policy if exists "selecoes_select_publico" on public.selecoes;
create policy "selecoes_select_publico" on public.selecoes for select using (true);

drop policy if exists "selecoes_admin_escrita" on public.selecoes;
create policy "selecoes_admin_escrita" on public.selecoes
  for all using (public.eh_admin(auth.uid())) with check (public.eh_admin(auth.uid()));

-- =====================================================================
-- 3. partidas
-- =====================================================================
do $$ begin
  create type fase_partida as enum ('grupos','oitavas','quartas','semifinais','disputa_terceiro','final');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_partida as enum ('aguardando','em_andamento','finalizada');
exception when duplicate_object then null; end $$;

create table if not exists public.partidas (
  id uuid primary key default gen_random_uuid(),
  fase fase_partida not null,
  grupo text,
  rodada int,
  data_hora timestamptz,
  estadio text,
  mandante_id uuid not null references public.selecoes(id),
  visitante_id uuid not null references public.selecoes(id),
  gols_mandante int,
  gols_visitante int,
  status status_partida not null default 'aguardando',
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create index if not exists partidas_fase_idx on public.partidas(fase);
create index if not exists partidas_data_idx on public.partidas(data_hora);

grant select on public.partidas to anon, authenticated;
grant all on public.partidas to service_role;
alter table public.partidas enable row level security;

drop policy if exists "partidas_select_publico" on public.partidas;
create policy "partidas_select_publico" on public.partidas for select using (true);

drop policy if exists "partidas_admin_escrita" on public.partidas;
create policy "partidas_admin_escrita" on public.partidas
  for all using (public.eh_admin(auth.uid())) with check (public.eh_admin(auth.uid()));

-- =====================================================================
-- 4. palpites
-- =====================================================================
create table if not exists public.palpites (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  partida_id uuid not null references public.partidas(id) on delete cascade,
  gols_mandante int not null check (gols_mandante >= 0),
  gols_visitante int not null check (gols_visitante >= 0),
  pontos_ganhos int,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (usuario_id, partida_id)
);

create index if not exists palpites_usuario_idx on public.palpites(usuario_id);
create index if not exists palpites_partida_idx on public.palpites(partida_id);

grant select, insert, update, delete on public.palpites to authenticated;
grant all on public.palpites to service_role;
alter table public.palpites enable row level security;

drop policy if exists "palpites_select_proprio" on public.palpites;
create policy "palpites_select_proprio" on public.palpites
  for select using (auth.uid() = usuario_id);

drop policy if exists "palpites_insert_proprio" on public.palpites;
create policy "palpites_insert_proprio" on public.palpites
  for insert with check (
    auth.uid() = usuario_id
    and exists (select 1 from public.partidas p where p.id = partida_id and p.status = 'aguardando')
  );

drop policy if exists "palpites_update_proprio" on public.palpites;
create policy "palpites_update_proprio" on public.palpites
  for update using (
    auth.uid() = usuario_id
    and exists (select 1 from public.partidas p where p.id = partida_id and p.status = 'aguardando')
  ) with check (auth.uid() = usuario_id);

drop policy if exists "palpites_delete_proprio" on public.palpites;
create policy "palpites_delete_proprio" on public.palpites
  for delete using (auth.uid() = usuario_id);

create or replace function public.touch_palpite()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end; $$;

drop trigger if exists palpites_touch on public.palpites;
create trigger palpites_touch before update on public.palpites
  for each row execute function public.touch_palpite();

-- =====================================================================
-- 5. cálculo de pontos (5 = resultado, 7 = placar exato)
-- =====================================================================
create or replace function public.calcular_pontos_partida(_partida_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_gm int; v_gv int; v_resultado text;
begin
  select gols_mandante, gols_visitante into v_gm, v_gv from public.partidas where id = _partida_id;
  if v_gm is null or v_gv is null then
    update public.palpites set pontos_ganhos = null where partida_id = _partida_id;
    return;
  end if;
  v_resultado := case when v_gm > v_gv then 'M' when v_gm < v_gv then 'V' else 'E' end;
  update public.palpites pal set pontos_ganhos =
    case
      when pal.gols_mandante = v_gm and pal.gols_visitante = v_gv then 7
      when (case when pal.gols_mandante > pal.gols_visitante then 'M'
                 when pal.gols_mandante < pal.gols_visitante then 'V'
                 else 'E' end) = v_resultado then 5
      else 0
    end
  where pal.partida_id = _partida_id;
end; $$;

revoke all on function public.calcular_pontos_partida(uuid) from public;
grant execute on function public.calcular_pontos_partida(uuid) to authenticated, service_role;

-- =====================================================================
-- 6. boloes
-- =====================================================================
create table if not exists public.boloes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  codigo_convite text unique not null default upper(substr(md5(random()::text), 1, 6)),
  criador_id uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

grant select, insert, update, delete on public.boloes to authenticated;
grant all on public.boloes to service_role;
alter table public.boloes enable row level security;

drop policy if exists "boloes_select_autenticado" on public.boloes;
create policy "boloes_select_autenticado" on public.boloes for select to authenticated using (true);

drop policy if exists "boloes_insert_proprio" on public.boloes;
create policy "boloes_insert_proprio" on public.boloes for insert with check (auth.uid() = criador_id);

drop policy if exists "boloes_update_criador" on public.boloes;
create policy "boloes_update_criador" on public.boloes for update using (auth.uid() = criador_id);

drop policy if exists "boloes_delete_criador" on public.boloes;
create policy "boloes_delete_criador" on public.boloes for delete using (auth.uid() = criador_id);

-- =====================================================================
-- 7. membros_bolao
-- =====================================================================
create table if not exists public.membros_bolao (
  bolao_id uuid not null references public.boloes(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  entrou_em timestamptz not null default now(),
  primary key (bolao_id, usuario_id)
);

grant select, insert, delete on public.membros_bolao to authenticated;
grant all on public.membros_bolao to service_role;
alter table public.membros_bolao enable row level security;

drop policy if exists "membros_select_autenticado" on public.membros_bolao;
create policy "membros_select_autenticado" on public.membros_bolao for select to authenticated using (true);

drop policy if exists "membros_insert_proprio" on public.membros_bolao;
create policy "membros_insert_proprio" on public.membros_bolao for insert with check (auth.uid() = usuario_id);

drop policy if exists "membros_delete_proprio" on public.membros_bolao;
create policy "membros_delete_proprio" on public.membros_bolao for delete using (auth.uid() = usuario_id);

-- =====================================================================
-- 8. SEED: 48 seleções
-- =====================================================================
insert into public.selecoes (codigo, nome, bandeira, grupo) values
  ('CAN','Canadá','🇨🇦','A'),('MEX','México','🇲🇽','A'),('CRC','Costa Rica','🇨🇷','A'),('SUI','Suíça','🇨🇭','A'),
  ('USA','Estados Unidos','🇺🇸','B'),('BEL','Bélgica','🇧🇪','B'),('SEN','Senegal','🇸🇳','B'),('AUS','Austrália','🇦🇺','B'),
  ('MAR','Marrocos','🇲🇦','C'),('CRO','Croácia','🇭🇷','C'),('JPN','Japão','🇯🇵','C'),('NOR','Noruega','🇳🇴','C'),
  ('ARG','Argentina','🇦🇷','D'),('NED','Holanda','🇳🇱','D'),('NGA','Nigéria','🇳🇬','D'),('CIV','Costa do Marfim','🇨🇮','D'),
  ('BRA','Brasil','🇧🇷','E'),('GER','Alemanha','🇩🇪','E'),('KOR','Coreia do Sul','🇰🇷','E'),('NZL','Nova Zelândia','🇳🇿','E'),
  ('FRA','França','🇫🇷','F'),('URU','Uruguai','🇺🇾','F'),('GHA','Gana','🇬🇭','F'),('IRN','Irã','🇮🇷','F'),
  ('ENG','Inglaterra','🏴󠁧󠁢󠁥󠁮󠁧󠁿','G'),('POL','Polônia','🇵🇱','G'),('ECU','Equador','🇪🇨','G'),('QAT','Catar','🇶🇦','G'),
  ('ESP','Espanha','🇪🇸','H'),('DEN','Dinamarca','🇩🇰','H'),('TUN','Tunísia','🇹🇳','H'),('SRB','Sérvia','🇷🇸','H'),
  ('POR','Portugal','🇵🇹','I'),('COL','Colômbia','🇨🇴','I'),('CMR','Camarões','🇨🇲','I'),('SVN','Eslovênia','🇸🇮','I'),
  ('ITA','Itália','🇮🇹','J'),('EGY','Egito','🇪🇬','J'),('SCO','Escócia','🏴󠁧󠁢󠁳󠁣󠁴󠁿','J'),('PAR','Paraguai','🇵🇾','J'),
  ('AUT','Áustria','🇦🇹','K'),('CHI','Chile','🇨🇱','K'),('TUR','Turquia','🇹🇷','K'),('UZB','Uzbequistão','🇺🇿','K'),
  ('ALG','Argélia','🇩🇿','L'),('JOR','Jordânia','🇯🇴','L'),('PAN','Panamá','🇵🇦','L'),('RSA','África do Sul','🇿🇦','L')
on conflict (codigo) do nothing;

-- =====================================================================
-- 9. SEED: partidas da fase de grupos (6 por grupo = 72)
-- =====================================================================
do $$
declare
  g text;
  team_ids uuid[];
  combos int[][] := ARRAY[ARRAY[1,2],ARRAY[3,4],ARRAY[1,3],ARRAY[2,4],ARRAY[4,1],ARRAY[2,3]];
  c int[];
  d_base date := '2026-06-11';
  grupo_idx int := 0;
  jogo_idx int;
begin
  for g in select unnest(array['A','B','C','D','E','F','G','H','I','J','K','L']) loop
    select array_agg(id order by codigo) into team_ids from public.selecoes where grupo = g;
    jogo_idx := 0;
    if array_length(team_ids,1) = 4 then
      foreach c slice 1 in array combos loop
        insert into public.partidas (fase, grupo, mandante_id, visitante_id, data_hora, status)
        select 'grupos', g, team_ids[c[1]], team_ids[c[2]],
               (d_base + (grupo_idx + (jogo_idx / 2) * 4))::timestamptz + ((13 + (jogo_idx % 2) * 3) || ' hours')::interval,
               'aguardando'
        where not exists (
          select 1 from public.partidas
          where fase = 'grupos' and grupo = g
            and mandante_id = team_ids[c[1]] and visitante_id = team_ids[c[2]]
        );
        jogo_idx := jogo_idx + 1;
      end loop;
    end if;
    grupo_idx := grupo_idx + 1;
  end loop;
end $$;

-- =====================================================================
-- 10. Realtime
-- =====================================================================
do $$ begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    begin alter publication supabase_realtime add table public.palpites; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.perfis;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.partidas; exception when duplicate_object then null; end;
  end if;
end $$;
