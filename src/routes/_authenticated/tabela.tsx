import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import React from "react";
import { supabase } from "@/lib/supabase";
import { Flag } from "@/components/Flag";
import { Loader2, Plus } from "lucide-react";
import { TERCEIRO_ALLOC, MANDANTES_TERCEIRO } from "@/lib/terceiros-alloc";

export const Route = createFileRoute("/_authenticated/tabela")({
  head: () => ({
    meta: [
      { title: "Tabela | BolãoEEL" },
      { name: "description", content: "Classificação dos grupos e bracket do mata-mata." },
    ],
  }),
  component: TabelaPage,
});

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type Selecao = {
  id: string;
  codigo: string;
  nome: string;
  bandeira: string | null;
  grupo: string | null;
  fifa_ranking: number | null;
};

type Partida = {
  id: string;
  fase: string;
  grupo: string | null;
  mandante_id: string;
  visitante_id: string;
  gols_mandante: number | null;
  gols_visitante: number | null;
  status: string;
  data_hora: string | null;
  estadio: string | null;
  bracket_slot: string | null;
  cartoes_amarelos_mandante: number | null;
  cartoes_vermelhos_mandante: number | null;
  cartoes_amarelos_visitante: number | null;
  cartoes_vermelhos_visitante: number | null;
};

type PlacarLive = {
  partida_id: string;
  gols_mandante_live: number | null;
  gols_visitante_live: number | null;
  ao_vivo: boolean;
};

type StandingRow = {
  selecao: Selecao;
  j: number; // jogos
  v: number;
  e: number;
  d: number;
  gp: number; // gols pró
  gc: number; // gols contra
  sg: number; // saldo de gols
  pts: number;
  amarelos: number;
  vermelhos: number;
};

// ---------------------------------------------------------------------------
// Bracket — estrutura fixa FIFA 2026
// ---------------------------------------------------------------------------

// Mapa estático dos 32 avos: slot FIFA → descrição dos times esperados
// Os codes são como aparecem no banco (1ºGrupo = pos+grupo, ex "1A", "2B", "3ABCDF")
type BracketSlot = {
  slotId: string;         // "M73" … "M88"
  descA: string;          // label do time A quando não existe partida real
  descB: string;
  fase: string;
  posA: string;           // ex: "1A", "2B", "3ABCDF"  — usado p/ lookup automático
  posB: string;
};

const SLOTS_32AVOS: BracketSlot[] = [
  { slotId: "M73", descA: "2º Grupo A", descB: "2º Grupo B", fase: "trinta_e_dois_avos", posA: "2A", posB: "2B" },
  { slotId: "M74", descA: "1º Grupo E", descB: "3º ABCDF",   fase: "trinta_e_dois_avos", posA: "1E", posB: "3ABCDF" },
  { slotId: "M75", descA: "1º Grupo F", descB: "2º Grupo C", fase: "trinta_e_dois_avos", posA: "1F", posB: "2C" },
  { slotId: "M76", descA: "1º Grupo C", descB: "2º Grupo F", fase: "trinta_e_dois_avos", posA: "1C", posB: "2F" },
  { slotId: "M77", descA: "1º Grupo I", descB: "3º CDFGH",   fase: "trinta_e_dois_avos", posA: "1I", posB: "3CDFGH" },
  { slotId: "M78", descA: "2º Grupo E", descB: "2º Grupo I", fase: "trinta_e_dois_avos", posA: "2E", posB: "2I" },
  { slotId: "M79", descA: "1º Grupo A", descB: "3º CEFHI",   fase: "trinta_e_dois_avos", posA: "1A", posB: "3CEFHI" },
  { slotId: "M80", descA: "1º Grupo L", descB: "3º EHIJK",   fase: "trinta_e_dois_avos", posA: "1L", posB: "3EHIJK" },
  { slotId: "M81", descA: "1º Grupo D", descB: "3º BEFIJ",   fase: "trinta_e_dois_avos", posA: "1D", posB: "3BEFIJ" },
  { slotId: "M82", descA: "1º Grupo G", descB: "3º AEHIJ",   fase: "trinta_e_dois_avos", posA: "1G", posB: "3AEHIJ" },
  { slotId: "M83", descA: "2º Grupo K", descB: "2º Grupo L", fase: "trinta_e_dois_avos", posA: "2K", posB: "2L" },
  { slotId: "M84", descA: "1º Grupo H", descB: "2º Grupo J", fase: "trinta_e_dois_avos", posA: "1H", posB: "2J" },
  { slotId: "M85", descA: "1º Grupo B", descB: "3º EFGIJ",   fase: "trinta_e_dois_avos", posA: "1B", posB: "3EFGIJ" },
  { slotId: "M86", descA: "1º Grupo J", descB: "2º Grupo H", fase: "trinta_e_dois_avos", posA: "1J", posB: "2H" },
  { slotId: "M87", descA: "1º Grupo K", descB: "3º DEIJL",   fase: "trinta_e_dois_avos", posA: "1K", posB: "3DEIJL" },
  { slotId: "M88", descA: "2º Grupo D", descB: "2º Grupo G", fase: "trinta_e_dois_avos", posA: "2D", posB: "2G" },
];

