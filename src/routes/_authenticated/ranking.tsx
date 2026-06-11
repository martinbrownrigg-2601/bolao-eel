import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Trophy, Radio } from "lucide-react";
import { useBolao } from "@/contexts/BolaoContext";

export const Route = createFileRoute("/_authenticated/ranking")({
  head: () => ({
    meta: [{ title: "Ranking | BolãoEEL" }],
  }),
  component: RankingPage,
});

type Linha = {
  uid: string;
  nome: string;
  pontos: number;
  jogos: number;
  palpites: number;
};

function RankingPage() {
  const { bolaoAtivo, loading: loadingBolao } = useBolao();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aoVivo, setAoVivo] = useState(false);
  const [piscando, setPiscando] = useState(false);

  async function carregar(bolaoId: string | null) {
    try {
      const { data: u } = await supabase.auth.getUser();
      setMeuId(u.user?.id ?? null);

      let ids: string[] | null = null;
      if (bolaoId) {
        const { data: ms } = await supabase
          .from("membros_bolao")
          .select("usuario_id")
          .eq("bolao_id", bolaoId);
        ids = (ms ?? []).map((m: { usuario_id: string }) => m.usuario_id);
      }

      let query = supabase
        .from("v_pontuacao_usuario")
        .select("usuario_id,pontos_total,jogos_pontuados,palpites_total");

      if (ids && ids.length > 0) {
        query = query.in("usuario_id", ids);
      }

      const { data: pts, error } = await query;
      if (error) throw error;

      const ptIds = (pts ?? []).map((p) => (p as { usuario_id: string }).usuario_id);
      let perfisMap: Record<string, { nome_usuario: string; nome_exibicao: string | null }> = {};
      if (ptIds.length > 0) {
        const { data: ps } = await supabase
          .from("perfis")
          .select("id,nome_usuario,nome_exibicao")
          .in("id", ptIds);
        (ps ?? []).forEach((p) => {
          const row = p as { id: string; nome_usuario: string; nome_exibicao: string | null };
          perfisMap[row.id] = { nome_usuario: row.nome_usuario, nome_exibicao: row.nome_exibicao };
        });
      }

      const rows: Linha[] = (pts ?? [])
        .map((p) => {
          const r = p as {
            usuario_id: string;
            pontos_total: number;
            jogos_pontuados: number;
            palpites_total: number;
          };
          return {
            uid: r.usuario_id,
            nome:
              perfisMap[r.usuario_id]?.nome_exibicao ||
              perfisMap[r.usuario_id]?.nome_usuario ||
              "Jogador",
            pontos: r.pontos_total,
            jogos: r.jogos_pontuados,
            palpites: r.palpites_total,
          };
        })
        .sort((a, b) => b.pontos - a.pontos || b.jogos - a.jogos);

      setLinhas(rows);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar ranking");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loadingBolao) return;
    setLoading(true);
    void carregar(bolaoAtivo?.id ?? null);
  }, [bolaoAtivo?.id, loadingBolao]);

  useEffect(() => {
    if (loadingBolao) return;

    const ch = supabase
      .channel("ranking-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "palpites" },
        () => {
          setPiscando(true);
          setTimeout(() => setPiscando(false), 800);
          void carregar(bolaoAtivo?.id ?? null);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "partidas" },
        () => void carregar(bolaoAtivo?.id ?? null),
      )
      .subscribe((status) => {
        setAoVivo(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [bolaoAtivo?.id, loadingBolao]);

  if (loading || loadingBolao) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Ranking</h1>
          <p className="mt-1 text-muted-foreground">
            {bolaoAtivo
              ? `Pontuação dos membros de "${bolaoAtivo.nome}".`
              : "Você ainda não participa de nenhum bolão."}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            aoVivo
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border bg-secondary/60 text-muted-foreground"
          } ${piscando ? "animate-pulse" : ""}`}
        >
          <Radio className={`h-3.5 w-3.5 ${aoVivo ? "" : "opacity-60"}`} />
          {aoVivo ? "Ao vivo" : "Conectando..."}
        </div>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro}
        </div>
      )}

      {!bolaoAtivo ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Entre em um bolão para ver o ranking dos seus amigos.
        </div>
      ) : linhas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Ainda ninguém pontuou. Assim que o admin lançar os primeiros resultados, o ranking aparece aqui.
        </div>
      ) : (
        <ul className="grid gap-2">
          {linhas.map((r, i) => {
            const sou = r.uid === meuId;
            return (
              <li
                key={r.uid}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                  sou ? "border-primary/50 bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-md text-sm font-bold ${
                      i === 0
                        ? "bg-accent text-accent-foreground"
                        : i < 3
                          ? "bg-primary/20 text-primary"
                          : "bg-secondary text-foreground"
                    }`}
                  >
                    {i === 0 ? <Trophy className="h-4 w-4" /> : i + 1}
                  </span>
                  <div>
                    <div className="font-medium">
                      {r.nome}
                      {sou && (
                        <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                          você
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.jogos} pontuado(s) · {r.palpites} palpite(s)
                    </div>
                  </div>
                </div>
                <div className="text-lg font-bold text-primary">
                  {r.pontos}{" "}
                  <span className="text-xs font-normal text-muted-foreground">pts</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
