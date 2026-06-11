import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { FASE_LABEL } from "@/lib/fases";

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

// Mesma regra do servidor: a partida ainda aceita palpite?
// Enquanto aceitar, NÃO mostramos palpites de terceiros (a RLS também bloqueia).
function aindaAberta(p: Partida): boolean {
  if (p.status !== "aguardando") return false;
  if (p.data_hora && new Date(p.data_hora) <= new Date()) return false;
  return true;
}

function CompararPalpites() {
  const { id } = Route.useParams();
  const [partida, setPartida] = useState<Partida | null>(null);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [palpites, setPalpites] = useState<PalpiteOutro[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [meuId, setMeuId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
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

        // Só busca palpites se a partida já fechou. A RLS já garante isso,
        // mas evitamos a query (e a tela "vazia") quando ainda está aberta.
        if (part && !aindaAberta(part as Partida)) {
          const { data: pls, error: ePls } = await supabase
            .from("palpites")
            .select("usuario_id,gols_mandante,gols_visitante,pontos_ganhos")
            .eq("partida_id", id);
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

  if (loading) {
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
        <div className="text-xs text-muted-foreground">
          {FASE_LABEL[partida.fase] ?? partida.fase}
          {partida.grupo ? ` · Grupo ${partida.grupo}` : ""} · {dataLabel}
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center justify-end gap-2 text-right">
            <span className="font-semibold truncate">{mandante?.nome ?? "—"}</span>
            <span className="text-2xl">{mandante?.bandeira ?? "🏳️"}</span>
          </div>
          <div className="text-center text-2xl font-bold">
            {partida.gols_mandante != null && partida.gols_visitante != null
              ? `${partida.gols_mandante} × ${partida.gols_visitante}`
              : "× "}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{visitante?.bandeira ?? "🏳️"}</span>
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
          Ninguém do seu bolão palpitou nesta partida.
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
      to="/palpites/grupos"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar aos palpites
    </Link>
  );
}
