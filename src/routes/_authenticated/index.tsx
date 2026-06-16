import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Trophy,
  Clock,
  AlertTriangle,
  Star,
  Loader2,
  CheckCircle2,
  History,
  Target,
  XCircle,
  Crosshair,
  Send,
  LineChart as LineChartIcon,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Flag } from "@/components/Flag";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Início — BolãoEEL" },
      { name: "description", content: "Seu painel no BolãoEEL." },
    ],
  }),
  component: Dashboard,
});

// Prazo fixo dos palpites extras (igual a palpites.grupos): 13/06/2026 15h Brasília = 18:00 UTC
const PRAZO_EXTRAS = new Date("2026-06-13T18:00:00Z");

type Selecao = { id: string; nome: string; codigo: string; bandeira: string | null };

type RankingBolao = {
  bolaoId: string;
  nome: string;
  posicao: number;
  total: number;
  pontos: number;
};

type JogoPendente = {
  partidaId: string;
  dataHora: string;
  mandante?: Selecao;
  visitante?: Selecao;
};

type JogoEnviado = {
  partidaId: string;
  dataHora: string;
  mandante?: Selecao;
  visitante?: Selecao;
  golsMandante: number;
  golsVisitante: number;
};

type ExtrasResumo = {
  bolaoId: string;
  nome: string;
  artilheiro: string | null;
  campeao: Selecao | null;
  completo: boolean;
};

type Resumo = {
  certos: number; // acertou resultado (inclui placar exato)
  errados: number; // palpitou e errou o resultado
  exatos: number; // placar exato
  pontos: number;
  semPalpite: number; // partidas finalizadas sem palpite (só faz sentido p/ o usuário)
};

// Linha do gráfico de evolução: um ponto por dia, posição e pontos ao final daquele dia.
type PontoEvolucao = {
  dia: string;
  rotulo: string;
  posicao: number;
  pontos: number;
  total: number;
};

// Tipos auxiliares usados nas consultas
type PartidaResultado = {
  id: string;
  data_hora: string | null;
  gols_mandante: number;
  gols_visitante: number;
  mandante_id: string;
  visitante_id: string;
};
type PalpiteRow = {
  usuario_id: string;
  partida_id: string;
  gols_mandante: number;
  gols_visitante: number;
  pontos_ganhos: number | null;
};

function resultado(gm: number, gv: number): "M" | "V" | "E" {
  return gm > gv ? "M" : gm < gv ? "V" : "E";
}

