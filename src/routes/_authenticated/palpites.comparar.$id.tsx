import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { FASE_LABEL } from "@/lib/fases";
import { Flag } from "@/components/Flag";
import { useBolao } from "@/contexts/BolaoContext";

export const Route = createFileRoute("/_authenticated/palpites/comparar/$id")({
  head: () => ({
    meta: [{ title: "Palpites do bolão | BolãoEEL" }],
  }),
  component: CompararPalpites,
});

type Selecao = { id: string; nome: string; codigo: string; bandeira: string | null };
type Partida = {
  id: string;
  fase: string;
  grupo: string | null;
  data_hora: string | null;
  status: string;
  mandante_id: string;
  visitante_id: string;
  gols_mandante: number | null;
  gols_visitante: number | null;
};
type PalpiteOutro = {
  usuario_id: string;
  gols_mandante: number;
  gols_visitante: number;
  pontos_ganhos: number | null;
};
// Placar AO VIVO (referência visual; não afeta pontuação).
type PlacarLive = {
  gols_mandante_live: number | null;
  gols_visitante_live: number | null;
  minuto: string | null;
  ao_vivo: boolean;
};

function aindaAberta(p: Partida): boolean {
  if (p.status !== "aguardando") return false;
  if (p.data_hora && new Date(p.data_hora) <= new Date()) return false;
  return true;
}

