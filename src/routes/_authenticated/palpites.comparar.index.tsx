import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ChevronRight, Loader2 } from "lucide-react";
import { FASE_LABEL_CURTO } from "@/lib/fases";

export const Route = createFileRoute("/_authenticated/palpites/comparar/")({
  head: () => ({
    meta: [
      { title: "Comparar palpites | BolãoEEL" },
      { name: "description", content: "Veja os palpites do bolão nos jogos já iniciados." },
    ],
  }),
  component: CompararIndex,
});

type Selecao = { id: string; nome: string; bandeira: string | null };
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

// Mesma regra do servidor: partida fechou para palpites = já dá pra comparar.
function jaIniciada(p: Partida): boolean {
  if (p.status !== "aguardando") return true;
  if (p.data_hora && new Date(p.data_hora) <= new Date()) return true;
  return false;
}

function CompararIndex() {
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: sels }, { data: parts, error }] = await Promise.all([
          supabase.from("selecoes").select("id,nome,bandeira"),
          supabase.from("partidas").select("*").order("data_hora", { ascending: false }),
        ]);
        if (error) throw error;
        const selMap: Record<string, Selecao> = {};
        (sels ?? []).forEach((s) => (selMap[s.id] = s as Selecao));
        setSelecoes(selMap);
        setPartidas((parts ?? []) as Partida[]);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar partidas");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Mais recentes primeiro (a query já vem desc por data_hora).
  const iniciadas = useMemo(() => partidas.filter(jaIniciada), [partidas]);

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Comparar palpites</h1>
        <p className="mt-1 text-muted-foreground">
          Depois que um jogo começa, veja o que cada membro do seu bolão palpitou.
        </p>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro}
        </div>
      )}

      {iniciadas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Nenhum jogo começou ainda. Assim que a bola rolar, as partidas aparecem aqui para você
          comparar os palpites.
        </div>
      ) : (
        <ul className="grid gap-2">
          {iniciadas.map((p) => {
            const m = selecoes[p.mandante_id];
            const v = selecoes[p.visitante_id];
            const placar =
              p.gols_mandante != null && p.gols_visitante != null
                ? `${p.gols_mandante} × ${p.gols_visitante}`
                : "em jogo";
            const data = p.data_hora
              ? new Date(p.data_hora).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Data a definir";
            return (
              <li key={p.id}>
                <Link
                  to="/palpites/comparar/$id"
                  params={{ id: p.id }}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">
                      {FASE_LABEL_CURTO[p.fase] ?? p.fase}
                      {p.grupo ? ` · Grupo ${p.grupo}` : ""} · {data}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-medium">
                      <span className="text-lg">{m?.bandeira ?? "🏳️"}</span>
                      <span className="truncate">{m?.nome ?? "—"}</span>
                      <span className="text-muted-foreground">{placar}</span>
                      <span className="truncate">{v?.nome ?? "—"}</span>
                      <span className="text-lg">{v?.bandeira ?? "🏳️"}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
