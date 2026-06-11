-- =====================================================================
-- BolãoEEL — CRUD completo de partidas (admin)
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente.
--
-- Estende admin_upsert_partida para:
--   * receber _grupo (necessário para editar partidas da fase de grupos);
--   * servir tanto para criar quanto editar QUALQUER partida.
-- Adiciona admin_delete_partida.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Upsert de partida (criar/editar) — agora com _grupo.
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_partida(
  _fase fase_partida,
  _mandante_codigo text,
  _visitante_codigo text,
  _data_hora timestamptz default null,
  _estadio text default null,
  _rodada int default null,
  _partida_id uuid default null,
  _grupo text default null
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
    insert into public.partidas (fase, grupo, rodada, data_hora, estadio, mandante_id, visitante_id, status)
    values (_fase, v_grupo, _rodada, _data_hora, _estadio, v_mandante, v_visitante, 'aguardando')
    returning id into v_id;
  else
    update public.partidas
       set fase = _fase, grupo = v_grupo, rodada = _rodada, data_hora = _data_hora, estadio = _estadio,
           mandante_id = v_mandante, visitante_id = v_visitante,
           atualizada_em = now()
     where id = v_id;
  end if;

  return v_id;
end; $$;

revoke all on function public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid, text) from public;
grant execute on function public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Delete de partida. Palpites associados caem em cascata (FK on delete cascade).
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_partida(_partida_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.eh_admin(auth.uid()) then
    raise exception 'Apenas administradores.' using errcode = '42501';
  end if;
  delete from public.partidas where id = _partida_id;
end; $$;

revoke all on function public.admin_delete_partida(uuid) from public;
grant execute on function public.admin_delete_partida(uuid) to authenticated, service_role;
