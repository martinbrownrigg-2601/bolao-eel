// =====================================================================
// Edge Function: sync-resultados
// Busca os jogos ENCERRADOS na API pública da FIFA e, para cada um, chama
// a RPC public.sync_resultado_partida (service_role), que grava o placar +
// status e recalcula os palpites. Idempotente (jogos já gravados => skipped).
//
// Acionada por:
//   * pg_cron (a cada ~30 min) via net.http_post; e/ou
//   * botão "Sincronizar agora" do admin (RPC admin_disparar_sync).
//
// Secrets necessários (supabase secrets set ...):
//   FIFA_ID_SEASON      -> idSeason da Copa 2026 na API da FIFA
//   SYNC_SHARED_SECRET  -> segredo compartilhado, validado no header x-sync-secret
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente.)
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

// Status numérico da FIFA que representa "partida encerrada".
const MATCH_STATUS_FINISHED = 0;

type FifaTeam = { IdTeam?: string };
type FifaMatch = {
  IdMatch?: string;
  MatchStatus?: number;
  HomeTeamScore?: number | null;
  AwayTeamScore?: number | null;
  Home?: FifaTeam | null;
  Away?: FifaTeam | null;
};

type Resultado = "updated" | "skipped" | "no_partida" | "unmapped_team";

Deno.serve(async (req) => {
  // --- Autenticação por segredo compartilhado ---
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

  // --- Busca o calendário da temporada na FIFA ---
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
  const encerrados = jogos.filter(
    (m) =>
      m.MatchStatus === MATCH_STATUS_FINISHED &&
      m.HomeTeamScore != null &&
      m.AwayTeamScore != null &&
      m.Home?.IdTeam != null &&
      m.Away?.IdTeam != null,
  );

  const resumo: Record<Resultado, number> & { errors: { id?: string; msg: string }[] } = {
    updated: 0,
    skipped: 0,
    no_partida: 0,
    unmapped_team: 0,
    errors: [],
  };

  for (const m of encerrados) {
    const { data, error } = await sb.rpc("sync_resultado_partida", {
      _fifa_match_id: String(m.IdMatch),
      _home_fifa_id: String(m.Home!.IdTeam),
      _away_fifa_id: String(m.Away!.IdTeam),
      _home_score: m.HomeTeamScore,
      _away_score: m.AwayTeamScore,
    });
    if (error) {
      resumo.errors.push({ id: m.IdMatch, msg: error.message });
      continue;
    }
    const r = data as Resultado;
    if (r in resumo) resumo[r] += 1;
  }

  return Response.json({ total_encerrados: encerrados.length, ...resumo });
});
