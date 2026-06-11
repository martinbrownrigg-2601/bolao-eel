-- =====================================================================
-- BolãoEEL — Tornar palpites visíveis aos demais membros do bolão
--            DEPOIS que o jogo começa.
-- Execute no SQL Editor do Supabase DEPOIS das migrations anteriores.
-- Idempotente.
--
-- Regra:
--  * Você sempre vê os SEUS palpites (qualquer jogo).
--  * Você vê o palpite de OUTRO usuário somente se:
--      1. a partida já FECHOU para palpites (jogo começou ou status
--         saiu de 'aguardando') — usa partida_aberta_para_palpite; e
--      2. vocês compartilham pelo menos UM bolão (membros_bolao).
--    Isso impede copiar palpite alheio antes do prazo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper: os dois usuários compartilham algum bolão?
--    security definer para não depender da RLS de membros_bolao
--    (que já restringe leitura ao próprio bolão).
-- ---------------------------------------------------------------------
create or replace function public.compartilham_bolao(_a uuid, _b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.membros_bolao ma
    join public.membros_bolao mb on mb.bolao_id = ma.bolao_id
    where ma.usuario_id = _a
      and mb.usuario_id = _b
  );
$$;

revoke all on function public.compartilham_bolao(uuid, uuid) from public;
grant execute on function public.compartilham_bolao(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Nova policy de SELECT em palpites
-- ---------------------------------------------------------------------
drop policy if exists "palpites_select_proprio" on public.palpites;
drop policy if exists "palpites_select_proprio_ou_membro" on public.palpites;
create policy "palpites_select_proprio_ou_membro" on public.palpites
  for select to authenticated using (
    auth.uid() = usuario_id
    or (
      -- jogo já fechou para palpites (NÃO está mais aberto)
      not public.partida_aberta_para_palpite(partida_id)
      -- e compartilhamos algum bolão
      and public.compartilham_bolao(auth.uid(), usuario_id)
    )
  );
