-- =====================================================================
-- BolãoEEL — Sincronização com a Copa do Mundo FIFA 2026 (real)
-- Substitui as seleções/grupos/partidas genéricas pelos dados oficiais
-- do sorteio (Washington, 05/12/2025) e calendário da fase de grupos.
--
-- Fonte: Wikipédia "2026 FIFA World Cup Group A..L" / FIFA.com.
-- Idempotente: pode rodar mais de uma vez. Execute no SQL Editor do
-- Supabase DEPOIS de migration_inicial.sql e migration_boloes.sql.
--
-- Observações:
--  * Horários convertidos para UTC (coluna timestamptz). Conversão:
--      UTC−4 (EDT) +4h | UTC−5 (CDT/EST) +5h
--      UTC−6 (CST MX) +6h | UTC−7 (PDT) +7h
--  * Mantém palpites já feitos: as partidas são recriadas, então
--    palpites em partidas antigas (genéricas) são removidos em cascata.
--    Como o torneio ainda não começou, isso é seguro.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Limpa dados genéricos (partidas primeiro por FK; palpites caem em cascata)
-- ---------------------------------------------------------------------
delete from public.partidas;
delete from public.selecoes;

-- ---------------------------------------------------------------------
-- 1. SEED: 48 seleções classificadas — grupos reais A..L
-- ---------------------------------------------------------------------
insert into public.selecoes (codigo, nome, bandeira, grupo) values
  -- Grupo A
  ('MEX','México','🇲🇽','A'),('RSA','África do Sul','🇿🇦','A'),('KOR','Coreia do Sul','🇰🇷','A'),('CZE','Tchéquia','🇨🇿','A'),
  -- Grupo B
  ('CAN','Canadá','🇨🇦','B'),('SUI','Suíça','🇨🇭','B'),('QAT','Catar','🇶🇦','B'),('BIH','Bósnia e Herzegovina','🇧🇦','B'),
  -- Grupo C
  ('BRA','Brasil','🇧🇷','C'),('MAR','Marrocos','🇲🇦','C'),('HAI','Haiti','🇭🇹','C'),('SCO','Escócia','🏴󠁧󠁢󠁳󠁣󠁴󠁿','C'),
  -- Grupo D
  ('USA','Estados Unidos','🇺🇸','D'),('PAR','Paraguai','🇵🇾','D'),('AUS','Austrália','🇦🇺','D'),('TUR','Turquia','🇹🇷','D'),
  -- Grupo E
  ('GER','Alemanha','🇩🇪','E'),('CUW','Curaçao','🇨🇼','E'),('CIV','Costa do Marfim','🇨🇮','E'),('ECU','Equador','🇪🇨','E'),
  -- Grupo F
  ('NED','Holanda','🇳🇱','F'),('JPN','Japão','🇯🇵','F'),('SWE','Suécia','🇸🇪','F'),('TUN','Tunísia','🇹🇳','F'),
  -- Grupo G
  ('BEL','Bélgica','🇧🇪','G'),('EGY','Egito','🇪🇬','G'),('IRN','Irã','🇮🇷','G'),('NZL','Nova Zelândia','🇳🇿','G'),
  -- Grupo H
  ('ESP','Espanha','🇪🇸','H'),('CPV','Cabo Verde','🇨🇻','H'),('KSA','Arábia Saudita','🇸🇦','H'),('URU','Uruguai','🇺🇾','H'),
  -- Grupo I
  ('FRA','França','🇫🇷','I'),('SEN','Senegal','🇸🇳','I'),('NOR','Noruega','🇳🇴','I'),('IRQ','Iraque','🇮🇶','I'),
  -- Grupo J
  ('ARG','Argentina','🇦🇷','J'),('ALG','Argélia','🇩🇿','J'),('AUT','Áustria','🇦🇹','J'),('JOR','Jordânia','🇯🇴','J'),
  -- Grupo K
  ('POR','Portugal','🇵🇹','K'),('UZB','Uzbequistão','🇺🇿','K'),('COL','Colômbia','🇨🇴','K'),('COD','Rep. Dem. do Congo','🇨🇩','K'),
  -- Grupo L
  ('ENG','Inglaterra','🏴󠁧󠁢󠁥󠁮󠁧󠁿','L'),('CRO','Croácia','🇭🇷','L'),('GHA','Gana','🇬🇭','L'),('PAN','Panamá','🇵🇦','L')
on conflict (codigo) do update set nome = excluded.nome, bandeira = excluded.bandeira, grupo = excluded.grupo;

