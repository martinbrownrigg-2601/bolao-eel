-- =====================================================================
-- BolãoEEL — Placar ao vivo (somente referência visual)
-- Execute no SQL Editor do Supabase DEPOIS de migration_sync_resultados.sql.
-- Idempotente.
--
-- ISOLAMENTO TOTAL DA PONTUAÇÃO:
--   Esta tabela NÃO tem trigger e NÃO chama calcular_pontos_partida.
--   O placar oficial/final e os pontos continuam vindo de `partidas` via
--   sync-resultados. Aqui guardamos apenas o placar PARCIAL ao vivo, lido
--   somente pela UI. Nada aqui afeta o bolão.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabela do placar ao vivo (1 linha por partida).
-- ---------------------------------------------------------------------
create table if not exists public.placares_ao_vivo (
  partida_id          uuid primary key references public.partidas(id) on delete cascade,
  gols_mandante_live  int,
  gols_visitante_live int,
  minuto              text,           -- ex.: "67'", "Intervalo"
  ao_vivo             boolean not null default true,
  atualizado_em       timestamptz not null default now()
);

grant select on public.placares_ao_vivo to anon, authenticated;
grant all    on public.placares_ao_vivo to service_role;
alter table public.placares_ao_vivo enable row level security;

-- Leitura pública (igual a partidas); escrita só via service_role (Edge Function).
drop policy if exists "placares_live_select_publico" on public.placares_ao_vivo;
create policy "placares_live_select_publico" on public.placares_ao_vivo
  for select using (true);

-- ---------------------------------------------------------------------
-- 2. RPC de upsert chamada pela Edge Function (service_role).
--    Resolve a partida pelo par de seleções (via fifa_team_id) OU pelo
--    fifa_match_id já gravado, sem nunca tocar em public.partidas.
--    _ao_vivo=false marca a linha como encerrada (jogo acabou).
-- ---------------------------------------------------------------------
create or replace function public.upsert_placar_ao_vivo(
  _fifa_match_id text,
  _home_fifa_id  text,
  _away_fifa_id  text,
  _home_score    int,
  _away_score    int,
  _minuto        text,
  _ao_vivo       boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partida public.partidas%rowtype;
  v_home uuid;
  v_away uuid;
  v_gm int;
  v_gv int;
begin
  select id into v_home from public.selecoes where fifa_team_id = _home_fifa_id;
  select id into v_away from public.selecoes where fifa_team_id = _away_fifa_id;
  if v_home is null or v_away is null then
    return 'unmapped_team';
  end if;

  -- Casa pela âncora fifa_match_id; senão pelo par de seleções (não-finalizada
  -- mais próxima na data). NÃO altera partidas — só localiza a linha.
  select * into v_partida from public.partidas where fifa_match_id = _fifa_match_id;
  if v_partida.id is null then
    select * into v_partida
      from public.partidas
     where status <> 'finalizada'
       and (
            (mandante_id = v_home and visitante_id = v_away)
         or (mandante_id = v_away and visitante_id = v_home)
       )
     order by abs(extract(epoch from (coalesce(data_hora, now()) - now())))
     limit 1;
  end if;

  if v_partida.id is null then
    return 'no_partida';
  end if;

  -- Orienta os gols para o NOSSO mandante/visitante.
  if v_partida.mandante_id = v_home then
    v_gm := _home_score; v_gv := _away_score;
  else
    v_gm := _away_score; v_gv := _home_score;
  end if;

  insert into public.placares_ao_vivo as l
    (partida_id, gols_mandante_live, gols_visitante_live, minuto, ao_vivo, atualizado_em)
  values
    (v_partida.id, v_gm, v_gv, _minuto, _ao_vivo, now())
  on conflict (partida_id) do update set
    gols_mandante_live  = excluded.gols_mandante_live,
    gols_visitante_live = excluded.gols_visitante_live,
    minuto              = excluded.minuto,
    ao_vivo             = excluded.ao_vivo,
    atualizado_em       = now();

  return 'updated';
end;
$$;

revoke all on function public.upsert_placar_ao_vivo(text, text, text, int, int, text, boolean) from public;
grant execute on function public.upsert_placar_ao_vivo(text, text, text, int, int, text, boolean) to service_role;

commit;

-- =====================================================================
-- Verificação:
--   select * from public.placares_ao_vivo where ao_vivo;   -- jogos em andamento
-- =====================================================================
