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

// A FIFA demora ~30 min para mudar MatchStatus para 0 após o apito final.
// Detectamos encerramento antecipado por dois critérios extras:
//   1. MatchTime contém "FT" (Full Time) — a FIFA às vezes envia antes de mudar o status.
//   2. O minuto congela: se a linha já existe com o mesmo minuto por mais de
//      MINUTOS_SEM_AVANCO_MAX minutos, inferimos que o jogo acabou.
const MINUTOS_SEM_AVANCO_MAX = 12; // minutos parado no mesmo MatchTime → encerrado

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

function minutoIndicaEncerrado(matchTime: string | null | undefined): boolean {
  if (!matchTime) return false;
  const t = matchTime.trim().toUpperCase();
  // FIFA pode mandar "FT", "Full Time", "Final" ou variantes
  return t === "FT" || t.startsWith("FT") || t === "FULL TIME" || t === "FINAL";
}

function estaAoVivo(m: FifaMatch): boolean {
  return (
    m.MatchStatus !== STATUS_NAO_COMECOU &&
    m.MatchStatus !== STATUS_ENCERRADO &&
    !minutoIndicaEncerrado(m.MatchTime) &&
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

  const resumo = { ao_vivo: aoVivo.length, updated: 0, encerrados: 0, congelados: 0, errors: [] as { id?: string; msg: string }[] };

  // Marca como encerrados (ao_vivo=false) todos os jogos que a FIFA reporta
  // como finalizados e que não estão na lista ao vivo desta rodada.
  // Feito ANTES do early-return para garantir limpeza mesmo quando não há
  // nenhum jogo ao vivo (caso contrário registros antigos ficam presos em true).
  const idsAoVivo = new Set(aoVivo.map((m) => String(m.IdMatch)));
  const encerradosFifa = jogos
    .filter(
      (m) => m.MatchStatus === STATUS_ENCERRADO && m.IdMatch && !idsAoVivo.has(String(m.IdMatch)),
    )
    .map((m) => String(m.IdMatch));
  if (encerradosFifa.length > 0) {
    const { data: parts } = await sb
      .from("partidas")
      .select("id")
      .in("fifa_match_id", encerradosFifa);
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

  // Sem jogo ao vivo (pela FIFA) => encerra cedo (custo mínimo).
  // Mas antes verifica registros presos: linhas com ao_vivo=true cujo minuto
  // ficou congelado por mais de MINUTOS_SEM_AVANCO_MAX — a FIFA travou antes
  // de mudar o MatchStatus para 0.
  if (aoVivo.length === 0) {
    const limiteCongelado = new Date(Date.now() - MINUTOS_SEM_AVANCO_MAX * 60_000).toISOString();
    const { data: presos } = await sb
      .from("placares_ao_vivo")
      .select("partida_id")
      .eq("ao_vivo", true)
      .lt("atualizado_em", limiteCongelado);
    if (presos && presos.length > 0) {
      const ids = presos.map((r) => r.partida_id);
      const { count } = await sb
        .from("placares_ao_vivo")
        .update({ ao_vivo: false, atualizado_em: new Date().toISOString() })
        .in("partida_id", ids)
        .eq("ao_vivo", true)
        .select("partida_id", { count: "exact", head: true });
      resumo.congelados = count ?? 0;
    }
    return Response.json(resumo);
  }

  // Busca os registros ao vivo existentes para detectar minuto congelado.
  // A FIFA às vezes trava em MatchStatus=3 com MatchTime parado após o apito final.
  // Como o upsert renova atualizado_em a cada execução, usamos o campo `minuto_anterior`
  // implícito: se a FIFA reporta o mesmo MatchTime que já está gravado E esse MatchTime
  // sugere fim de jogo (>= 90 min + acréscimo típico), inferimos encerramento.
  const { data: registrosAtivos } = await sb
    .from("placares_ao_vivo")
    .select("partida_id, minuto")
    .eq("ao_vivo", true);

  // Mapa fifa_match_id → minuto gravado (via partida.id); usamos partida_id diretamente.
  // Precisamos correlacionar pelo IdMatch da FIFA. Buscamos o mapeamento em partidas.
  const partidaIdsAtivos = (registrosAtivos ?? []).map((r) => r.partida_id);
  let fifaIdParaPartidaId: Record<string, string> = {};
  if (partidaIdsAtivos.length > 0) {
    const { data: partsMap } = await sb
      .from("partidas")
      .select("id, fifa_match_id")
      .in("id", partidaIdsAtivos)
      .not("fifa_match_id", "is", null);
    (partsMap ?? []).forEach((p) => {
      if (p.fifa_match_id) fifaIdParaPartidaId[p.fifa_match_id] = p.id;
    });
  }

  // Minuto gravado por partida_id
  const minutoGravado: Record<string, string | null> = {};
  (registrosAtivos ?? []).forEach((r) => (minutoGravado[r.partida_id] = r.minuto));

  // Detecta jogos cujo MatchTime não avançou E o padrão indica fim de jogo.
  // Um MatchTime como "90+X'" que se repete por mais de 1 rodada do cron (1 min)
  // praticamente confirma que o jogo acabou — a FIFA está apenas lenta.
  function minutoPareceEncerrado(matchTime: string | null | undefined, minutoAnterior: string | null | undefined): boolean {
    if (!matchTime || !minutoAnterior) return false;
    if (matchTime !== minutoAnterior) return false; // ainda avançando — ok
    // Minuto parado: verifica se parece "fim de jogo normal ou prorrogação".
    // Excluímos base=45 porque é o intervalo (HT), que fica parado ~15 min legitimamente.
    // Incluímos base>=90 (fim do tempo normal) e base>=120 (fim da prorrogação).
    const t = matchTime.replace(/'/g, "").trim();
    const base = parseInt(t.split("+")[0], 10);
    return !isNaN(base) && base >= 90;
  }

  const partidasCongeladas = new Set<string>();
  for (const m of aoVivo) {
    const partidaId = m.IdMatch ? fifaIdParaPartidaId[String(m.IdMatch)] : undefined;
    if (!partidaId) continue;
    if (minutoPareceEncerrado(m.MatchTime, minutoGravado[partidaId])) {
      partidasCongeladas.add(partidaId);
    }
  }

  if (partidasCongeladas.size > 0) {
    const { count } = await sb
      .from("placares_ao_vivo")
      .update({ ao_vivo: false, atualizado_em: new Date().toISOString() })
      .in("partida_id", [...partidasCongeladas])
      .eq("ao_vivo", true)
      .select("partida_id", { count: "exact", head: true });
    resumo.congelados += count ?? 0;
  }

  for (const m of aoVivo) {
    const partidaId = m.IdMatch ? fifaIdParaPartidaId[String(m.IdMatch)] : undefined;
    if (partidaId && partidasCongeladas.has(partidaId)) continue; // não re-ativar

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
