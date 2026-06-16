-- =====================================================================
-- BolãoEEL — Sincronização automática de resultados (FIFA 2026)
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente: pode rodar mais de uma vez.
--
-- Preenche placar/status das partidas automaticamente a partir da API
-- pública da FIFA, sem substituir o preenchimento manual do admin (que
-- continua como fallback). A pontuação NÃO muda: reaproveita a RPC
-- existente public.calcular_pontos_partida (migration_inicial.sql).
--
-- Fluxo:
--   Edge Function "sync-resultados" busca os jogos encerrados na FIFA e,
--   para cada um, chama sync_resultado_partida (service_role) que grava o
--   placar + status e dispara o recálculo dos palpites.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Colunas de mapeamento FIFA <-> nossas tabelas.
--    Ficam NULL até o seed; por isso índices únicos PARCIAIS.
-- ---------------------------------------------------------------------
alter table public.selecoes add column if not exists fifa_team_id text;
alter table public.partidas add column if not exists fifa_match_id text;

create unique index if not exists selecoes_fifa_team_id_key
  on public.selecoes(fifa_team_id) where fifa_team_id is not null;
create unique index if not exists partidas_fifa_match_id_key
  on public.partidas(fifa_match_id) where fifa_match_id is not null;

-- ---------------------------------------------------------------------
-- 2. RPC chamada pela Edge Function (service_role) para gravar 1 jogo.
--    Resolve a partida, orienta os gols ao NOSSO mandante/visitante,
--    grava e recalcula os palpites. Idempotente.
--
--    Retornos: 'updated' | 'skipped' | 'no_partida' | 'unmapped_team'
-- ---------------------------------------------------------------------
create or replace function public.sync_resultado_partida(
  _fifa_match_id text,
  _home_fifa_id  text,
  _away_fifa_id  text,
  _home_score    int,
  _away_score    int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partida public.partidas%rowtype;
  v_home    uuid;
  v_away    uuid;
  v_gm      int;
  v_gv      int;
begin
  -- Seleções pelos IDs FIFA (seed em selecoes.fifa_team_id).
  select id into v_home from public.selecoes where fifa_team_id = _home_fifa_id;
  select id into v_away from public.selecoes where fifa_team_id = _away_fifa_id;
  if v_home is null or v_away is null then
    -- Time ainda não mapeado (ou placeholder de mata-mata). Ignora sem erro.
    return 'unmapped_team';
  end if;

  -- (a) Já ancorado por fifa_match_id? casa direto (idempotência).
  select * into v_partida from public.partidas where fifa_match_id = _fifa_match_id;

  -- (b) Senão, casa pelo par de seleções (qualquer orientação), pegando a
  --     partida ainda não-finalizada mais próxima da data atual.
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
    -- Mata-mata cujos times ainda não foram cadastrados, etc. Ignora.
    return 'no_partida';
  end if;

  -- Orienta os gols para o NOSSO mandante/visitante.
  if v_partida.mandante_id = v_home then
    v_gm := _home_score; v_gv := _away_score;
  else
    v_gm := _away_score; v_gv := _home_score;
  end if;

  -- Idempotência: nada mudou => não reescreve nem recalcula.
  if v_partida.status = 'finalizada'
     and v_partida.gols_mandante is not distinct from v_gm
     and v_partida.gols_visitante is not distinct from v_gv
     and v_partida.fifa_match_id is not distinct from _fifa_match_id then
    return 'skipped';
  end if;

  update public.partidas
     set gols_mandante  = v_gm,
         gols_visitante = v_gv,
         status         = 'finalizada',
         fifa_match_id  = _fifa_match_id,
         atualizada_em  = now()
   where id = v_partida.id;

  -- Reaproveita a lógica de pontuação existente (sem alteração).
  perform public.calcular_pontos_partida(v_partida.id);

  return 'updated';
end;
$$;

-- Só a service_role (Edge Function) pode chamar — clientes não forjam placar.
revoke all on function public.sync_resultado_partida(text, text, text, int, int) from public;
grant execute on function public.sync_resultado_partida(text, text, text, int, int) to service_role;

-- ---------------------------------------------------------------------
-- 3. RPC para o botão "Sincronizar agora" do admin.
--    Dispara a Edge Function via pg_net, com a URL e o segredo lidos do
--    Supabase Vault (nunca vão ao navegador). Requer admin.
--
--    Configure uma vez (substitua o segredo) com:
--      select vault.create_secret(
--        'https://<ref>.functions.supabase.co/sync-resultados', 'sync_url');
--      select vault.create_secret(
--        '<MESMO SYNC_SHARED_SECRET da Edge Function>', 'sync_secret');
--    (para atualizar depois, use vault.update_secret pelo id)
-- ---------------------------------------------------------------------
create or replace function public.admin_disparar_sync()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
  v_req_id bigint;
begin
  if not public.eh_admin(auth.uid()) then
    raise exception 'Apenas administradores.' using errcode = '42501';
  end if;

  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_secret';
  if v_url is null or v_url = '' then
    raise exception 'Configure o segredo sync_url no Vault (veja migration_sync_resultados.sql).';
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sync-secret', coalesce(v_secret, '')
               ),
    body    := '{}'::jsonb
  ) into v_req_id;

  return v_req_id;  -- id da requisição em net._http_response (assíncrona)
end;
$$;

revoke all on function public.admin_disparar_sync() from public;
grant execute on function public.admin_disparar_sync() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. SEED do mapeamento dos 48 times (fifa_team_id).
--    Gerado pelo script scripts/seed_fifa_team_ids.mjs (casa pela
--    abreviação de 3 letras da FIFA -> selecoes.codigo).
-- ---------------------------------------------------------------------
-- Gerado por scripts/seed_fifa_team_ids.mjs (idSeason=285023) — 48/48 casados.
update public.selecoes as s set fifa_team_id = v.fid
from (values
  ('ALG','43843'),
  ('ARG','43922'),
  ('AUS','43976'),
  ('AUT','43934'),
  ('BEL','43935'),
  ('BIH','44037'),
  ('BRA','43924'),
  ('CAN','43899'),
  ('CIV','43854'),
  ('COD','20014'),
  ('COL','43926'),
  ('CPV','43850'),
  ('CRO','43938'),
  ('CUW','1895293'),
  ('CZE','43995'),
  ('ECU','43927'),
  ('EGY','43855'),
  ('ENG','43942'),
  ('ESP','43969'),
  ('FRA','43946'),
  ('GER','43948'),
  ('GHA','43860'),
  ('HAI','43908'),
  ('IRN','43817'),
  ('IRQ','43818'),
  ('JOR','43820'),
  ('JPN','43819'),
  ('KOR','43822'),
  ('KSA','43835'),
  ('MAR','43872'),
  ('MEX','43911'),
  ('NED','43960'),
  ('NOR','43961'),
  ('NZL','43978'),
  ('PAN','43914'),
  ('PAR','43928'),
  ('POR','43963'),
  ('QAT','43834'),
  ('RSA','43883'),
  ('SCO','43967'),
  ('SEN','43879'),
  ('SUI','43971'),
  ('SWE','43970'),
  ('TUN','43888'),
  ('TUR','43972'),
  ('URU','43930'),
  ('USA','43921'),
  ('UZB','44005')
) as v(cod, fid)
where s.codigo = v.cod;

commit;

-- =====================================================================
-- Verificação rápida (opcional):
--   select codigo, fifa_team_id from public.selecoes where fifa_team_id is null;  -- deve ficar vazio após o seed
--   select count(*) from public.partidas where fifa_match_id is not null;          -- cresce conforme os jogos sincronizam
-- =====================================================================