// Progressão oficial FIFA 2026 — qual jogo alimenta qual (NÃO é emparelhamento
// sequencial; segue o chaveamento publicado pela FIFA).
// Oitavas:
//   M89 = vencedores M74 + M77   M90 = M73 + M75
//   M91 = M76 + M78              M92 = M79 + M80
//   M93 = M83 + M84              M94 = M81 + M82
//   M95 = M86 + M88              M96 = M85 + M87
// Quartas: M89+M90 → M97, M93+M94 → M98, M91+M92 → M99, M95+M96 → M100
// Semis:   M97+M98 → M101, M99+M100 → M102
// Final:   M101+M102 → M104  |  3º lugar: perdedores M101/M102 → M103

type RoundSlot = {
  slotId: string;
  fase: string;
  feedA: string; // slotId que alimenta o time A
  feedB: string;
};

const SLOTS_OITAVAS: RoundSlot[] = [
  { slotId: "M89", fase: "oitavas", feedA: "M74", feedB: "M77" },
  { slotId: "M90", fase: "oitavas", feedA: "M73", feedB: "M75" },
  { slotId: "M91", fase: "oitavas", feedA: "M76", feedB: "M78" },
  { slotId: "M92", fase: "oitavas", feedA: "M79", feedB: "M80" },
  { slotId: "M93", fase: "oitavas", feedA: "M83", feedB: "M84" },
  { slotId: "M94", fase: "oitavas", feedA: "M81", feedB: "M82" },
  { slotId: "M95", fase: "oitavas", feedA: "M86", feedB: "M88" },
  { slotId: "M96", fase: "oitavas", feedA: "M85", feedB: "M87" },
];

const SLOTS_QUARTAS: RoundSlot[] = [
  { slotId: "M97", fase: "quartas", feedA: "M89", feedB: "M90" },
  { slotId: "M98", fase: "quartas", feedA: "M93", feedB: "M94" },
  { slotId: "M99", fase: "quartas", feedA: "M91", feedB: "M92" },
  { slotId: "M100", fase: "quartas", feedA: "M95", feedB: "M96" },
];

const SLOTS_SEMIS: RoundSlot[] = [
  { slotId: "M101", fase: "semifinais", feedA: "M97", feedB: "M98" },
  { slotId: "M102", fase: "semifinais", feedA: "M99", feedB: "M100" },
];

// Ordem de exibição do bracket (árvore). Os slots acima ficam em ordem de número
// de jogo (para casar com as partidas reais por horário), mas para desenhar o
// chaveamento cada par adjacente precisa alimentar o MESMO jogo da rodada
// seguinte. Estas ordens garantem que os conectores visuais batam com a
// progressão real (vencedor avança para o card logo à direita).
const ORDEM_DISPLAY_32 = [
  "M74", "M77", "M73", "M75", "M83", "M84", "M81", "M82",
  "M76", "M78", "M79", "M80", "M86", "M88", "M85", "M87",
];
const ORDEM_DISPLAY_OITAVAS = ["M89", "M90", "M93", "M94", "M91", "M92", "M95", "M96"];

const SLOT_TERCEIRO: RoundSlot = { slotId: "M103", fase: "disputa_terceiro", feedA: "M101", feedB: "M102" };
const SLOT_FINAL: RoundSlot = { slotId: "M104", fase: "final", feedA: "M101", feedB: "M102" };

// ---------------------------------------------------------------------------
// Cálculo de classificação
// ---------------------------------------------------------------------------

function calcularGols(
  partida: Partida,
  placares: Record<string, PlacarLive>,
): { gmand: number; gvis: number } | null {
  const live = placares[partida.id];
  if (live?.ao_vivo && live.gols_mandante_live != null && live.gols_visitante_live != null) {
    return { gmand: live.gols_mandante_live, gvis: live.gols_visitante_live };
  }
  if (partida.gols_mandante != null && partida.gols_visitante != null) {
    return { gmand: partida.gols_mandante, gvis: partida.gols_visitante };
  }
  return null;
}

function rowVazio(sel: Selecao): StandingRow {
  return { selecao: sel, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, pts: 0, amarelos: 0, vermelhos: 0 };
}

function compararHeadToHead(
  a: StandingRow,
  b: StandingRow,
  partidas: Partida[],
  placares: Record<string, PlacarLive>,
): number {
  // Critérios 1-3: pontos, saldo e gols nos confrontos diretos entre os dois
  let ptsA = 0, ptsB = 0, sgA = 0, sgB = 0, gpA = 0, gpB = 0;
  for (const p of partidas) {
    const isMvA = p.mandante_id === a.selecao.id && p.visitante_id === b.selecao.id;
    const isMvB = p.mandante_id === b.selecao.id && p.visitante_id === a.selecao.id;
    if (!isMvA && !isMvB) continue;
    const gols = calcularGols(p, placares);
    if (!gols) continue;
    const { gmand, gvis } = gols;
    if (isMvA) {
      sgA += gmand - gvis; gpA += gmand; sgB += gvis - gmand; gpB += gvis;
      if (gmand > gvis) ptsA += 3;
      else if (gmand === gvis) { ptsA += 1; ptsB += 1; }
      else ptsB += 3;
    } else {
      sgB += gmand - gvis; gpB += gmand; sgA += gvis - gmand; gpA += gvis;
      if (gmand > gvis) ptsB += 3;
      else if (gmand === gvis) { ptsA += 1; ptsB += 1; }
      else ptsA += 3;
    }
  }
  if (ptsA !== ptsB) return ptsB - ptsA;
  if (sgA !== sgB) return sgB - sgA;
  if (gpA !== gpB) return gpB - gpA;
  return 0;
}

