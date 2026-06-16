-- =====================================================================
-- Migration: fair play (cartões por partida) + ranking FIFA por seleção
-- =====================================================================

-- 1. Novas colunas em partidas: cartões e IdStage da FIFA (para chamar /timelines)
ALTER TABLE public.partidas
  ADD COLUMN IF NOT EXISTS cartoes_amarelos_mandante  INT,
  ADD COLUMN IF NOT EXISTS cartoes_vermelhos_mandante INT,
  ADD COLUMN IF NOT EXISTS cartoes_amarelos_visitante  INT,
  ADD COLUMN IF NOT EXISTS cartoes_vermelhos_visitante INT,
  ADD COLUMN IF NOT EXISTS fifa_stage_id              TEXT;

-- 2. Nova coluna em selecoes: ranking FIFA
ALTER TABLE public.selecoes
  ADD COLUMN IF NOT EXISTS fifa_ranking INT;

-- 3. RPC para gravar cartões de uma partida (chamada pela Edge Function)
CREATE OR REPLACE FUNCTION public.admin_sync_cartoes_partida(
  _partida_id              UUID,
  _amarelos_mandante       INT,
  _vermelhos_mandante      INT,
  _amarelos_visitante      INT,
  _vermelhos_visitante     INT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.partidas SET
    cartoes_amarelos_mandante  = _amarelos_mandante,
    cartoes_vermelhos_mandante = _vermelhos_mandante,
    cartoes_amarelos_visitante  = _amarelos_visitante,
    cartoes_vermelhos_visitante = _vermelhos_visitante
  WHERE id = _partida_id;
END;
$$;

-- 4. Seed do ranking FIFA masculino publicado em 11/06/2026
--    Fonte: FIFA.com / ESPN / whereig.com
--    Grupos confirmados no banco: MEX RSA KOR CZE | CAN SUI QAT BIH |
--    BRA MAR HAI SCO | USA PAR AUS TUR | GER CUW CIV ECU | NED JPN SWE TUN |
--    BEL EGY IRN NZL | ESP CPV KSA URU | FRA SEN NOR IRQ |
--    ARG ALG AUT JOR | POR UZB COL COD | ENG CRO GHA PAN

UPDATE public.selecoes SET fifa_ranking = 1   WHERE codigo = 'ARG';
UPDATE public.selecoes SET fifa_ranking = 2   WHERE codigo = 'ESP';
UPDATE public.selecoes SET fifa_ranking = 3   WHERE codigo = 'FRA';
UPDATE public.selecoes SET fifa_ranking = 4   WHERE codigo = 'ENG';
UPDATE public.selecoes SET fifa_ranking = 5   WHERE codigo = 'POR';
UPDATE public.selecoes SET fifa_ranking = 6   WHERE codigo = 'BRA';
UPDATE public.selecoes SET fifa_ranking = 7   WHERE codigo = 'MAR';
UPDATE public.selecoes SET fifa_ranking = 8   WHERE codigo = 'NED';
UPDATE public.selecoes SET fifa_ranking = 9   WHERE codigo = 'BEL';
UPDATE public.selecoes SET fifa_ranking = 10  WHERE codigo = 'GER';
UPDATE public.selecoes SET fifa_ranking = 11  WHERE codigo = 'CRO';
UPDATE public.selecoes SET fifa_ranking = 13  WHERE codigo = 'COL';
UPDATE public.selecoes SET fifa_ranking = 14  WHERE codigo = 'MEX';
UPDATE public.selecoes SET fifa_ranking = 15  WHERE codigo = 'SEN';
UPDATE public.selecoes SET fifa_ranking = 16  WHERE codigo = 'URU';
UPDATE public.selecoes SET fifa_ranking = 17  WHERE codigo = 'USA';
UPDATE public.selecoes SET fifa_ranking = 18  WHERE codigo = 'JPN';
UPDATE public.selecoes SET fifa_ranking = 19  WHERE codigo = 'SUI';
UPDATE public.selecoes SET fifa_ranking = 20  WHERE codigo = 'IRN';
UPDATE public.selecoes SET fifa_ranking = 22  WHERE codigo = 'TUR';
UPDATE public.selecoes SET fifa_ranking = 23  WHERE codigo = 'ECU';
UPDATE public.selecoes SET fifa_ranking = 24  WHERE codigo = 'AUT';
UPDATE public.selecoes SET fifa_ranking = 25  WHERE codigo = 'KOR';
UPDATE public.selecoes SET fifa_ranking = 27  WHERE codigo = 'AUS';
UPDATE public.selecoes SET fifa_ranking = 28  WHERE codigo = 'ALG';
UPDATE public.selecoes SET fifa_ranking = 29  WHERE codigo = 'EGY';
UPDATE public.selecoes SET fifa_ranking = 30  WHERE codigo = 'CAN';
UPDATE public.selecoes SET fifa_ranking = 33  WHERE codigo = 'CIV';
UPDATE public.selecoes SET fifa_ranking = 34  WHERE codigo = 'PAN';
UPDATE public.selecoes SET fifa_ranking = 38  WHERE codigo = 'SWE';
UPDATE public.selecoes SET fifa_ranking = 40  WHERE codigo = 'CZE';
UPDATE public.selecoes SET fifa_ranking = 41  WHERE codigo = 'PAR';
UPDATE public.selecoes SET fifa_ranking = 42  WHERE codigo = 'SCO';
UPDATE public.selecoes SET fifa_ranking = 44  WHERE codigo = 'COD'; -- Congo DR ~44
UPDATE public.selecoes SET fifa_ranking = 45  WHERE codigo = 'TUN'; -- Tunísia ~45
UPDATE public.selecoes SET fifa_ranking = 49  WHERE codigo = 'VEN'; -- Venezuela não está na Copa, ignorar
UPDATE public.selecoes SET fifa_ranking = 50  WHERE codigo = 'UZB';
UPDATE public.selecoes SET fifa_ranking = 56  WHERE codigo = 'QAT';
UPDATE public.selecoes SET fifa_ranking = 57  WHERE codigo = 'IRQ';
UPDATE public.selecoes SET fifa_ranking = 60  WHERE codigo = 'RSA';
UPDATE public.selecoes SET fifa_ranking = 61  WHERE codigo = 'KSA';
UPDATE public.selecoes SET fifa_ranking = 63  WHERE codigo = 'JOR';
UPDATE public.selecoes SET fifa_ranking = 64  WHERE codigo = 'BIH';
UPDATE public.selecoes SET fifa_ranking = 67  WHERE codigo = 'CPV';
UPDATE public.selecoes SET fifa_ranking = 73  WHERE codigo = 'GHA';
-- NOR (Noruega) ~31 no ranking geral mas não estava na lista de participantes da ESPN
UPDATE public.selecoes SET fifa_ranking = 31  WHERE codigo = 'NOR';
UPDATE public.selecoes SET fifa_ranking = 82  WHERE codigo = 'CUW';
UPDATE public.selecoes SET fifa_ranking = 83  WHERE codigo = 'HAI';
UPDATE public.selecoes SET fifa_ranking = 85  WHERE codigo = 'NZL';
