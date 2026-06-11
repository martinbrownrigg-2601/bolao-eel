import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Check, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/palpites/grupos")({
  head: () => ({
    meta: [
      { title: "Palpites — Fase de Grupos | BolãoEEL" },
      { name: "description", content: "Crave os placares da fase de grupos." },
    ],
  }),
  component: PalpitesGrupos,
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
type Palpite = {
  partida_id: string;
  gols_mandante: number;
  gols_visitante: number;
  pontos_ganhos: number | null;
};

function PalpitesGrupos() {
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [palpites, setPalpites] = useState<Record<string, Palpite>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: sels }, { data: parts }, { data: u }] = await Promise.all([
          supabase.from("selecoes").select("id,nome,codigo,bandeira"),
          supabase
            .from("partidas")
            .select("*")
            .eq("fase", "grupos")
            .order("data_hora", { ascending: true }),
          supabase.auth.getUser(),
        ]);

        const selMap: Record<string, Selecao> = {};
        (sels ?? []).forEach((s) => (selMap[s.id] = s as Selecao));
        setSelecoes(selMap);
        setPartidas((parts ?? []) as Partida[]);

        if (u.user) {
          const { data: pls } = await supabase
            .from("palpites")
            .select("partida_id,gols_mandante,gols_visitante,pontos_ganhos")
            .eq("usuario_id", u.user.id);
          const pMap: Record<string, Palpite> = {};
          (pls ?? []).forEach((p) => (pMap[p.partida_id] = p as Palpite));
          setPalpites(pMap);
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grupos = useMemo(() => {
    const map = new Map<string, Partida[]>();
    for (const p of partidas) {
      const g = p.grupo ?? "?";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [partidas]);

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Fase de grupos</h1>
        <p className="mt-1 text-muted-foreground">
          Crave o placar. <span className="text-primary font-medium">5 pts</span> pelo resultado +{" "}
          <span className="text-accent font-medium">2 pts</span> pelo placar exato.
        </p>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro}
        </div>
      )}

      {partidas.length === 0 && !erro && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          Nenhuma partida cadastrada ainda. Rode a migration SQL no seu projeto Supabase.
        </div>
      )}

      <div className="space-y-8">
        {grupos.map(([grupo, lista]) => (
          <section key={grupo}>
            <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-foreground font-bold">
                {grupo}
              </span>
              Grupo {grupo}
            </h2>
            <ul className="grid gap-2">
              {lista.map((p) => (
                <PartidaRow
                  key={p.id}
                  partida={p}
                  mandante={selecoes[p.mandante_id]}
                  visitante={selecoes[p.visitante_id]}
                  palpite={palpites[p.id]}
                  onSaved={(np) =>
                    setPalpites((prev) => ({ ...prev, [p.id]: np }))
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function PartidaRow({
  partida, mandante, visitante, palpite, onSaved,
}: {
  partida: Partida;
  mandante?: Selecao;
  visitante?: Selecao;
  palpite?: Palpite;
  onSaved: (p: Palpite) => void;
}) {
  const bloqueado = partida.status !== "aguardando";
  const [gm, setGm] = useState<string>(palpite ? String(palpite.gols_mandante) : "");
  const [gv, setGv] = useState<string>(palpite ? String(palpite.gols_visitante) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    const nm = parseInt(gm, 10);
    const nv = parseInt(gv, 10);
    if (Number.isNaN(nm) || Number.isNaN(nv) || nm < 0 || nv < 0) {
      setErro("Informe gols válidos.");
      return;
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("palpites")
        .upsert(
          {
            usuario_id: u.user.id,
            partida_id: partida.id,
            gols_mandante: nm,
            gols_visitante: nv,
          },
          { onConflict: "usuario_id,partida_id" }
        )
        .select("partida_id,gols_mandante,gols_visitante,pontos_ganhos")
        .single();
      if (error) throw error;
      onSaved(data as Palpite);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const data = partida.data_hora
    ? new Date(partida.data_hora).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "Data a definir";

  return (
    <li className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{data}</div>
        {palpite?.pontos_ganhos != null && palpite.pontos_ganhos > 0 && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
            +{palpite.pontos_ganhos} pts
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center justify-end gap-2 text-right">
          <span className="font-medium truncate">{mandante?.nome ?? "—"}</span>
          <span className="text-xl">{mandante?.bandeira ?? "🏳️"}</span>
        </div>
        <div className="flex items-center gap-2">
          <ScoreInput value={gm} onChange={setGm} disabled={bloqueado || saving} />
          <span className="text-muted-foreground">×</span>
          <ScoreInput value={gv} onChange={setGv} disabled={bloqueado || saving} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl">{visitante?.bandeira ?? "🏳️"}</span>
          <span className="font-medium truncate">{visitante?.nome ?? "—"}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {bloqueado ? "Palpites encerrados para esta partida." : "Você pode editar até o início do jogo."}
        </div>
        {!bloqueado && (
          <button
            onClick={salvar}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saving ? "Salvando" : saved ? "Salvo" : palpite ? "Atualizar" : "Salvar"}
          </button>
        )}
      </div>
      {erro && <div className="mt-2 text-xs text-destructive">{erro}</div>}
    </li>
  );
}

function ScoreInput({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input
      type="number"
      min={0}
      max={20}
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-10 w-12 rounded-md border border-border bg-input/40 text-center text-lg font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
    />
  );
}
