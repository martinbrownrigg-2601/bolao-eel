import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Trophy,
  ListChecks,
  Clock,
  AlertTriangle,
  Star,
  Loader2,
  CheckCircle2,
} from "lucide-react";
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

type ExtrasResumo = {
  bolaoId: string;
  nome: string;
  artilheiro: string | null;
  campeao: Selecao | null;
  completo: boolean;
};

function Dashboard() {
  const [nome, setNome] = useState<string>("");
  const [stats, setStats] = useState({ palpites: 0, pontos: 0 });
  const [rankings, setRankings] = useState<RankingBolao[]>([]);
  const [pendentes, setPendentes] = useState<JogoPendente[]>([]);
  const [extras, setExtras] = useState<ExtrasResumo[]>([]);
  const [extrasAbertos, setExtrasAbertos] = useState(true);
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

        // --- Palpites do usuário (stats + quais partidas já tem palpite) ---
        const { data: palpites } = await supabase
          .from("palpites")
          .select("partida_id,pontos_ganhos")
          .eq("usuario_id", uid);
        const totalPalpites = palpites?.length ?? 0;
        const pts = (palpites ?? []).reduce(
          (s: number, p: { pontos_ganhos: number | null }) => s + (p.pontos_ganhos ?? 0),
          0,
        );
        setStats({ palpites: totalPalpites, pontos: pts });
        const palpitados = new Set(
          (palpites ?? []).map((p: { partida_id: string }) => p.partida_id),
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

        // --- Posição no ranking de cada bolão ---
        // Para cada bolão: pega membros, lê v_pontuacao_usuario, ordena e acha a posição.
        const rankingsTmp: RankingBolao[] = [];
        for (const bid of bolaoIds) {
          const { data: membros } = await supabase
            .from("membros_bolao")
            .select("usuario_id")
            .eq("bolao_id", bid);
          const memberIds = (membros ?? []).map((m: { usuario_id: string }) => m.usuario_id);
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

        // --- Seleções (para flags em jogos pendentes e extras) ---
        const { data: sels } = await supabase.from("selecoes").select("id,nome,codigo,bandeira");
        const selMap: Record<string, Selecao> = {};
        (sels ?? []).forEach((s) => (selMap[s.id] = s as Selecao));

        // --- Jogos pendentes próximos de vencer ---
        // Partidas aguardando, com data futura, sem palpite do usuário, ordenadas por proximidade.
        const agora = new Date();
        const { data: parts } = await supabase
          .from("partidas")
          .select("id,status,data_hora,mandante_id,visitante_id")
          .eq("status", "aguardando")
          .not("data_hora", "is", null)
          .order("data_hora", { ascending: true });

        const pend: JogoPendente[] = (parts ?? [])
          .filter((p) => {
            const r = p as { id: string; data_hora: string };
            if (palpitados.has(r.id)) return false;
            return new Date(r.data_hora) > agora;
          })
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

        // --- Palpites especiais por bolão ---
        if (bolaoIds.length > 0) {
          const { data: pe } = await supabase
            .from("palpites_extras")
            .select("bolao_id,artilheiro_id,campeao_id")
            .eq("usuario_id", uid)
            .in("bolao_id", bolaoIds);

          // jogadores para resolver nome do artilheiro
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
    nome.toLowerCase() === "artur" ? "Mr. Silver" :
    nome.toLowerCase() === "tradefox" ? "OG Anunoby" :
    nome;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">Olá{nomeExibicao ? `, ${nomeExibicao}` : ""} 👋</h1>
        <p className="mt-1 text-muted-foreground">
          O bolão oficial do Luka Doncic Fan Club. Hora de cravar os placares.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Stat label="Palpites enviados" value={stats.palpites} icon={ListChecks} />
        <Stat label="Pontos acumulados" value={stats.pontos} icon={Trophy} accent />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <RankingCard loading={loading} rankings={rankings} />
        <PendentesCard loading={loading} pendentes={pendentes} />
        <ExtrasCard
          loading={loading}
          extras={extras}
          abertos={extrasAbertos}
          prazo={PRAZO_EXTRAS}
        />
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

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`h-5 w-5 ${accent ? "text-accent" : "text-primary"}`} />
      </div>
      <div className={`mt-2 text-3xl font-bold ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}