function CompararPalpites() {
  const { id } = Route.useParams();
  const { bolaoAtivo, loading: loadingBolao } = useBolao();
  const [partida, setPartida] = useState<Partida | null>(null);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [palpites, setPalpites] = useState<PalpiteOutro[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [meuId, setMeuId] = useState<string | null>(null);
  const [live, setLive] = useState<PlacarLive | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (loadingBolao) return;
    (async () => {
      try {
        const [{ data: u }, { data: part, error: ePart }, { data: sels }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("partidas").select("*").eq("id", id).single(),
          supabase.from("selecoes").select("id,nome,codigo,bandeira"),
        ]);
        if (ePart) throw ePart;
        setMeuId(u.user?.id ?? null);

        const selMap: Record<string, Selecao> = {};
        (sels ?? []).forEach((s) => (selMap[s.id] = s as Selecao));
        setSelecoes(selMap);
        setPartida(part as Partida);

        if (part && !aindaAberta(part as Partida)) {
          let query = supabase
            .from("palpites")
            .select("usuario_id,gols_mandante,gols_visitante,pontos_ganhos")
            .eq("partida_id", id);

          // Filtrar pelos membros do bolão ativo
          if (bolaoAtivo) {
            const { data: ms } = await supabase
              .from("membros_bolao")
              .select("usuario_id")
              .eq("bolao_id", bolaoAtivo.id);
            const memberIds = (ms ?? []).map((m: { usuario_id: string }) => m.usuario_id);
            if (memberIds.length > 0) {
              query = query.in("usuario_id", memberIds);
            }
          }

          const { data: pls, error: ePls } = await query;
          if (ePls) throw ePls;
          const lista = (pls ?? []) as PalpiteOutro[];
          setPalpites(lista);

          const ids = lista.map((p) => p.usuario_id);
          if (ids.length > 0) {
            const { data: ps } = await supabase
              .from("perfis")
              .select("id,nome_usuario,nome_exibicao")
              .in("id", ids);
            const nm: Record<string, string> = {};
            (ps ?? []).forEach((p) => {
              const r = p as { id: string; nome_usuario: string; nome_exibicao: string | null };
              nm[r.id] = r.nome_exibicao || r.nome_usuario || "Jogador";
            });
            setNomes(nm);
          }
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar palpites");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, bolaoAtivo?.id, loadingBolao]);

  // Placar ao vivo desta partida: busca + polling de 45s enquanto estiver ao vivo.
  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function buscar() {
      const { data } = await supabase
        .from("placares_ao_vivo")
        .select("gols_mandante_live,gols_visitante_live,minuto,ao_vivo")
        .eq("partida_id", id)
        .maybeSingle();
      if (cancelado) return;
      const l = (data as PlacarLive | null) ?? null;
      setLive(l);
      timer = setTimeout(buscar, l?.ao_vivo ? 45_000 : 5 * 60_000);
    }
    void buscar();

    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const ordenados = useMemo(
    () =>
      [...palpites].sort(
        (a, b) =>
          (b.pontos_ganhos ?? -1) - (a.pontos_ganhos ?? -1) ||
          (a.usuario_id === meuId ? -1 : 0) - (b.usuario_id === meuId ? -1 : 0),
      ),
    [palpites, meuId],
  );

  if (loading || loadingBolao) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (erro || !partida) {
    return (
      <div className="space-y-4">
        <VoltarLink />
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro ?? "Partida não encontrada."}
        </div>
      </div>
    );
  }

  const mandante = selecoes[partida.mandante_id];
  const visitante = selecoes[partida.visitante_id];
  const aberta = aindaAberta(partida);
  // Placar oficial (final) tem prioridade; sem ele, mostra o ao vivo.
  const temPlacarOficial = partida.gols_mandante != null && partida.gols_visitante != null;
  const mostraLive =
    !temPlacarOficial &&
    live?.ao_vivo &&
    live.gols_mandante_live != null &&
    live.gols_visitante_live != null;
  const dataLabel = partida.data_hora
    ? new Date(partida.data_hora).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Data a definir";

  return (
    <div className="space-y-6">
      <VoltarLink />

      <header className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {FASE_LABEL[partida.fase] ?? partida.fase}
            {partida.grupo ? ` · Grupo ${partida.grupo}` : ""} · {dataLabel}
          </span>
          {bolaoAtivo && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {bolaoAtivo.nome}
            </span>
          )}
          {mostraLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              AO VIVO{live!.minuto ? ` · ${live!.minuto}` : ""}
            </span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center justify-end gap-2 text-right">
            <span className="font-semibold truncate">{mandante?.nome ?? "—"}</span>
            <Flag codigo={mandante?.codigo} bandeira={mandante?.bandeira} size={26} />
          </div>
          <div className={`text-center text-2xl font-bold ${mostraLive ? "text-red-500" : ""}`}>
            {temPlacarOficial
              ? `${partida.gols_mandante} × ${partida.gols_visitante}`
              : mostraLive
                ? `${live!.gols_mandante_live} × ${live!.gols_visitante_live}`
                : "× "}
          </div>
          <div className="flex items-center gap-2">
            <Flag codigo={visitante?.codigo} bandeira={visitante?.bandeira} size={26} />
            <span className="font-semibold truncate">{visitante?.nome ?? "—"}</span>
          </div>
        </div>
      </header>

      {aberta ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Lock className="h-6 w-6" />
          <p className="font-medium text-foreground">Palpites ainda fechados ao público</p>
          <p className="text-sm">
            Os palpites dos outros membros aparecem aqui assim que o jogo começa.
          </p>
        </div>
      ) : ordenados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {bolaoAtivo
            ? `Ninguém de "${bolaoAtivo.nome}" palpitou nesta partida.`
            : "Ninguém do seu bolão palpitou nesta partida."}
        </div>
      ) : (
        <ul className="grid gap-2">
          {ordenados.map((p) => {
            const sou = p.usuario_id === meuId;
            const acertou =
              partida.gols_mandante != null &&
              partida.gols_visitante != null &&
              p.gols_mandante === partida.gols_mandante &&
              p.gols_visitante === partida.gols_visitante;
            return (
              <li
                key={p.usuario_id}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                  sou ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  {nomes[p.usuario_id] ?? "Jogador"}
                  {sou && (
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      você
                    </span>
                  )}
                  {acertou && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                      placar exato
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold tabular-nums">
                    {p.gols_mandante} × {p.gols_visitante}
                  </span>
                  {p.pontos_ganhos != null && (
                    <span className="min-w-12 rounded-full bg-secondary px-2 py-0.5 text-center text-xs font-semibold text-muted-foreground">
                      {p.pontos_ganhos} pts
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VoltarLink() {
  return (
    <Link
      to="/palpites/comparar"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar à comparação
    </Link>
  );
}