-- ---------------------------------------------------------------------
-- 2. SEED: 72 partidas da fase de grupos (data_hora em UTC)
-- ---------------------------------------------------------------------
-- Helper: insere por código de seleção, resolvendo os UUIDs.
do $$
declare
  -- cada linha: grupo, data_hora UTC, estádio, mandante(cod), visitante(cod)
  m record;
  v_mandante uuid;
  v_visitante uuid;
  jogos jsonb := '[
    ["A","2026-06-11T19:00:00Z","Estadio Azteca, Cidade do México","MEX","RSA"],
    ["A","2026-06-12T02:00:00Z","Estadio Akron, Zapopan","KOR","CZE"],
    ["A","2026-06-18T16:00:00Z","Mercedes-Benz Stadium, Atlanta","CZE","RSA"],
    ["A","2026-06-19T01:00:00Z","Estadio Akron, Zapopan","MEX","KOR"],
    ["A","2026-06-25T01:00:00Z","Estadio Azteca, Cidade do México","CZE","MEX"],
    ["A","2026-06-25T01:00:00Z","Estadio BBVA, Guadalupe","RSA","KOR"],

    ["B","2026-06-12T19:00:00Z","BMO Field, Toronto","CAN","BIH"],
    ["B","2026-06-13T19:00:00Z","Levi''s Stadium, Santa Clara","QAT","SUI"],
    ["B","2026-06-18T19:00:00Z","SoFi Stadium, Inglewood","SUI","BIH"],
    ["B","2026-06-18T22:00:00Z","BC Place, Vancouver","CAN","QAT"],
    ["B","2026-06-24T19:00:00Z","BC Place, Vancouver","SUI","CAN"],
    ["B","2026-06-24T19:00:00Z","Lumen Field, Seattle","BIH","QAT"],

    ["C","2026-06-13T22:00:00Z","MetLife Stadium, East Rutherford","BRA","MAR"],
    ["C","2026-06-14T01:00:00Z","Gillette Stadium, Foxborough","HAI","SCO"],
    ["C","2026-06-19T22:00:00Z","Gillette Stadium, Foxborough","SCO","MAR"],
    ["C","2026-06-20T00:30:00Z","Lincoln Financial Field, Filadélfia","BRA","HAI"],
    ["C","2026-06-24T22:00:00Z","Hard Rock Stadium, Miami Gardens","SCO","BRA"],
    ["C","2026-06-24T22:00:00Z","Mercedes-Benz Stadium, Atlanta","MAR","HAI"],

    ["D","2026-06-13T01:00:00Z","SoFi Stadium, Inglewood","USA","PAR"],
    ["D","2026-06-14T04:00:00Z","BC Place, Vancouver","AUS","TUR"],
    ["D","2026-06-19T19:00:00Z","Lumen Field, Seattle","USA","AUS"],
    ["D","2026-06-20T03:00:00Z","Levi''s Stadium, Santa Clara","TUR","PAR"],
    ["D","2026-06-26T02:00:00Z","SoFi Stadium, Inglewood","TUR","USA"],
    ["D","2026-06-26T02:00:00Z","Levi''s Stadium, Santa Clara","PAR","AUS"],

    ["E","2026-06-14T17:00:00Z","NRG Stadium, Houston","GER","CUW"],
    ["E","2026-06-14T23:00:00Z","Lincoln Financial Field, Filadélfia","CIV","ECU"],
    ["E","2026-06-20T20:00:00Z","BMO Field, Toronto","GER","CIV"],
    ["E","2026-06-21T00:00:00Z","Arrowhead Stadium, Kansas City","ECU","CUW"],
    ["E","2026-06-25T20:00:00Z","Lincoln Financial Field, Filadélfia","CUW","CIV"],
    ["E","2026-06-25T20:00:00Z","MetLife Stadium, East Rutherford","ECU","GER"],

    ["F","2026-06-14T20:00:00Z","AT&T Stadium, Arlington","NED","JPN"],
    ["F","2026-06-15T02:00:00Z","Estadio BBVA, Guadalupe","SWE","TUN"],
    ["F","2026-06-20T17:00:00Z","NRG Stadium, Houston","NED","SWE"],
    ["F","2026-06-21T04:00:00Z","Estadio BBVA, Guadalupe","TUN","JPN"],
    ["F","2026-06-25T23:00:00Z","AT&T Stadium, Arlington","JPN","SWE"],
    ["F","2026-06-25T23:00:00Z","Arrowhead Stadium, Kansas City","TUN","NED"],

    ["G","2026-06-15T19:00:00Z","Lumen Field, Seattle","BEL","EGY"],
    ["G","2026-06-16T01:00:00Z","SoFi Stadium, Inglewood","IRN","NZL"],
    ["G","2026-06-21T19:00:00Z","SoFi Stadium, Inglewood","BEL","IRN"],
    ["G","2026-06-22T01:00:00Z","BC Place, Vancouver","NZL","EGY"],
    ["G","2026-06-27T03:00:00Z","Lumen Field, Seattle","EGY","IRN"],
    ["G","2026-06-27T03:00:00Z","BC Place, Vancouver","NZL","BEL"],

    ["H","2026-06-15T16:00:00Z","Mercedes-Benz Stadium, Atlanta","ESP","CPV"],
    ["H","2026-06-15T22:00:00Z","Hard Rock Stadium, Miami Gardens","KSA","URU"],
    ["H","2026-06-21T16:00:00Z","Mercedes-Benz Stadium, Atlanta","ESP","KSA"],
    ["H","2026-06-21T22:00:00Z","Hard Rock Stadium, Miami Gardens","URU","CPV"],
    ["H","2026-06-27T00:00:00Z","NRG Stadium, Houston","CPV","KSA"],
    ["H","2026-06-27T00:00:00Z","Estadio Akron, Zapopan","URU","ESP"],

    ["I","2026-06-16T19:00:00Z","MetLife Stadium, East Rutherford","FRA","SEN"],
    ["I","2026-06-16T22:00:00Z","Gillette Stadium, Foxborough","IRQ","NOR"],
    ["I","2026-06-22T21:00:00Z","Lincoln Financial Field, Filadélfia","FRA","IRQ"],
    ["I","2026-06-23T00:00:00Z","MetLife Stadium, East Rutherford","NOR","SEN"],
    ["I","2026-06-26T19:00:00Z","Gillette Stadium, Foxborough","NOR","FRA"],
    ["I","2026-06-26T19:00:00Z","BMO Field, Toronto","SEN","IRQ"],

    ["J","2026-06-17T01:00:00Z","Arrowhead Stadium, Kansas City","ARG","ALG"],
    ["J","2026-06-17T04:00:00Z","Levi''s Stadium, Santa Clara","AUT","JOR"],
    ["J","2026-06-22T17:00:00Z","AT&T Stadium, Arlington","ARG","AUT"],
    ["J","2026-06-23T03:00:00Z","Levi''s Stadium, Santa Clara","JOR","ALG"],
    ["J","2026-06-28T02:00:00Z","Arrowhead Stadium, Kansas City","ALG","AUT"],
    ["J","2026-06-28T02:00:00Z","AT&T Stadium, Arlington","JOR","ARG"],

    ["K","2026-06-17T17:00:00Z","NRG Stadium, Houston","POR","COD"],
    ["K","2026-06-18T02:00:00Z","Estadio Azteca, Cidade do México","UZB","COL"],
    ["K","2026-06-23T17:00:00Z","NRG Stadium, Houston","POR","UZB"],
    ["K","2026-06-24T02:00:00Z","Estadio Akron, Zapopan","COL","COD"],
    ["K","2026-06-27T23:30:00Z","Hard Rock Stadium, Miami Gardens","COL","POR"],
    ["K","2026-06-27T23:30:00Z","Mercedes-Benz Stadium, Atlanta","COD","UZB"],

    ["L","2026-06-17T20:00:00Z","AT&T Stadium, Arlington","ENG","CRO"],
    ["L","2026-06-17T23:00:00Z","BMO Field, Toronto","GHA","PAN"],
    ["L","2026-06-23T20:00:00Z","Gillette Stadium, Foxborough","ENG","GHA"],
    ["L","2026-06-23T23:00:00Z","BMO Field, Toronto","PAN","CRO"],
    ["L","2026-06-27T21:00:00Z","MetLife Stadium, East Rutherford","PAN","ENG"],
    ["L","2026-06-27T21:00:00Z","Lincoln Financial Field, Filadélfia","CRO","GHA"]
  ]'::jsonb;
begin
  for m in select * from jsonb_array_elements(jogos) as j(arr) loop
    select id into v_mandante  from public.selecoes where codigo = (m.arr->>3);
    select id into v_visitante from public.selecoes where codigo = (m.arr->>4);

    insert into public.partidas (fase, grupo, data_hora, estadio, mandante_id, visitante_id, status)
    values ('grupos', m.arr->>0, (m.arr->>1)::timestamptz, m.arr->>2, v_mandante, v_visitante, 'aguardando');
  end loop;
end $$;

commit;

-- =====================================================================
-- Verificação rápida (opcional):
--   select grupo, count(*) from public.partidas group by grupo order by grupo;  -- 6 cada
--   select count(*) from public.selecoes;                                       -- 48
-- =====================================================================
