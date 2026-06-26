// =====================================================================
// Edge Function: sync-resultados
// Busca os jogos ENCERRADOS na API pública da FIFA e, para cada um, chama
// a RPC public.sync_resultado_partida (service_role), que grava o placar +
// status e recalcula os palpites. Idempotente (jogos já gravados => skipped).
// Também sincroniza cartões (fair play) via endpoint /timelines da FIFA.
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
// idCompetition fixo da Copa do Mundo FIFA na API v3
const FIFA_ID_COMPETITION = "17";

type FifaTeam = { IdTeam?: string };
type FifaMatch = {
  IdMatch?: string;
  IdStage?: string;
  MatchStatus?: number;
  HomeTeamScore?: number | null;
  AwayTeamScore?: number | null;
  // Placar da disputa de pênaltis (0/0 quando não houve). A FIFA também envia
  // Winner (IdTeam vencedor); usamos o placar de pênaltis para decidir e exibir.
  HomeTeamPenaltyScore?: number | null;
  AwayTeamPenaltyScore?: number | null;
  Home?: FifaTeam | null;
  Away?: FifaTeam | null;
};

type FifaTimelineEvent = {
  Type?: number;
  IdTeam?: string;
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

  const resumo: Record<Resultado, number> & {
    errors: { id?: string; msg: string }[];
    cartoes_sincronizados: number;
    cartoes_erros: number;
  } = {
    updated: 0,
    skipped: 0,
    no_partida: 0,
    unmapped_team: 0,
    errors: [],
    cartoes_sincronizados: 0,
    cartoes_erros: 0,
  };

  for (const m of encerrados) {
    // Só tratamos como decidido nos pênaltis quando o tempo normal/prorrogação
    // empatou E houve disputa (vencedor com > 0). Evita gravar 0–0 de pênaltis
    // em empates da fase de grupos / jogos normais.
    const homePen = m.HomeTeamPenaltyScore ?? 0;
    const awayPen = m.AwayTeamPenaltyScore ?? 0;
    const foiPenaltis =
      m.HomeTeamScore === m.AwayTeamScore && (homePen > 0 || awayPen > 0);

    // --- Sync placar + pontuação ---
    const { data, error } = await sb.rpc("sync_resultado_partida", {
      _fifa_match_id: String(m.IdMatch),
      _home_fifa_id: String(m.Home!.IdTeam),
      _away_fifa_id: String(m.Away!.IdTeam),
      _home_score: m.HomeTeamScore,
      _away_score: m.AwayTeamScore,
      _home_penaltis: foiPenaltis ? homePen : null,
      _away_penaltis: foiPenaltis ? awayPen : null,
    });
    if (error) {
      resumo.errors.push({ id: m.IdMatch, msg: error.message });
      continue;
    }
    const r = data as Resultado;
    if (r in resumo) (resumo as Record<string, number>)[r] += 1;

    // --- Sync cartões (fair play) via /timelines ---
    // Só sincroniza se temos IdMatch e IdStage
    if (!m.IdMatch || !m.IdStage) continue;

    // Buscar a partida no banco para verificar se cartões já foram sincronizados
    const { data: partida } = await sb
      .from("partidas")
      .select("id, cartoes_amarelos_mandante, mandante_id, visitante_id, fifa_stage_id")
      .eq("fifa_match_id", String(m.IdMatch))
      .maybeSingle();

    if (!partida) continue;

    // Salvar fifa_stage_id se ainda não está preenchido
    if (!partida.fifa_stage_id) {
      await sb
        .from("partidas")
        .update({ fifa_stage_id: String(m.IdStage) })
        .eq("id", partida.id);
    }

    // Se cartões já foram sincronizados (campo não-null), pular
    if (partida.cartoes_amarelos_mandante !== null) continue;

    // Buscar os times para saber IdTeam de mandante/visitante
    const { data: times } = await sb
      .from("selecoes")
      .select("id, fifa_team_id")
      .in("id", [partida.mandante_id, partida.visitante_id]);

    if (!times || times.length < 2) continue;

    const timeMandante = times.find((t) => t.id === partida.mandante_id);
    const timeVisitante = times.find((t) => t.id === partida.visitante_id);
    if (!timeMandante?.fifa_team_id || !timeVisitante?.fifa_team_id) continue;

    // Chamar /timelines para obter eventos da partida
    const timelinesUrl =
      `https://api.fifa.com/api/v3/timelines/${FIFA_ID_COMPETITION}/${idSeason}/${m.IdStage}/${m.IdMatch}?language=en`;

    try {
      const tlRes = await fetch(timelinesUrl, { headers: { accept: "application/json" } });
      if (!tlRes.ok) {
        resumo.cartoes_erros++;
        continue;
      }
      const tlPayload: { Event?: FifaTimelineEvent[] } = await tlRes.json();
      const eventos = tlPayload.Event ?? [];

      // Contar cartões por time
      // Type 2 = amarelo, Type 3 = vermelho (direto ou segundo amarelo)
      let amarelosMand = 0, vermelhosMand = 0;
      let amarelosVis = 0, vermelhosVis = 0;

      for (const ev of eventos) {
        if (ev.Type !== 2 && ev.Type !== 3) continue;
        const ehMandante = ev.IdTeam === timeMandante.fifa_team_id;
        const ehVisitante = ev.IdTeam === timeVisitante.fifa_team_id;
        if (!ehMandante && !ehVisitante) continue;

        if (ev.Type === 2) {
          if (ehMandante) amarelosMand++;
          else amarelosVis++;
        } else {
          if (ehMandante) vermelhosMand++;
          else vermelhosVis++;
        }
      }

      // Gravar cartões no banco
      const { error: cartaoErr } = await sb.rpc("admin_sync_cartoes_partida", {
        _partida_id: partida.id,
        _amarelos_mandante: amarelosMand,
        _vermelhos_mandante: vermelhosMand,
        _amarelos_visitante: amarelosVis,
        _vermelhos_visitante: vermelhosVis,
      });

      if (cartaoErr) {
        resumo.cartoes_erros++;
      } else {
        resumo.cartoes_sincronizados++;
      }
    } catch {
      resumo.cartoes_erros++;
    }
  }

  return Response.json({ total_encerrados: encerrados.length, ...resumo });
});
