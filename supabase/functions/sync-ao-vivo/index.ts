// =====================================================================
// Edge Function: sync-ao-vivo
// Atualiza o PLACAR AO VIVO (parcial) dos jogos em andamento na tabela
// public.placares_ao_vivo — SOMENTE referência visual. NÃO toca em
// public.partidas nem na pontuação do bolão.
//
// Acionada por pg_cron a cada ~1 min. Se não houver jogo ao vivo, retorna
// imediatamente (1 fetch), mantendo o custo desprezível no free tier.
//
// Secrets (compartilhados com sync-resultados):
//   FIFA_ID_SEASON, SYNC_SHARED_SECRET
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.)
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

// MatchStatus da FIFA: 1 = não começou, 0 = encerrado.
// "Ao vivo" é qualquer outro estado (tipicamente 3) COM minuto de jogo.
const STATUS_NAO_COMECOU = 1;
const STATUS_ENCERRADO = 0;

type FifaTeam = { IdTeam?: string };
type FifaMatch = {
  IdMatch?: string;
  MatchStatus?: number;
  MatchTime?: string | null;
  HomeTeamScore?: number | null;
  AwayTeamScore?: number | null;
  Home?: FifaTeam | null;
  Away?: FifaTeam | null;
};

function estaAoVivo(m: FifaMatch): boolean {
  return (
    m.MatchStatus !== STATUS_NAO_COMECOU &&
    m.MatchStatus !== STATUS_ENCERRADO &&
    m.HomeTeamScore != null &&
    m.AwayTeamScore != null &&
    m.Home?.IdTeam != null &&
    m.Away?.IdTeam != null
  );
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("SYNC_SHARED_SECRET") ?? "";
  if (!expected || req.headers.get("x-sync-secret") !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  const idSeason = Deno.env.get("FIFA_ID_SEASON");
  if (!idSeason) {
    return Response.json({ error: "FIFA_ID_SEASON não configurado" }, { status: 500 });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const url =
    `https://api.fifa.com/api/v3/calendar/matches?idSeason=${idSeason}` +
    `&count=200&language=en`;
  let payload: { Results?: FifaMatch[] };
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      return Response.json({ error: "fifa_fetch", status: res.status }, { status: 502 });
    }
    payload = await res.json();
  } catch (e) {
    return Response.json({ error: "fifa_fetch", detail: String(e) }, { status: 502 });
  }

  const jogos = payload.Results ?? [];
  const aoVivo = jogos.filter(estaAoVivo);

  const resumo = { ao_vivo: aoVivo.length, updated: 0, encerrados: 0, errors: [] as { id?: string; msg: string }[] };

  // Marca como encerrados (ao_vivo=false) todos os jogos que a FIFA reporta
  // como finalizados e que não estão na lista ao vivo desta rodada.
  // Feito ANTES do early-return para garantir limpeza mesmo quando não há
  // nenhum jogo ao vivo (caso contrário registros antigos ficam presos em true).
  const idsAoVivo = new Set(aoVivo.map((m) => String(m.IdMatch)));
  const encerrados = jogos
    .filter(
      (m) => m.MatchStatus === STATUS_ENCERRADO && m.IdMatch && !idsAoVivo.has(String(m.IdMatch)),
    )
    .map((m) => String(m.IdMatch));
  if (encerrados.length > 0) {
    const { data: parts } = await sb
      .from("partidas")
      .select("id")
      .in("fifa_match_id", encerrados);
    const partidaIds = (parts ?? []).map((p) => p.id);
    if (partidaIds.length > 0) {
      const { count } = await sb
        .from("placares_ao_vivo")
        .update({ ao_vivo: false, atualizado_em: new Date().toISOString() })
        .in("partida_id", partidaIds)
        .eq("ao_vivo", true)
        .select("id", { count: "exact", head: true });
      resumo.encerrados = count ?? 0;
    }
  }

  // Sem jogo ao vivo => encerra cedo (custo mínimo).
  if (aoVivo.length === 0) {
    return Response.json(resumo);
  }

  for (const m of aoVivo) {
    const { error } = await sb.rpc("upsert_placar_ao_vivo", {
      _fifa_match_id: String(m.IdMatch),
      _home_fifa_id: String(m.Home!.IdTeam),
      _away_fifa_id: String(m.Away!.IdTeam),
      _home_score: m.HomeTeamScore,
      _away_score: m.AwayTeamScore,
      _minuto: m.MatchTime ?? null,
      _ao_vivo: true,
    });
    if (error) {
      resumo.errors.push({ id: m.IdMatch, msg: error.message });
      continue;
    }
    resumo.updated += 1;
  }

  return Response.json(resumo);
});
