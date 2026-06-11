-- =====================================================================
-- BolãoEEL — Mata-mata + trava de palpites por horário
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente.
--
-- Inclui:
--  1. Trava automática de palpites pelo horário do jogo (data_hora).
--     Agora o palpite fecha sozinho quando o jogo começa, sem depender
--     do admin mudar o status para 'em_andamento'.
--  2. RPC admin para criar/editar partidas do mata-mata (oitavas..final).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Fase "32 avos" (Round of 32) — formato de 48 seleções.
--    ALTER TYPE ... ADD VALUE não roda dentro de bloco de transação,
--    por isso vem antes de qualquer begin/do. É idempotente via IF NOT EXISTS.
-- ---------------------------------------------------------------------
alter type fase_partida add value if not exists 'trinta_e_dois_avos' after 'grupos';

-- ---------------------------------------------------------------------
-- 1. Trava de palpites por horário
--    Regras: a partida precisa estar 'aguardando' E ainda não ter
--    começado (data_hora no futuro, ou nula = "a definir" -> liberado).
-- ---------------------------------------------------------------------
create or replace function public.partida_aberta_para_palpite(_partida_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.partidas p
    where p.id = _partida_id
      and p.status = 'aguardando'
      and (p.data_hora is null or p.data_hora > now())
  );
$$;

revoke all on function public.partida_aberta_para_palpite(uuid) from public;
grant execute on function public.partida_aberta_para_palpite(uuid) to authenticated, service_role;

-- Substitui as policies de insert/update de palpites para usar o horário.
drop policy if exists "palpites_insert_proprio" on public.palpites;
create policy "palpites_insert_proprio" on public.palpites
  for insert with check (
    auth.uid() = usuario_id
    and public.partida_aberta_para_palpite(partida_id)
  );

drop policy if exists "palpites_update_proprio" on public.palpites;
create policy "palpites_update_proprio" on public.palpites
  for update using (
    auth.uid() = usuario_id
    and public.partida_aberta_para_palpite(partida_id)
  ) with check (auth.uid() = usuario_id);

-- ---------------------------------------------------------------------
-- 2. RPC admin: criar/atualizar partida do mata-mata
--    Recebe códigos de seleção (mais simples para o front).
--    Retorna o id da partida criada/atualizada.
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_partida(
  _fase fase_partida,
  _mandante_codigo text,
  _visitante_codigo text,
  _data_hora timestamptz default null,
  _estadio text default null,
  _rodada int default null,
  _partida_id uuid default null
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
    values (_fase, null, _rodada, _data_hora, _estadio, v_mandante, v_visitante, 'aguardando')
    returning id into v_id;
  else
    update public.partidas
       set fase = _fase, rodada = _rodada, data_hora = _data_hora, estadio = _estadio,
           mandante_id = v_mandante, visitante_id = v_visitante,
           atualizada_em = now()
     where id = v_id;
  end if;

  return v_id;
end; $$;

revoke all on function public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid) from public;
grant execute on function public.admin_upsert_partida(fase_partida, text, text, timestamptz, text, int, uuid) to authenticated, service_role;