function Dashboard() {
  const [nome, setNome] = useState<string>("");
  const [rankings, setRankings] = useState<RankingBolao[]>([]);
  const [pendentes, setPendentes] = useState<JogoPendente[]>([]);
  const [enviados, setEnviados] = useState<JogoEnviado[]>([]);
  const [extras, setExtras] = useState<ExtrasResumo[]>([]);
  const [extrasAbertos, setExtrasAbertos] = useState(true);
  const [resumoUltimos5, setResumoUltimos5] = useState<Resumo | null>(null);
  const [resumoGeral, setResumoGeral] = useState<Resumo | null>(null);
  // Evolução no ranking: uma série de pontos por bolão.
  const [evolucao, setEvolucao] = useState<Record<string, PontoEvolucao[]>>({});
  const [bolaoNomesMap, setBolaoNomesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const uid = u.user.id;

        setExtrasAbertos(new Date() < PRAZO_EXTRAS);

        const { data: perfil } = await supabase
          .from("perfis")
          .select("nome_usuario")
          .eq("id", uid)
          .maybeSingle();
        setNome(perfil?.nome_usuario ?? u.user.email ?? "");

        // --- Palpites do usuário (quais partidas já tem palpite) ---
        const { data: palpitesUsuario } = await supabase
          .from("palpites")
          .select("partida_id,pontos_ganhos")
          .eq("usuario_id", uid);
        const palpitados = new Set(
          (palpitesUsuario ?? []).map((p: { partida_id: string }) => p.partida_id),
        );

        // --- Bolões do usuário ---
        const { data: mb } = await supabase
          .from("membros_bolao")
          .select("bolao_id")
          .eq("usuario_id", uid);
        const bolaoIds = (mb ?? []).map((m: { bolao_id: string }) => m.bolao_id);

        const bolaoNomes: Record<string, string> = {};
        if (bolaoIds.length > 0) {
          const { data: bs } = await supabase.from("boloes").select("id,nome").in("id", bolaoIds);
          (bs ?? []).forEach((b: { id: string; nome: string }) => {
            bolaoNomes[b.id] = b.nome;
          });
        }
        setBolaoNomesMap(bolaoNomes);

        // --- Membros de cada bolão (reusado em ranking, resumo do bolão e evolução) ---
        const membrosPorBolao: Record<string, string[]> = {};
        for (const bid of bolaoIds) {
          const { data: membros } = await supabase
            .from("membros_bolao")
            .select("usuario_id")
            .eq("bolao_id", bid);
          membrosPorBolao[bid] = (membros ?? []).map((m: { usuario_id: string }) => m.usuario_id);
        }

        // --- Seleções (flags em jogos pendentes, enviados, extras e histórico) ---
        const { data: sels } = await supabase.from("selecoes").select("id,nome,codigo,bandeira");
        const selMap: Record<string, Selecao> = {};
        (sels ?? []).forEach((s) => (selMap[s.id] = s as Selecao));

        // --- Posição no ranking de cada bolão ---
        const rankingsTmp: RankingBolao[] = [];
        for (const bid of bolaoIds) {
          const memberIds = membrosPorBolao[bid] ?? [];
          if (memberIds.length === 0) continue;

          const { data: ptsRows } = await supabase
            .from("v_pontuacao_usuario")
            .select("usuario_id,pontos_total,jogos_pontuados")
            .in("usuario_id", memberIds);

          const ordenado = (ptsRows ?? [])
            .map((p) => {
              const r = p as {
                usuario_id: string;
                pontos_total: number;
                jogos_pontuados: number;
              };
              return r;
            })
            .sort(
              (a, b) => b.pontos_total - a.pontos_total || b.jogos_pontuados - a.jogos_pontuados,
            );

          const idx = ordenado.findIndex((r) => r.usuario_id === uid);
          rankingsTmp.push({
            bolaoId: bid,
            nome: bolaoNomes[bid] ?? "Bolão",
            posicao: idx >= 0 ? idx + 1 : ordenado.length + 1,
            total: ordenado.length || memberIds.length,
            pontos: idx >= 0 ? ordenado[idx].pontos_total : 0,
          });
        }
        rankingsTmp.sort((a, b) => a.posicao - b.posicao);
        setRankings(rankingsTmp);

        // --- Partidas finalizadas (com placar lançado), mais recentes primeiro ---
        const { data: finalizadasRaw } = await supabase
          .from("partidas")
          .select("id,data_hora,gols_mandante,gols_visitante,mandante_id,visitante_id")
          .not("gols_mandante", "is", null)
          .not("gols_visitante", "is", null)
          .order("data_hora", { ascending: false });
        const finalizadas = (finalizadasRaw ?? []) as PartidaResultado[];

        // --- Histórico do usuário: últimos 5 jogos + geral (toda a história) ---
        // Carrega TODOS os palpites do usuário com gols, casados com as partidas finalizadas.
        const { data: meusTodos } = await supabase
          .from("palpites")
          .select("partida_id,gols_mandante,gols_visitante,pontos_ganhos")
          .eq("usuario_id", uid);
        const meusMap = new Map(
          (meusTodos ?? []).map((p) => [(p as { partida_id: string }).partida_id, p as PalpiteRow]),
        );

        // Resumo geral: todas as partidas finalizadas.
        setResumoGeral(
          agregar(
            finalizadas.map((part) => {
              const pal = meusMap.get(part.id) ?? null;
              return { partida: part, palpite: pal };
            }),
          ),
        );

        // Resumo dos últimos 5 jogos finalizados.
        const ultimas5 = finalizadas.slice(0, 5);
        setResumoUltimos5(
          agregar(
            ultimas5.map((part) => {
              const pal = meusMap.get(part.id) ?? null;
              return { partida: part, palpite: pal };
            }),
          ),
        );

        // --- Evolução no ranking (reconstruída a partir das datas das partidas) ---
        const evoTmp: Record<string, PontoEvolucao[]> = {};
        for (const bid of bolaoIds) {
          const memberIds = membrosPorBolao[bid] ?? [];
          if (memberIds.length === 0) continue;
          const serie = await construirEvolucao(bid, uid, memberIds, finalizadas);
          if (serie.length > 0) evoTmp[bid] = serie;
        }
        setEvolucao(evoTmp);

        // --- Jogos futuros (pendentes sem palpite + enviados com palpite) ---
        const agora = new Date();
        const { data: parts } = await supabase
          .from("partidas")
          .select("id,status,data_hora,mandante_id,visitante_id")
          .eq("status", "aguardando")
          .not("data_hora", "is", null)
          .order("data_hora", { ascending: true });

        const futuros = (parts ?? []).filter((p) => {
          const r = p as { data_hora: string };
          return new Date(r.data_hora) > agora;
        });

        const pend: JogoPendente[] = futuros
          .filter((p) => !palpitados.has((p as { id: string }).id))
          .slice(0, 5)
          .map((p) => {
            const r = p as {
              id: string;
              data_hora: string;
              mandante_id: string;
              visitante_id: string;
            };
            return {
              partidaId: r.id,
              dataHora: r.data_hora,
              mandante: selMap[r.mandante_id],
              visitante: selMap[r.visitante_id],
            };
          });
        setPendentes(pend);

        // Palpites do usuário com gols, para mostrar junto dos próximos enviados
        const { data: meusComGols } = await supabase
          .from("palpites")
          .select("partida_id,gols_mandante,gols_visitante")
          .eq("usuario_id", uid);
        const golsMap = new Map(
          (meusComGols ?? []).map((p) => {
            const r = p as { partida_id: string; gols_mandante: number; gols_visitante: number };
            return [r.partida_id, r];
          }),
        );

        const env: JogoEnviado[] = futuros
          .filter((p) => palpitados.has((p as { id: string }).id))
          .slice(0, 5)
          .map((p) => {
            const r = p as {
              id: string;
              data_hora: string;
              mandante_id: string;
              visitante_id: string;
            };
            const g = golsMap.get(r.id);
            return {
              partidaId: r.id,
              dataHora: r.data_hora,
              mandante: selMap[r.mandante_id],
              visitante: selMap[r.visitante_id],
              golsMandante: g?.gols_mandante ?? 0,
              golsVisitante: g?.gols_visitante ?? 0,
            };
          });
        setEnviados(env);

        // --- Palpites especiais por bolão ---
        if (bolaoIds.length > 0) {
          const { data: pe } = await supabase
            .from("palpites_extras")
            .select("bolao_id,artilheiro_id,campeao_id")
            .eq("usuario_id", uid)
            .in("bolao_id", bolaoIds);

          const artIds = (pe ?? [])
            .map((r: { artilheiro_id: string | null }) => r.artilheiro_id)
            .filter((x): x is string => !!x);
          const jogNomes: Record<string, string> = {};
          if (artIds.length > 0) {
            const { data: jogs } = await supabase
              .from("jogadores")
              .select("id,nome")
              .in("id", artIds);
            (jogs ?? []).forEach((j: { id: string; nome: string }) => {
              jogNomes[j.id] = j.nome;
            });
          }

          const peMap: Record<string, { artilheiro_id: string | null; campeao_id: string | null }> =
            {};
          (pe ?? []).forEach((r) => {
            const row = r as {
              bolao_id: string;
              artilheiro_id: string | null;
              campeao_id: string | null;
            };
            peMap[row.bolao_id] = row;
          });

          const extrasTmp: ExtrasResumo[] = bolaoIds.map((bid) => {
            const row = peMap[bid];
            const art = row?.artilheiro_id ? (jogNomes[row.artilheiro_id] ?? null) : null;
            const camp = row?.campeao_id ? (selMap[row.campeao_id] ?? null) : null;
            return {
              bolaoId: bid,
              nome: bolaoNomes[bid] ?? "Bolão",
              artilheiro: art,
              campeao: camp,
              completo: !!art && !!camp,
            };
          });
          setExtras(extrasTmp);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nomeExibicao =
    nome.toLowerCase() === "artur"
      ? "Mr. Silver"
      : nome.toLowerCase() === "tradefox"
        ? "OG Anunoby"
        : nome;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">Olá{nomeExibicao ? `, ${nomeExibicao}` : ""} 👋</h1>
        <p className="mt-1 text-muted-foreground">
          O bolão oficial do Luka Doncic Fan Club. Hora de cravar os placares.
        </p>
      </section>

      {/* Posição no ranking + palpites especiais */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingCard loading={loading} rankings={rankings} />
        <ExtrasCard
          loading={loading}
          extras={extras}
          abertos={extrasAbertos}
          prazo={PRAZO_EXTRAS}
        />
      </div>

      {/* Histórico do usuário: últimos 5 jogos + geral */}
      <section className="grid gap-4 lg:grid-cols-2">
        <HistoricoCard
          loading={loading}
          title="Últimos 5 jogos"
          subtitle="Seu desempenho nos 5 jogos finalizados mais recentes"
          resumo={resumoUltimos5}
          mostrarSemPalpite
        />
        <HistoricoCard
          loading={loading}
          title="Histórico geral"
          subtitle="Seu desempenho em todos os jogos finalizados"
          resumo={resumoGeral}
          mostrarSemPalpite
        />
      </section>

      {/* Evolução no ranking */}
      <EvolucaoCard loading={loading} evolucao={evolucao} bolaoNomes={bolaoNomesMap} />

      {/* Próximos jogos: pendentes + enviados */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PendentesCard loading={loading} pendentes={pendentes} />
        <EnviadosCard loading={loading} enviados={enviados} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agregação de histórico
// ---------------------------------------------------------------------------
function emptyResumo(): Resumo {
  return { certos: 0, errados: 0, exatos: 0, pontos: 0, semPalpite: 0 };
}

// Histórico do usuário: para cada partida, no máximo um palpite (ou nenhum).
function agregar(itens: { partida: PartidaResultado; palpite: PalpiteRow | null }[]): Resumo {
  const r = emptyResumo();
  for (const { partida, palpite } of itens) {
    if (!palpite) {
      r.semPalpite += 1;
      continue;
    }
    classificar(partida, palpite, r);
    r.pontos += palpite.pontos_ganhos ?? pontosDoPalpite(partida, palpite);
  }
  return r;
}

function classificar(partida: PartidaResultado, palpite: PalpiteRow, r: Resumo) {
  const exato =
    palpite.gols_mandante === partida.gols_mandante &&
    palpite.gols_visitante === partida.gols_visitante;
  const acertouResultado =
    resultado(palpite.gols_mandante, palpite.gols_visitante) ===
    resultado(partida.gols_mandante, partida.gols_visitante);
  if (exato) {
    r.exatos += 1;
    r.certos += 1;
  } else if (acertouResultado) {
    r.certos += 1;
  } else {
    r.errados += 1;
  }
}

// Fallback caso pontos_ganhos ainda não tenha sido calculado no banco.
function pontosDoPalpite(partida: PartidaResultado, palpite: PalpiteRow): number {
  if (
    palpite.gols_mandante === partida.gols_mandante &&
    palpite.gols_visitante === partida.gols_visitante
  )
    return 7;
  if (
    resultado(palpite.gols_mandante, palpite.gols_visitante) ===
    resultado(partida.gols_mandante, partida.gols_visitante)
  )
    return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// Reconstrução da evolução no ranking
// ---------------------------------------------------------------------------
// Para cada dia com partida finalizada, soma os pontos de cada membro acumulados
// até o fim daquele dia e calcula a posição do usuário no ranking.
async function construirEvolucao(
  bolaoId: string,
  uid: string,
  memberIds: string[],
  finalizadas: PartidaResultado[],
): Promise<PontoEvolucao[]> {
  // Apenas partidas finalizadas com data conhecida.
  const comData = finalizadas.filter((p) => p.data_hora != null);
  if (comData.length === 0) return [];

  const ids = comData.map((p) => p.id);
  const { data: pls } = await supabase
    .from("palpites")
    .select("usuario_id,partida_id,pontos_ganhos,gols_mandante,gols_visitante")
    .in("partida_id", ids)
    .in("usuario_id", memberIds);
  const palpites = (pls ?? []) as PalpiteRow[];

  const partMap = new Map(comData.map((p) => [p.id, p]));

  // Mapa: dia (YYYY-MM-DD) -> data_hora máxima daquele dia (para ordenação).
  const diasSet = new Set<string>();
  for (const p of comData) diasSet.add(diaLocal(p.data_hora!));
  const dias = [...diasSet].sort();

  // pontos acumulados por usuário, atualizados dia a dia.
  const acumulado: Record<string, number> = {};
  for (const m of memberIds) acumulado[m] = 0;

  // pré-agrupa pontos por dia/usuário
  const ganhosPorDia: Record<string, Record<string, number>> = {};
  for (const pal of palpites) {
    const part = partMap.get(pal.partida_id);
    if (!part?.data_hora) continue;
    const dia = diaLocal(part.data_hora);
    const pts = pal.pontos_ganhos ?? pontosDoPalpite(part, pal);
    ganhosPorDia[dia] ??= {};
    ganhosPorDia[dia][pal.usuario_id] = (ganhosPorDia[dia][pal.usuario_id] ?? 0) + pts;
  }

  const serie: PontoEvolucao[] = [];
  for (const dia of dias) {
    const ganhos = ganhosPorDia[dia] ?? {};
    for (const m of memberIds) {
      acumulado[m] += ganhos[m] ?? 0;
    }
    // posição e pontos do usuário ao final do dia
    const ordenado = [...memberIds].sort((a, b) => acumulado[b] - acumulado[a]);
    const pos = ordenado.indexOf(uid) + 1;
    serie.push({
      dia,
      rotulo: rotuloDiaCurto(dia),
      posicao: pos,
      pontos: acumulado[uid] ?? 0,
      total: memberIds.length,
    });
  }
  return serie;
}

function diaLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function rotuloDiaCurto(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Card: histórico (últimos 5 jogos)
// ---------------------------------------------------------------------------
function HistoricoCard({
  loading,
  title,
  subtitle,
  resumo,
  mostrarSemPalpite,
}: {
  loading: boolean;
  title: string;
  subtitle: string;
  resumo: Resumo | null;
  mostrarSemPalpite?: boolean;
}) {
  return (
    <Card>
      <CardHeader icon={History} title={title} />
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">{subtitle}</p>
      {loading || !resumo ? (
        <CardLoading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric icon={Target} label="Certos" value={resumo.certos} tone="primary" />
            <Metric icon={XCircle} label="Errados" value={resumo.errados} tone="muted" />
            <Metric icon={Crosshair} label="Exatos" value={resumo.exatos} tone="accent" />
            <Metric icon={Trophy} label="Pontos" value={resumo.pontos} tone="accent" />
          </div>
          {mostrarSemPalpite && resumo.semPalpite > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Você não palpitou em <strong>{resumo.semPalpite}</strong>{" "}
                {resumo.semPalpite === 1 ? "jogo finalizado" : "jogos finalizados"} recentes.
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: "primary" | "accent" | "muted";
}) {
  const cor =
    tone === "accent"
      ? "text-accent"
      : tone === "primary"
        ? "text-primary"
        : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-center">
      <Icon className={`mx-auto h-4 w-4 ${cor}`} />
      <div className={`mt-1 text-2xl font-bold ${tone === "accent" ? "text-accent" : ""}`}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card: evolução no ranking (gráfico de linha com dropdown de bolão)
// ---------------------------------------------------------------------------
function EvolucaoCard({
  loading,
  evolucao,
  bolaoNomes,
}: {
  loading: boolean;
  evolucao: Record<string, PontoEvolucao[]>;
  bolaoNomes: Record<string, string>;
}) {
  const ids = useMemo(() => Object.keys(evolucao), [evolucao]);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  useEffect(() => {
    if (selecionado === null && ids.length > 0) setSelecionado(ids[0]);
    if (selecionado !== null && ids.length > 0 && !ids.includes(selecionado)) {
      setSelecionado(ids[0]);
    }
  }, [ids, selecionado]);

  const serie = selecionado ? (evolucao[selecionado] ?? []) : [];
  const total = serie[0]?.total ?? 0;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LineChartIcon className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Evolução no ranking</h2>
        </div>
        {ids.length > 0 && (
          <select
            value={selecionado ?? ""}
            onChange={(e) => setSelecionado(e.target.value)}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium outline-none transition-colors hover:border-primary/50 focus:border-primary"
          >
            {ids.map((id) => (
              <option key={id} value={id}>
                {bolaoNomes[id] ?? "Bolão"}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <CardLoading />
      ) : ids.length === 0 || serie.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          A evolução aparece aqui assim que os primeiros resultados forem lançados.
        </p>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--primary)" }} />
              <span className="text-muted-foreground">Posição</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent)" }} />
              <span className="text-muted-foreground">Pontos</span>
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 8, right: 4, bottom: 4, left: -16 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-border"
                />
                <XAxis
                  dataKey="rotulo"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-muted-foreground"
                  tickLine={false}
                />
                <YAxis
                  yAxisId="posicao"
                  reversed
                  allowDecimals={false}
                  domain={[1, total]}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-muted-foreground"
                  tickLine={false}
                  width={40}
                  tickFormatter={(v: number) => `${v}º`}
                />
                <YAxis
                  yAxisId="pontos"
                  orientation="right"
                  allowDecimals={false}
                  domain={[0, "auto"]}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-muted-foreground"
                  tickLine={false}
                  width={32}
                />
                <Tooltip content={<EvolucaoTooltip total={total} />} />
                <Line
                  yAxisId="posicao"
                  type="monotone"
                  dataKey="posicao"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "var(--primary)" }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="pontos"
                  type="monotone"
                  dataKey="pontos"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "var(--accent)" }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

function EvolucaoTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: { payload: PontoEvolucao }[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="space-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{p.rotulo}</div>
      <div className="text-muted-foreground">
        Posição: <span className="font-bold text-primary">{p.posicao}º</span> de {total}
      </div>
      <div className="text-muted-foreground">
        Pontos: <span className="font-bold text-accent">{p.pontos}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card: posição no ranking de cada bolão
// ---------------------------------------------------------------------------
function RankingCard({ loading, rankings }: { loading: boolean; rankings: RankingBolao[] }) {
  return (
    <Card>
      <CardHeader icon={Trophy} title="Sua posição" />
      {loading ? (
        <CardLoading />
      ) : rankings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Você ainda não participa de nenhum bolão.{" "}
          <Link to="/boloes" className="text-primary hover:underline">
            Entrar em um →
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {rankings.map((r) => (
            <li key={r.bolaoId}>
              <Link
                to="/ranking"
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 transition-colors hover:border-primary/50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.nome}</div>
                  <div className="text-xs text-muted-foreground">{r.pontos} pts</div>
                </div>
                <div className="flex shrink-0 items-baseline gap-1">
                  <span
                    className={`text-lg font-bold ${
                      r.posicao === 1 ? "text-accent" : "text-primary"
                    }`}
                  >
                    {r.posicao}º
                  </span>
                  <span className="text-xs text-muted-foreground">/ {r.total}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card: palpites pendentes próximos de vencer
// ---------------------------------------------------------------------------
function PendentesCard({ loading, pendentes }: { loading: boolean; pendentes: JogoPendente[] }) {
  return (
    <Card>
      <CardHeader icon={Clock} title="Pendentes próximos" />
      {loading ? (
        <CardLoading />
      ) : pendentes.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-accent" />
          Tudo em dia! Nenhum palpite pendente.
        </p>
      ) : (
        <ul className="space-y-2">
          {pendentes.map((j) => (
            <li key={j.partidaId}>
              <Link
                to="/palpites/grupos"
                className="block rounded-lg border border-border bg-background/40 px-3 py-2 transition-colors hover:border-primary/50"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Flag codigo={j.mandante?.codigo} bandeira={j.mandante?.bandeira} size={14} />
                    <span className="truncate">{j.mandante?.codigo ?? "—"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">×</span>
                  <span className="flex min-w-0 items-center justify-end gap-1.5">
                    <span className="truncate">{j.visitante?.codigo ?? "—"}</span>
                    <Flag codigo={j.visitante?.codigo} bandeira={j.visitante?.bandeira} size={14} />
                  </span>
                </div>
                <div className="mt-1">
                  <Countdown alvo={j.dataHora} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card: próximos jogos com palpite já enviado (mostra o palpite)
// ---------------------------------------------------------------------------
function EnviadosCard({ loading, enviados }: { loading: boolean; enviados: JogoEnviado[] }) {
  return (
    <Card>
      <CardHeader icon={Send} title="Próximos já palpitados" />
      {loading ? (
        <CardLoading />
      ) : enviados.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum palpite enviado para os próximos jogos ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {enviados.map((j) => (
            <li key={j.partidaId}>
              <Link
                to="/palpites/grupos"
                className="block rounded-lg border border-border bg-background/40 px-3 py-2.5 transition-colors hover:border-primary/50"
              >
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  {/* mandante */}
                  <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <span className="truncate text-sm font-medium">
                      {j.mandante?.codigo ?? "—"}
                    </span>
                    <Flag codigo={j.mandante?.codigo} bandeira={j.mandante?.bandeira} size={20} />
                  </div>
                  {/* placar palpitado */}
                  <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 tabular-nums">
                    <span className="text-lg font-bold text-primary">{j.golsMandante}</span>
                    <span className="text-xs text-muted-foreground">×</span>
                    <span className="text-lg font-bold text-primary">{j.golsVisitante}</span>
                  </div>
                  {/* visitante */}
                  <div className="flex min-w-0 items-center gap-2">
                    <Flag codigo={j.visitante?.codigo} bandeira={j.visitante?.bandeira} size={20} />
                    <span className="truncate text-sm font-medium">
                      {j.visitante?.codigo ?? "—"}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">
                    Seu palpite
                  </span>
                  <Countdown alvo={j.dataHora} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card: palpites especiais (resumo ou aviso de deadline)
// ---------------------------------------------------------------------------
function ExtrasCard({
  loading,
  extras,
  abertos,
  prazo,
}: {
  loading: boolean;
  extras: ExtrasResumo[];
  abertos: boolean;
  prazo: Date;
}) {
  const algumIncompleto = extras.some((e) => !e.completo);
  const prazoStr = prazo.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <Card>
      <CardHeader icon={Star} title="Palpites especiais" />
      {loading ? (
        <CardLoading />
      ) : extras.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Entre em um bolão para cravar artilheiro e campeã.
        </p>
      ) : (
        <div className="space-y-3">
          {abertos && algumIncompleto && (
            <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Prazo até <strong>{prazoStr}</strong>. Faltam palpites especiais!
              </span>
            </div>
          )}
          <ul className="space-y-2">
            {extras.map((e) => (
              <li key={e.bolaoId}>
                <Link
                  to="/palpites/grupos"
                  className="block rounded-lg border border-border bg-background/40 px-3 py-2 transition-colors hover:border-primary/50"
                >
                  <div className="truncate text-sm font-medium">{e.nome}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">Artilheiro:</span>
                      {e.artilheiro ?? <span className="text-accent">—</span>}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">Campeã:</span>
                      {e.campeao ? (
                        <span className="inline-flex items-center gap-1">
                          <Flag codigo={e.campeao.codigo} bandeira={e.campeao.bandeira} size={12} />
                          {e.campeao.codigo}
                        </span>
                      ) : (
                        <span className="text-accent">—</span>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {!abertos && <p className="text-xs text-muted-foreground">Prazo encerrado.</p>}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------
function Countdown({ alvo }: { alvo: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const diff = new Date(alvo).getTime() - now;
  const horas = Math.floor(diff / 3_600_000);
  const dias = Math.floor(horas / 24);
  const urgente = diff < 3_600_000 * 6; // menos de 6h

  let texto: string;
  if (diff <= 0) texto = "fechando...";
  else if (dias >= 1) texto = `fecha em ${dias}d ${horas % 24}h`;
  else if (horas >= 1) texto = `fecha em ${horas}h`;
  else texto = `fecha em ${Math.max(1, Math.floor(diff / 60_000))}min`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        urgente ? "text-accent" : "text-muted-foreground"
      }`}
    >
      <Clock className="h-3 w-3" />
      {texto}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-card p-5">{children}</section>;
}

function CardHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-5 w-5 text-primary" />
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}

function CardLoading() {
  return (
    <div className="grid place-items-center py-6 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