function ordenarGrupo(
  rows: StandingRow[],
  partidas: Partida[],
  placares: Record<string, PlacarLive>,
): StandingRow[] {
  return [...rows].sort((a, b) => {
    // 1. Pontos totais
    if (b.pts !== a.pts) return b.pts - a.pts;

    // 2-4. Critérios de confronto direto (apenas entre os dois — simplificação para pares)
    const h2h = compararHeadToHead(a, b, partidas, placares);
    if (h2h !== 0) return h2h;

    // 5. Saldo de gols geral
    if (b.sg !== a.sg) return b.sg - a.sg;

    // 6. Gols marcados geral
    if (b.gp !== a.gp) return b.gp - a.gp;

    // 7. Fair play: amarelo = -1, vermelho = -4 (menos negativo = melhor)
    const fpA = (a.amarelos * -1) + (a.vermelhos * -4);
    const fpB = (b.amarelos * -1) + (b.vermelhos * -4);
    if (fpA !== fpB) return fpB - fpA;

    // 8. Ranking FIFA: menor número = melhor colocado
    const rA = a.selecao.fifa_ranking;
    const rB = b.selecao.fifa_ranking;
    if (rA != null && rB != null && rA !== rB) return rA - rB;

    return 0;
  });
}

function calcularClassificacao(
  selecoes: Selecao[],
  partidas: Partida[],
  placares: Record<string, PlacarLive>,
): Record<string, StandingRow[]> {
  const grupos: Record<string, Record<string, StandingRow>> = {};

  for (const sel of selecoes) {
    if (!sel.grupo) continue;
    if (!grupos[sel.grupo]) grupos[sel.grupo] = {};
    grupos[sel.grupo][sel.id] = rowVazio(sel);
  }

  for (const p of partidas) {
    if (p.fase !== "grupos" || !p.grupo) continue;
    const gols = calcularGols(p, placares);
    if (!gols) continue;
    const { gmand, gvis } = gols;
    const gr = grupos[p.grupo];
    if (!gr) continue;

    const mand = gr[p.mandante_id];
    const vis = gr[p.visitante_id];
    if (!mand || !vis) continue;

    mand.j++; mand.gp += gmand; mand.gc += gvis; mand.sg += gmand - gvis;
    vis.j++;  vis.gp += gvis;   vis.gc += gmand;  vis.sg += gvis - gmand;

    mand.amarelos  += p.cartoes_amarelos_mandante  ?? 0;
    mand.vermelhos += p.cartoes_vermelhos_mandante ?? 0;
    vis.amarelos   += p.cartoes_amarelos_visitante  ?? 0;
    vis.vermelhos  += p.cartoes_vermelhos_visitante ?? 0;

    if (gmand > gvis)       { mand.v++; mand.pts += 3; vis.d++; }
    else if (gmand === gvis) { mand.e++; mand.pts += 1; vis.e++; vis.pts += 1; }
    else                     { mand.d++; vis.v++;  vis.pts += 3; }
  }

  const gruposPartidas: Record<string, Partida[]> = {};
  for (const p of partidas) {
    if (p.fase !== "grupos" || !p.grupo) continue;
    if (!gruposPartidas[p.grupo]) gruposPartidas[p.grupo] = [];
    gruposPartidas[p.grupo].push(p);
  }

  const resultado: Record<string, StandingRow[]> = {};
  for (const g of Object.keys(grupos).sort()) {
    const rows = Object.values(grupos[g]);
    resultado[g] = ordenarGrupo(rows, gruposPartidas[g] ?? [], placares);
  }
  return resultado;
}

// Ranking dos terceiros colocados (melhor → pior) pelos critérios oficiais da
// FIFA: (1) pontos, (2) saldo de gols, (3) gols pró, (4) fair play (conduta),
// (5) ranking FIFA. Mantém o GRUPO de cada um (necessário p/ a tabela do Anexo C).
function rankearTerceiros(
  classificacao: Record<string, StandingRow[]>,
): { grupo: string; row: StandingRow }[] {
  const terceiros: { grupo: string; row: StandingRow }[] = [];
  for (const [grupo, rows] of Object.entries(classificacao)) {
    if (rows.length >= 3) terceiros.push({ grupo, row: rows[2] });
  }
  terceiros.sort(({ row: a }, { row: b }) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.sg !== a.sg) return b.sg - a.sg;
    if (b.gp !== a.gp) return b.gp - a.gp;
    // Critério 4: fair play
    const fpA = (a.amarelos * -1) + (a.vermelhos * -4);
    const fpB = (b.amarelos * -1) + (b.vermelhos * -4);
    if (fpA !== fpB) return fpB - fpA;
    // Critério 5: ranking FIFA
    const rA = a.selecao.fifa_ranking;
    const rB = b.selecao.fifa_ranking;
    if (rA != null && rB != null && rA !== rB) return rA - rB;
    return 0;
  });
  return terceiros;
}

function calcularMelhoresTerceiros(
  classificacao: Record<string, StandingRow[]>,
): Set<string> {
  return new Set(
    rankearTerceiros(classificacao).slice(0, 8).map((t) => t.row.selecao.id),
  );
}

