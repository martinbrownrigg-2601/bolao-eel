-- =====================================================================
-- BolãoEEL — Pontuação de pênaltis no mata-mata (+2/0, sem consolação)
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente.
--
-- Regra:
--   Base (como hoje): 7 placar exato · 5 resultado certo · 0 errou.
--   +2 SOMENTE quando: o jogo foi decidido nos pênaltis E o usuário cravou
--   empate (acertou o resultado) E apontou o vencedor certo dos pênaltis.
--   Sem ponto negativo, sem consolação.
--
-- Depende de partidas.penaltis_mandante/penaltis_visitante (migration_penaltis.sql).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Quem o usuário acha que passa nos pênaltis. NULL fora desse caso.
--    Segue o padrão da tabela: chaveada por (usuario_id, partida_id).
-- ---------------------------------------------------------------------
alter table public.palpites
  add column if not exists vencedor_penaltis_id uuid
    references public.selecoes(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Recria a pontuação somando o +2 do mata-mata. Mesma assinatura
--    (create or replace) — mantém grants existentes.
-- ---------------------------------------------------------------------
create or replace function public.calcular_pontos_partida(_partida_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_gm int; v_gv int; v_pm int; v_pv int;
  v_mand uuid; v_vis uuid; v_resultado text; v_pen_winner uuid;
begin
  select gols_mandante, gols_visitante, penaltis_mandante, penaltis_visitante,
         mandante_id, visitante_id
    into v_gm, v_gv, v_pm, v_pv, v_mand, v_vis
    from public.partidas where id = _partida_id;
  if v_gm is null or v_gv is null then
    update public.palpites set pontos_ganhos = null where partida_id = _partida_id;
    return;
  end if;
  v_resultado := case when v_gm > v_gv then 'M' when v_gm < v_gv then 'V' else 'E' end;

  -- Seleção vencedora dos pênaltis (NULL se o jogo não foi à disputa).
  v_pen_winner := case
    when v_pm is null or v_pv is null then null
    when v_pm > v_pv then v_mand
    when v_pv > v_pm then v_vis
    else null end;

  update public.palpites pal set pontos_ganhos =
    -- Base (placar de 90/120 min): 7 exato · 5 resultado · 0 errou.
    (case
       when pal.gols_mandante = v_gm and pal.gols_visitante = v_gv then 7
       when (case when pal.gols_mandante > pal.gols_visitante then 'M'
                  when pal.gols_mandante < pal.gols_visitante then 'V'
                  else 'E' end) = v_resultado then 5
       else 0
     end)
    -- +2: jogo nos pênaltis E palpite empate E acertou quem passa.
    + (case
         when v_pen_winner is not null
          and pal.gols_mandante = pal.gols_visitante
          and pal.vencedor_penaltis_id = v_pen_winner
         then 2 else 0 end)
  where pal.partida_id = _partida_id;
end; $$;

commit;

-- ---------------------------------------------------------------------
-- Backfill opcional (recalcula jogos de pênaltis já finalizados).
-- Hoje não há nenhum (fase de grupos), mas é seguro rodar:
--   select public.calcular_pontos_partida(id)
--     from public.partidas where penaltis_mandante is not null;
-- ---------------------------------------------------------------------
