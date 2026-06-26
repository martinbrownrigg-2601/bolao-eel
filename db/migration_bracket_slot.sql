-- =====================================================================
-- BolãoEEL — Vínculo explícito partida ↔ slot do chaveamento (bracket_slot)
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente.
--
-- Problema que resolve:
--   O bracket associava cada partida real ao card por ORDEM de data_hora
--   dentro da fase. Isso era frágil (horário errado/ausente => card no slot
--   trocado) e, combinado com a projeção pela classificação, fazia o mesmo
--   time aparecer DUAS vezes (no card real + no slot "natural" projetado).
--
-- Solução:
--   Gravar o slotId do chaveamento (M73…M104) na própria partida. O front
--   passa esse slot ao criar a partida a partir do bracket e mapeia o card
--   por ele (com fallback cronológico para partidas antigas sem o vínculo).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Coluna de vínculo. NULL até a partida ser criada pelo bracket.
--    Índice único PARCIAL: cada slot do chaveamento aponta p/ no máx. 1 jogo.
-- ---------------------------------------------------------------------
alter table public.partidas add column if not exists bracket_slot text;

create unique index if not exists partidas_bracket_slot_key
  on public.partidas(bracket_slot) where bracket_slot is not null;

-- ---------------------------------------------------------------------
-- 2. Recria admin_upsert_partida com _bracket_slot.
--    Dropa os overloads antigos (7 e 8 args) p/ evitar ambiguidade.
-- ---------------------------------------------------------------------
drop function if exists public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid);
drop function if exists public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid, text);

create or replace function public.admin_upsert_partida(
  _fase fase_partida,
  _mandante_codigo text,
  _visitante_codigo text,
  _data_hora timestamptz default null,
  _estadio text default null,
  _rodada int default null,
  _partida_id uuid default null,
  _grupo text default null,
  _bracket_slot text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mandante uuid;
  v_visitante uuid;
  v_id uuid := _partida_id;
  v_grupo text := nullif(trim(_grupo), '');
  v_slot text := nullif(trim(_bracket_slot), '');
begin
  if not public.eh_admin(auth.uid()) then
    raise exception 'Apenas administradores.' using errcode = '42501';
  end if;

  select id into v_mandante  from public.selecoes where codigo = upper(_mandante_codigo);
  select id into v_visitante from public.selecoes where codigo = upper(_visitante_codigo);
  if v_mandante is null or v_visitante is null then
    raise exception 'Seleção inválida (% ou %).', _mandante_codigo, _visitante_codigo
      using errcode = 'P0002';
  end if;
  if v_mandante = v_visitante then
    raise exception 'Mandante e visitante não podem ser a mesma seleção.';
  end if;

  if v_id is null then
    insert into public.partidas (fase, grupo, rodada, data_hora, estadio, mandante_id, visitante_id, bracket_slot, status)
    values (_fase, v_grupo, _rodada, _data_hora, _estadio, v_mandante, v_visitante, v_slot, 'aguardando')
    returning id into v_id;
  else
    update public.partidas
       set fase = _fase, grupo = v_grupo, rodada = _rodada, data_hora = _data_hora, estadio = _estadio,
           mandante_id = v_mandante, visitante_id = v_visitante,
           -- Preserva o slot existente quando a edição não envia um novo
           -- (ex.: editar placar/horário pela lista do admin não apaga o vínculo).
           bracket_slot = coalesce(v_slot, bracket_slot),
           atualizada_em = now()
     where id = v_id;
  end if;

  return v_id;
end; $$;

revoke all on function public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid, text, text) from public;
grant execute on function public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid, text, text) to authenticated, service_role;

commit;

-- =====================================================================
-- Verificação rápida (opcional):
--   select bracket_slot, fase, mandante_id, visitante_id
--     from public.partidas where bracket_slot is not null order by bracket_slot;
-- =====================================================================
