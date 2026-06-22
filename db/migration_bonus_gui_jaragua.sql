-- =====================================================================
-- BolãoEEL — Bônus pontual: +100 pontos e palpites especiais
-- Usuário: gui_ulber@hotmail.com (7ec41775-c08b-41f2-b503-49366d59bfcc)
-- Bolão:   Organizada Jaraguá
-- Palpites especiais: Mbappé artilheiro / Inglaterra campeã
-- Idempotente: pode ser executada mais de uma vez sem duplicar efeitos.
-- =====================================================================

begin;

-- -----------------------------------------------------------------------
-- 1. Coluna de bônus manual em perfis (ajuste administrativo de pontos)
-- -----------------------------------------------------------------------
alter table public.perfis
  add column if not exists pontos_bonus int not null default 0;

-- -----------------------------------------------------------------------
-- 2. View de pontuação passa a somar o bônus manual
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
      + coalesce((
          select pf.pontos_bonus
          from public.perfis pf
          where pf.id = p.usuario_id
        ), 0)
    )::int as pontos_total,
    count(*) filter (where p.pontos_ganhos is not null)::int as jogos_pontuados,
    count(*)::int as palpites_total
  from public.palpites p
  group by p.usuario_id;

grant select on public.v_pontuacao_usuario to authenticated, anon;

-- -----------------------------------------------------------------------
-- 3. +100 pontos de bônus para o usuário (idempotente: define o valor)
-- -----------------------------------------------------------------------
update public.perfis
set pontos_bonus = 100
where id = '7ec41775-c08b-41f2-b503-49366d59bfcc';

-- -----------------------------------------------------------------------
-- 4. Palpites especiais no bolão "Organizada Jaraguá":
--    artilheiro = Mbappé (FRA), campeão = Inglaterra (ENG)
-- -----------------------------------------------------------------------
insert into public.palpites_extras (usuario_id, bolao_id, artilheiro_id, campeao_id)
select
  '7ec41775-c08b-41f2-b503-49366d59bfcc'::uuid,
  b.id,
  (select j.id from public.jogadores j
     join public.selecoes s on s.id = j.selecao_id
     where s.codigo = 'FRA' and j.nome ilike 'Kylian Mbapp%'
     limit 1),
  (select s.id from public.selecoes s where s.codigo = 'ENG')
from public.boloes b
where b.nome = 'Organizada Jaraguá'
on conflict (usuario_id, bolao_id) do update
  set artilheiro_id = excluded.artilheiro_id,
      campeao_id    = excluded.campeao_id;

commit;
