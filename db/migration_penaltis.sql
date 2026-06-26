-- =====================================================================
-- BolãoEEL — Disputa de pênaltis no mata-mata
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente.
--
-- Problema:
--   Jogo de mata-mata decidido nos pênaltis chega da FIFA como EMPATE no
--   tempo (ex.: 1–1), com o vencedor em campos separados (Winner /
--   HomeTeamPenaltyScore / AwayTeamPenaltyScore). Sem capturar isso, o
--   bracket não sabe quem avançou (empate => sem vencedor).
--
-- Solução:
--   Guardar o placar da disputa de pênaltis. O front decide o vencedor do
--   confronto pelos pênaltis quando o tempo normal/prorrogação empata.
--   A pontuação do bolão (placar de 90/120 min) NÃO muda.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Colunas de pênaltis. NULL = jogo não foi à disputa de pênaltis.
-- ---------------------------------------------------------------------
alter table public.partidas add column if not exists penaltis_mandante  int;
alter table public.partidas add column if not exists penaltis_visitante int;

-- ---------------------------------------------------------------------
-- 2. Recria sync_resultado_partida aceitando o placar dos pênaltis.
--    Dropa a assinatura antiga (5 args) p/ evitar ambiguidade.
-- ---------------------------------------------------------------------
drop function if exists public.sync_resultado_partida(text, text, text, int, int);

create or replace function public.sync_resultado_partida(
  _fifa_match_id text,
  _home_fifa_id  text,
  _away_fifa_id  text,
  _home_score    int,
  _away_score    int,
  _home_penaltis int default null,
  _away_penaltis int default null
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
  v_pm      int;
  v_pv      int;
begin
  -- Seleções pelos IDs FIFA (seed em selecoes.fifa_team_id).
  select id into v_home from public.selecoes where fifa_team_id = _home_fifa_id;
  select id into v_away from public.selecoes where fifa_team_id = _away_fifa_id;
  if v_home is null or v_away is null then
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
    return 'no_partida';
  end if;

  -- Orienta gols e pênaltis para o NOSSO mandante/visitante.
  if v_partida.mandante_id = v_home then
    v_gm := _home_score;    v_gv := _away_score;
    v_pm := _home_penaltis; v_pv := _away_penaltis;
  else
    v_gm := _away_score;    v_gv := _home_score;
    v_pm := _away_penaltis; v_pv := _home_penaltis;
  end if;

  -- Idempotência: nada mudou => não reescreve nem recalcula.
  if v_partida.status = 'finalizada'
     and v_partida.gols_mandante     is not distinct from v_gm
     and v_partida.gols_visitante    is not distinct from v_gv
     and v_partida.penaltis_mandante  is not distinct from v_pm
     and v_partida.penaltis_visitante is not distinct from v_pv
     and v_partida.fifa_match_id is not distinct from _fifa_match_id then
    return 'skipped';
  end if;

  update public.partidas
     set gols_mandante      = v_gm,
         gols_visitante     = v_gv,
         penaltis_mandante  = v_pm,
         penaltis_visitante = v_pv,
         status             = 'finalizada',
         fifa_match_id      = _fifa_match_id,
         atualizada_em      = now()
   where id = v_partida.id;

  -- Reaproveita a pontuação existente (placar de 90/120 min; pênaltis não pontuam).
  perform public.calcular_pontos_partida(v_partida.id);

  return 'updated';
end;
$$;

revoke all on function public.sync_resultado_partida(text, text, text, int, int, int, int) from public;
grant execute on function public.sync_resultado_partida(text, text, text, int, int, int, int) to service_role;

commit;

-- =====================================================================
-- Verificação rápida (opcional):
--   select fase, gols_mandante, gols_visitante, penaltis_mandante, penaltis_visitante
--     from public.partidas where penaltis_mandante is not null;
-- =====================================================================