// Resolve, via a tabela oficial de combinações (Anexo C), qual SELEÇÃO (3º
// colocado) cada MANDANTE enfrenta nos 32 avos. Retorna mapa: grupo do mandante
// (ex.: "E" para o jogo 1E×3X) → seleção do terceiro. Vazio quando ainda não há
// 8 terceiros determináveis ou a combinação não consta na tabela.
function resolverTerceiros(
  classificacao: Record<string, StandingRow[]>,
): Record<string, Selecao> {
  const ranking = rankearTerceiros(classificacao);
  if (ranking.length < 8) return {};
  const classificados = ranking.slice(0, 8);
  const combo = classificados.map((t) => t.grupo).sort().join("");
  const alocacao = TERCEIRO_ALLOC[combo];
  if (!alocacao) return {};
  // grupo do terceiro → seleção (3º colocado daquele grupo)
  const selPorGrupo: Record<string, Selecao> = {};
  for (const { grupo, row } of classificados) selPorGrupo[grupo] = row.selecao;
  // alocacao[i] = grupo do terceiro que enfrenta o mandante MANDANTES_TERCEIRO[i]
  const out: Record<string, Selecao> = {};
  MANDANTES_TERCEIRO.forEach((mandante, i) => {
    const sel = selPorGrupo[alocacao[i]];
    if (sel) out[mandante] = sel;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

function TabelaPage() {
  const [aba, setAba] = useState<"grupos" | "matamata">("grupos");
  const [loading, setLoading] = useState(true);
  const [selecoes, setSelecoes] = useState<Selecao[]>([]);
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [mataMata, setMataMata] = useState<Partida[]>([]);
  const [placares, setPlacares] = useState<Record<string, PlacarLive>>({});
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: sels }, { data: parts }, { data: mm }, { data: u }] = await Promise.all([
        supabase.from("selecoes").select("id,codigo,nome,bandeira,grupo,fifa_ranking"),
        supabase.from("partidas").select("id,fase,grupo,mandante_id,visitante_id,gols_mandante,gols_visitante,status,data_hora,estadio,bracket_slot,cartoes_amarelos_mandante,cartoes_vermelhos_mandante,cartoes_amarelos_visitante,cartoes_vermelhos_visitante").eq("fase", "grupos"),
        supabase.from("partidas").select("id,fase,grupo,mandante_id,visitante_id,gols_mandante,gols_visitante,status,data_hora,estadio,bracket_slot,cartoes_amarelos_mandante,cartoes_vermelhos_mandante,cartoes_amarelos_visitante,cartoes_vermelhos_visitante").neq("fase", "grupos"),
        supabase.auth.getUser(),
      ]);

      setSelecoes((sels ?? []) as Selecao[]);
      setPartidas((parts ?? []) as Partida[]);
      setMataMata((mm ?? []) as Partida[]);

      if (u.user) {
        const { data: perfil } = await supabase.from("perfis").select("is_admin").eq("id", u.user.id).maybeSingle();
        setIsAdmin(!!perfil?.is_admin);
      }

      setLoading(false);
    })();
  }, []);

  // Polling de placares ao vivo (mesmo padrão de palpites.grupos.tsx)
  useEffect(() => {
    let cancelado = false;
    async function buscarLive(): Promise<boolean> {
      const { data } = await supabase
        .from("placares_ao_vivo")
        .select("partida_id,gols_mandante_live,gols_visitante_live,ao_vivo")
        .eq("ao_vivo", true);
      if (cancelado) return false;
      const m: Record<string, PlacarLive> = {};
      (data ?? []).forEach((l) => (m[l.partida_id] = l as PlacarLive));
      setPlacares(m);
      return (data ?? []).length > 0;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = (temLive: boolean) => {
      if (cancelado) return;
      timer = setTimeout(loop, temLive ? 45_000 : 5 * 60_000);
    };
    async function loop() {
      const temLive = await buscarLive();
      agendar(temLive);
    }
    void buscarLive().then(agendar);
    return () => { cancelado = true; clearTimeout(timer); };
  }, []);

  const classificacao = useMemo(
    () => calcularClassificacao(selecoes, partidas, placares),
    [selecoes, partidas, placares],
  );

  const melhoresTerceiros = useMemo(
    () => calcularMelhoresTerceiros(classificacao),
    [classificacao],
  );

  const temLive = Object.values(placares).some((p) => p.ao_vivo);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Tabela</h1>
        {temLive && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Ao vivo
          </span>
        )}
      </div>

      {/* Toggle de abas */}
      <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1 gap-1">
        <button
          onClick={() => setAba("grupos")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${aba === "grupos" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Grupos
        </button>
        <button
          onClick={() => setAba("matamata")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${aba === "matamata" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Mata-Mata
        </button>
      </div>

      {aba === "grupos" ? (
        <SubabaGrupos
          classificacao={classificacao}
          melhoresTerceiros={melhoresTerceiros}
          selecoes={selecoes}
          partidas={partidas}
          placares={placares}
        />
      ) : (
        <SubabaMataMAta
          mataMata={mataMata}
          placares={placares}
          selecoes={selecoes}
          classificacao={classificacao}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subaba Grupos
// ---------------------------------------------------------------------------

function statusClassif(
  pos: number,
  selecaoId: string,
  melhoresTerceiros: Set<string>,
): "classif" | "possivel3" | "eliminado" {
  if (pos <= 2) return "classif";
  if (pos === 3 && melhoresTerceiros.has(selecaoId)) return "possivel3";
  return "eliminado";
}

function SubabaGrupos({
  classificacao,
  melhoresTerceiros,
  selecoes,
  partidas,
  placares,
}: {
  classificacao: Record<string, StandingRow[]>;
  melhoresTerceiros: Set<string>;
  selecoes: Selecao[];
  partidas: Partida[];
  placares: Record<string, PlacarLive>;
}) {
  const temDados = Object.keys(classificacao).length > 0;

  // Verifica se há algum jogo ao vivo para mostrar nota
  const temLiveNasFase = partidas.some(
    (p) => p.fase === "grupos" && placares[p.id]?.ao_vivo,
  );

  // Verifica se ranking FIFA está disponível (seed já rodou)
  const temRankingFifa = selecoes.some((s) => s.fifa_ranking != null);

  return (
    <div className="space-y-4">
      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-1 rounded-full bg-emerald-500" />
          Classificado (1º e 2º)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-1 rounded-full bg-amber-400" />
          Possível melhor 3º
        </span>
        {temLiveNasFase && (
          <span className="flex items-center gap-1.5 text-red-500">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Refletindo placar ao vivo
          </span>
        )}
      </div>

      {!temDados ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhum dado de grupo disponível.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(classificacao).map(([grupo, rows]) => (
            <GrupoCard
              key={grupo}
              grupo={grupo}
              rows={rows}
              melhoresTerceiros={melhoresTerceiros}
            />
          ))}
        </div>
      )}

      {!temRankingFifa && (
        <p className="text-xs text-muted-foreground/60">
          Classificação reflete resultados finalizados + placares ao vivo. Critérios de desempate por fair play e ranking FIFA não aplicados (dados indisponíveis).
        </p>
      )}
    </div>
  );
}

function GrupoCard({
  grupo,
  rows,
  melhoresTerceiros,
}: {
  grupo: string;
  rows: StandingRow[];
  melhoresTerceiros: Set<string>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-secondary/20 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Grupo {grupo}</h2>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 text-muted-foreground">
            <th className="w-6 py-2 pl-3 pr-1 text-left font-normal">#</th>
            <th className="py-2 pr-2 text-left font-normal">Seleção</th>
            <th className="w-6 py-2 text-center font-normal">P</th>
            <th className="w-6 py-2 text-center font-normal">J</th>
            <th className="w-7 py-2 text-center font-normal">GP</th>
            <th className="w-7 py-2 text-center font-normal">GC</th>
            <th className="w-8 py-2 pr-3 text-center font-normal">SG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const pos = idx + 1;
            const status = statusClassif(pos, row.selecao.id, melhoresTerceiros);
            const borderClass =
              status === "classif"
                ? "border-l-2 border-l-emerald-500"
                : status === "possivel3"
                ? "border-l-2 border-l-amber-400"
                : "border-l-2 border-l-transparent";

            return (
              <tr
                key={row.selecao.id}
                className={`border-b border-border/40 last:border-0 ${borderClass}`}
              >
                <td className="py-2 pl-3 pr-1 text-muted-foreground">{pos}</td>
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-1.5">
                    <Flag codigo={row.selecao.codigo} size={14} />
                    <span className="truncate font-medium">{row.selecao.nome}</span>
                  </span>
                </td>
                <td className="py-2 text-center font-bold">{row.pts}</td>
                <td className="py-2 text-center text-muted-foreground">{row.j}</td>
                <td className="py-2 text-center text-muted-foreground">{row.gp}</td>
                <td className="py-2 text-center text-muted-foreground">{row.gc}</td>
                <td className="py-2 pr-3 text-center text-muted-foreground">
                  {row.sg > 0 ? `+${row.sg}` : row.sg}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subaba Mata-Mata — Bracket
// ---------------------------------------------------------------------------

// Resolve qual time real está em um slot, dada a classificação e as partidas
function resolverSlot(
  posCode: string, // ex: "1A", "2B", "3CEFHI"
  classificacao: Record<string, StandingRow[]>,
): Selecao | null {
  if (!posCode || posCode.startsWith("3")) return null; // terceiros não resolvidos automaticamente
  const pos = parseInt(posCode[0]);
  const grupo = posCode[1];
  const rows = classificacao[grupo];
  if (!rows || rows.length < pos) return null;
  return rows[pos - 1].selecao;
}

// Dado um slotId de rodada anterior, resolve qual seleção venceu aquela partida
function resolverVencedor(
  slotId: string,
  partidasPorSlot: Map<string, Partida>,
  selMap: Record<string, Selecao>,
): Selecao | null {
  const p = partidasPorSlot.get(slotId);
  if (!p || p.gols_mandante == null || p.gols_visitante == null) return null;
  if (p.gols_mandante > p.gols_visitante) return selMap[p.mandante_id] ?? null;
  if (p.gols_visitante > p.gols_mandante) return selMap[p.visitante_id] ?? null;
  return null; // empate na pênaltis (não rastreado aqui)
}

type ResolvedCard = {
  slotId: string;
  fase: string;
  partida: Partida | null;
  selA: Selecao | null;
  selB: Selecao | null;
  descA: string;
  descB: string;
};

function SubabaMataMAta({
  mataMata,
  placares,
  selecoes,
  classificacao,
  isAdmin,
}: {
  mataMata: Partida[];
  placares: Record<string, PlacarLive>;
  selecoes: Selecao[];
  classificacao: Record<string, StandingRow[]>;
  isAdmin: boolean;
}) {
  const router = useRouter();

  const selMap = useMemo(() => {
    const m: Record<string, Selecao> = {};
    selecoes.forEach((s) => (m[s.id] = s));
    return m;
  }, [selecoes]);

  // Mapeia partidas de mata-mata por fase para localizar por slot
  // Como não temos um campo slotId no banco, usamos a ordem de criação dentro da fase
  // A correspondência é: partidas ordenadas por data_hora dentro de cada fase = slots em ordem
  const partidasPorFase = useMemo(() => {
    const m: Record<string, Partida[]> = {};
    for (const p of mataMata) {
      if (!m[p.fase]) m[p.fase] = [];
      m[p.fase].push(p);
    }
    for (const fase of Object.keys(m)) {
      m[fase].sort((a, b) => (a.data_hora ?? "").localeCompare(b.data_hora ?? ""));
    }
    return m;
  }, [mataMata]);

  // Mapa slotId → partida.
  // Preferência: o slot gravado em partidas.bracket_slot (vínculo explícito,
  // imune a horário). Fallback (partidas antigas sem bracket_slot): preenche os
  // slots ainda livres da fase na ordem cronológica por data_hora.
  const partidasPorSlot = useMemo(() => {
    const m = new Map<string, Partida>();
    const ordemFases: { fase: string; slots: string[] }[] = [
      { fase: "trinta_e_dois_avos", slots: SLOTS_32AVOS.map((s) => s.slotId) },
      { fase: "oitavas", slots: SLOTS_OITAVAS.map((s) => s.slotId) },
      { fase: "quartas", slots: SLOTS_QUARTAS.map((s) => s.slotId) },
      { fase: "semifinais", slots: SLOTS_SEMIS.map((s) => s.slotId) },
      { fase: "disputa_terceiro", slots: [SLOT_TERCEIRO.slotId] },
      { fase: "final", slots: [SLOT_FINAL.slotId] },
    ];
    for (const { fase, slots } of ordemFases) {
      const parts = partidasPorFase[fase] ?? [];
      const slotsValidos = new Set(slots);
      // 1) Vínculo explícito por bracket_slot.
      const semVinculo: Partida[] = [];
      for (const p of parts) {
        if (p.bracket_slot && slotsValidos.has(p.bracket_slot)) {
          m.set(p.bracket_slot, p);
        } else {
          semVinculo.push(p);
        }
      }
      // 2) Fallback cronológico para os slots que sobraram (já ordenado por data_hora).
      const livres = slots.filter((s) => !m.has(s));
      semVinculo.forEach((p, i) => {
        if (livres[i]) m.set(livres[i], p);
      });
    }
    return m;
  }, [partidasPorFase]);

  // Times que já estão numa partida real de cada fase. A projeção (resolverSlot/
  // resolverVencedor) NÃO pode reposicionar esses times em outro slot, senão o
  // mesmo time apareceria duas vezes: uma no card da partida real (ligado por
  // ordem de data_hora) e outra no slot "natural" projetado pela classificação.
  const idsEmPartidaReal = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const p of mataMata) {
      (m[p.fase] ??= new Set()).add(p.mandante_id);
      m[p.fase].add(p.visitante_id);
    }
    return m;
  }, [mataMata]);

  // Alocação projetada dos 8 melhores terceiros (mapa grupo-do-mandante → seleção).
  const terceiros = useMemo(() => resolverTerceiros(classificacao), [classificacao]);

  // Resolve uma posição do card. Para "1X"/"2X" usa a classificação do grupo;
  // para "3X..." usa a tabela oficial do Anexo C — o terceiro é definido pelo
  // mandante do confronto (a outra posição do card, sempre "1X" nesses slots).
  function resolverPos(pos: string, posMandante: string): Selecao | null {
    if (pos.startsWith("3")) return terceiros[posMandante[1]] ?? null;
    return resolverSlot(pos, classificacao);
  }

  function buildCard(slotId: string, descA: string, descB: string, posA: string, posB: string, fase: string): ResolvedCard {
    const partida = partidasPorSlot.get(slotId) ?? null;
    let selA: Selecao | null = null;
    let selB: Selecao | null = null;
    if (partida) {
      selA = selMap[partida.mandante_id] ?? null;
      selB = selMap[partida.visitante_id] ?? null;
    } else {
      // Tentar resolver do bracket de grupos, mas sem reprojetar times que já
      // estão numa partida real desta fase (evita card duplicado).
      const usados = idsEmPartidaReal[fase];
      selA = resolverPos(posA, posB);
      selB = resolverPos(posB, posA);
      if (usados?.has(selA?.id ?? "")) selA = null;
      if (usados?.has(selB?.id ?? "")) selB = null;
    }
    return { slotId, fase, partida, selA, selB, descA, descB };
  }

  function buildRoundCard(slot: RoundSlot): ResolvedCard {
    const partida = partidasPorSlot.get(slot.slotId) ?? null;
    let selA: Selecao | null = null;
    let selB: Selecao | null = null;
    if (partida) {
      selA = selMap[partida.mandante_id] ?? null;
      selB = selMap[partida.visitante_id] ?? null;
    } else {
      const usados = idsEmPartidaReal[slot.fase];
      selA = resolverVencedor(slot.feedA, partidasPorSlot, selMap);
      selB = resolverVencedor(slot.feedB, partidasPorSlot, selMap);
      if (usados?.has(selA?.id ?? "")) selA = null;
      if (usados?.has(selB?.id ?? "")) selB = null;
    }
    const descA = `Vencedor ${slot.feedA}`;
    const descB = `Vencedor ${slot.feedB}`;
    return { slotId: slot.slotId, fase: slot.fase, partida, selA, selB, descA, descB };
  }

  const cards32 = SLOTS_32AVOS.map((s) => buildCard(s.slotId, s.descA, s.descB, s.posA, s.posB, s.fase));
  const cardsOitavas = SLOTS_OITAVAS.map(buildRoundCard);
  const cardsQuartas = SLOTS_QUARTAS.map(buildRoundCard);

  // Reordena para a árvore do bracket (ver ORDEM_DISPLAY_*): cada par adjacente
  // alimenta o jogo logo à direita, então os conectores ficam corretos.
  const porSlot = (cs: ResolvedCard[]) => new Map(cs.map((c) => [c.slotId, c]));
  const cards32Map = porSlot(cards32);
  const cardsOitavasMap = porSlot(cardsOitavas);
  const cards32Display = ORDEM_DISPLAY_32.map((id) => cards32Map.get(id)!);
  const cardsOitavasDisplay = ORDEM_DISPLAY_OITAVAS.map((id) => cardsOitavasMap.get(id)!);
  const cardsSemis = SLOTS_SEMIS.map(buildRoundCard);
  const cardTerceiro = buildRoundCard(SLOT_TERCEIRO);
  const cardFinal = buildRoundCard(SLOT_FINAL);

  function handleAdminClick(card: ResolvedCard, _slot: BracketSlot | null) {
    router.navigate({
      to: "/admin",
      search: {
        prefill_fase: card.fase,
        prefill_mandante: card.selA?.codigo,
        prefill_visitante: card.selB?.codigo,
        prefill_slot: card.slotId,
      },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Chaveamento oficial FIFA 2026. Os slots "3º" refletem os 8 melhores terceiros após a fase de grupos.
      </p>
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-0 min-w-[900px]">
          {/* Coluna 32 avos */}
          <BracketColumn
            label="32 avos"
            cards={cards32Display}
            isAdmin={isAdmin}
            onAdminClick={(card) => {
              const slot = SLOTS_32AVOS.find((s) => s.slotId === card.slotId) ?? null;
              handleAdminClick(card, slot);
            }}
            placares={placares}
            colIndex={0}
            totalCols={5}
          />
          {/* Conector 32→Oitavas */}
          <BracketConnectors from={16} to={8} />

          {/* Coluna Oitavas */}
          <BracketColumn
            label="Oitavas"
            cards={cardsOitavasDisplay}
            isAdmin={isAdmin}
            onAdminClick={(card) => handleAdminClick(card, null)}
            placares={placares}
            colIndex={1}
            totalCols={5}
          />
          <BracketConnectors from={8} to={4} />

          {/* Coluna Quartas */}
          <BracketColumn
            label="Quartas"
            cards={cardsQuartas}
            isAdmin={isAdmin}
            onAdminClick={(card) => handleAdminClick(card, null)}
            placares={placares}
            colIndex={2}
            totalCols={5}
          />
          <BracketConnectors from={4} to={2} />

          {/* Coluna Semis */}
          <BracketColumn
            label="Semifinais"
            cards={cardsSemis}
            isAdmin={isAdmin}
            onAdminClick={(card) => handleAdminClick(card, null)}
            placares={placares}
            colIndex={3}
            totalCols={5}
          />
          <BracketConnectors from={2} to={1} />

          {/* Coluna Final + 3º lugar */}
          <div className="flex flex-col">
            <div className="px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Final
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <BracketCard
                card={cardFinal}
                isAdmin={isAdmin}
                onAdminClick={() => handleAdminClick(cardFinal, null)}
                placares={placares}
                highlight
              />
              <div className="text-[10px] text-muted-foreground/60 text-center">3º lugar</div>
              <BracketCard
                card={cardTerceiro}
                isAdmin={isAdmin}
                onAdminClick={() => handleAdminClick(cardTerceiro, null)}
                placares={placares}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componentes do bracket
// ---------------------------------------------------------------------------

const CARD_H = 60; // altura de cada card em px
const CARD_GAP = 8; // gap entre cards na mesma coluna

function BracketColumn({
  label,
  cards,
  isAdmin,
  onAdminClick,
  placares,
  colIndex,
  totalCols: _totalCols,
}: {
  label: string;
  cards: ResolvedCard[];
  isAdmin: boolean;
  onAdminClick: (card: ResolvedCard) => void;
  placares: Record<string, PlacarLive>;
  colIndex: number;
  totalCols: number;
}) {
  // Espaçamento vertical: duplica a cada rodada
  const gapMultiplier = Math.pow(2, colIndex);
  const extraGap = (CARD_H + CARD_GAP) * (gapMultiplier - 1);

  return (
    <div className="flex flex-col w-[170px] shrink-0">
      <div className="px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-col" style={{ gap: `${CARD_GAP + extraGap}px`, paddingTop: `${extraGap / 2}px` }}>
        {cards.map((card) => (
          <BracketCard
            key={card.slotId}
            card={card}
            isAdmin={isAdmin}
            onAdminClick={() => onAdminClick(card)}
            placares={placares}
          />
        ))}
      </div>
    </div>
  );
}

function BracketConnectors({ from, to }: { from: number; to: number }) {
  // SVG com linhas de conexão entre colunas
  const pairs = from / 2; // número de pares
  const gapIn = (CARD_H + CARD_GAP); // espaço por card na coluna de entrada
  const gapOut = gapIn * 2; // espaço por card na coluna de saída (dobrado)

  const paddingTop = (gapIn - CARD_H) / 2; // alinha o primeiro card
  const height = from * gapIn + paddingTop * 2;

  const lines: React.ReactElement[] = [];
  for (let i = 0; i < pairs; i++) {
    const yA = paddingTop + i * 2 * gapIn + CARD_H / 2;
    const yB = paddingTop + (i * 2 + 1) * gapIn + CARD_H / 2;
    const yMid = paddingTop + gapIn / 2 + i * gapOut * 2; // centro do card de saída — aproximado
    const yOut = paddingTop + i * gapOut * 2 + gapOut / 2; // centro real do card de saída
    // linha horizontal da saída do card A
    lines.push(<line key={`ha${i}`} x1="0" y1={yA} x2="16" y2={yA} stroke="currentColor" strokeWidth="1" />);
    // linha horizontal da saída do card B
    lines.push(<line key={`hb${i}`} x1="0" y1={yB} x2="16" y2={yB} stroke="currentColor" strokeWidth="1" />);
    // linha vertical unindo A e B
    lines.push(<line key={`v${i}`} x1="16" y1={yA} x2="16" y2={yB} stroke="currentColor" strokeWidth="1" />);
    // linha horizontal para o próximo card
    lines.push(<line key={`ho${i}`} x1="16" y1={(yA + yB) / 2} x2="32" y2={(yA + yB) / 2} stroke="currentColor" strokeWidth="1" />);
  }

  return (
    <svg
      width="32"
      height={height}
      className="shrink-0 text-border"
      style={{ paddingTop: `${paddingTop}px` }}
    >
      {lines}
    </svg>
  );
}

function BracketCard({
  card,
  isAdmin,
  onAdminClick,
  placares,
  highlight = false,
}: {
  card: ResolvedCard;
  isAdmin: boolean;
  onAdminClick: () => void;
  placares: Record<string, PlacarLive>;
  highlight?: boolean;
}) {
  const live = card.partida ? placares[card.partida.id] : null;
  const isLive = live?.ao_vivo;
  const isFinished =
    card.partida?.gols_mandante != null && card.partida?.gols_visitante != null;

  const gmand = isLive ? (live?.gols_mandante_live ?? null) : (card.partida?.gols_mandante ?? null);
  const gvis = isLive ? (live?.gols_visitante_live ?? null) : (card.partida?.gols_visitante ?? null);

  const selA = card.selA;
  const selB = card.selB;

  return (
    <div
      className={`relative rounded-lg border bg-card text-xs transition-shadow hover:shadow-md ${
        highlight ? "border-primary/50 shadow-sm shadow-primary/10" : "border-border"
      } ${isLive ? "ring-1 ring-red-500/50" : ""}`}
      style={{ height: `${CARD_H}px`, width: "100%" }}
    >
      {/* Time A */}
      <div className={`flex items-center justify-between px-2 py-1.5 ${isFinished && gmand != null && gvis != null && gmand > gvis! ? "font-semibold" : ""}`}>
        <span className="flex items-center gap-1.5 truncate">
          {selA ? (
            <>
              <Flag codigo={selA.codigo} size={12} />
              <span className="truncate">{selA.nome}</span>
            </>
          ) : (
            <span className="text-muted-foreground/60 truncate">{card.descA}</span>
          )}
        </span>
        <span className={`ml-1 shrink-0 font-mono ${isLive ? "text-red-500" : ""}`}>
          {gmand != null ? gmand : ""}
        </span>
      </div>

      {/* Divisor */}
      <div className="mx-2 border-t border-border/40" />

      {/* Time B */}
      <div className={`flex items-center justify-between px-2 py-1.5 ${isFinished && gmand != null && gvis != null && gvis > gmand! ? "font-semibold" : ""}`}>
        <span className="flex items-center gap-1.5 truncate">
          {selB ? (
            <>
              <Flag codigo={selB.codigo} size={12} />
              <span className="truncate">{selB.nome}</span>
            </>
          ) : (
            <span className="text-muted-foreground/60 truncate">{card.descB}</span>
          )}
        </span>
        <span className={`ml-1 shrink-0 font-mono ${isLive ? "text-red-500" : ""}`}>
          {gvis != null ? gvis : ""}
        </span>
      </div>

      {/* Indicador ao vivo */}
      {isLive && (
        <span className="absolute right-1 top-0.5 flex items-center gap-0.5 text-[9px] text-red-500 font-medium">
          <span className="h-1 w-1 rounded-full bg-red-500 animate-pulse" />
          AO VIVO
        </span>
      )}

      {/* Botão admin */}
      {isAdmin && !card.partida && (
        <button
          onClick={onAdminClick}
          title="Criar este jogo no admin"
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-primary hover:text-primary-foreground transition-colors z-10"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
