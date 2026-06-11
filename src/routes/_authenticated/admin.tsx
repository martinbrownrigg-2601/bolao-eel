import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Check, Loader2, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Admin — Resultados | BolãoEEL" }],
  }),
  component: AdminPage,
});

type Selecao = { id: string; nome: string; codigo: string; bandeira: string | null };
type Partida = {
  id: string;
  fase: string;
  grupo: string | null;
  data_hora: string | null;
  status: "aguardando" | "em_andamento" | "finalizada";
  mandante_id: string;
  visitante_id: string;
  gols_mandante: number | null;
  gols_visitante: number | null;
};

function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "aguardando" | "em_andamento" | "finalizada">("todas");

  async function carregar() {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setIsAdmin(false);
        return;
      }
      const { data: perfil } = await supabase
        .from("perfis")
        .select("is_admin")
        .eq("id", u.user.id)
        .maybeSingle();
      const admin = !!perfil?.is_admin;
      setIsAdmin(admin);
      if (!admin) return;

      const [{ data: sels }, { data: parts }] = await Promise.all([
        supabase.from("selecoes").select("id,nome,codigo,bandeira"),
        supabase.from("partidas").select("*").order("data_hora", { ascending: true }),
      ]);
      const m: Record<string, Selecao> = {};
      (sels ?? []).forEach((s) => (m[s.id] = s as Selecao));
      setSelecoes(m);
      setPartidas((parts ?? []) as Partida[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const filtradas = useMemo(
    () => (filtro === "todas" ? partidas : partidas.filter((p) => p.status === filtro)),
    [partidas, filtro],
  );

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-3 text-xl font-bold">Acesso restrito</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta área é exclusiva para administradores. Defina <code>is_admin = true</code> no seu
          perfil para acessar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Painel admin</h1>
          <p className="mt-1 text-muted-foreground">
            Lance placares e finalize partidas para distribuir os pontos automaticamente.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-card p-1 text-xs">
          {(["todas", "aguardando", "em_andamento", "finalizada"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`rounded px-2.5 py-1 transition-colors ${
                filtro === f ? "bg-primary text-primary-foreground" : "hover:bg-secondary/60"
              }`}
            >
              {f === "todas" ? "Todas" : f === "em_andamento" ? "Em andamento" : f === "aguardando" ? "Aguardando" : "Finalizadas"}
            </button>
          ))}
        </div>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro}
        </div>
      )}

      <ul className="grid gap-2">
        {filtradas.map((p) => (
          <PartidaAdminRow
            key={p.id}
            partida={p}
            mandante={selecoes[p.mandante_id]}
            visitante={selecoes[p.visitante_id]}
            onUpdated={(np) => setPartidas((prev) => prev.map((x) => (x.id === np.id ? np : x)))}
          />
        ))}
        {filtradas.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            Nenhuma partida nesse filtro.
          </li>
        )}
      </ul>
    </div>
  );
}

function PartidaAdminRow({
  partida,
  mandante,
  visitante,
  onUpdated,
}: {
  partida: Partida;
  mandante?: Selecao;
  visitante?: Selecao;
  onUpdated: (p: Partida) => void;
}) {
  const [gm, setGm] = useState<string>(partida.gols_mandante != null ? String(partida.gols_mandante) : "");
  const [gv, setGv] = useState<string>(partida.gols_visitante != null ? String(partida.gols_visitante) : "");
  const [status, setStatus] = useState<Partida["status"]>(partida.status);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    setSaving(true);
    try {
      const nm = gm === "" ? null : parseInt(gm, 10);
      const nv = gv === "" ? null : parseInt(gv, 10);
      if (status === "finalizada" && (nm == null || nv == null)) {
        throw new Error("Informe o placar para finalizar.");
      }
      const { data, error } = await supabase
        .from("partidas")
        .update({
          gols_mandante: nm,
          gols_visitante: nv,
          status,
          atualizada_em: new Date().toISOString(),
        })
        .eq("id", partida.id)
        .select("*")
        .single();
      if (error) throw error;

      // Recalcula pontuação dos palpites
      const { error: rpcErr } = await supabase.rpc("calcular_pontos_partida", {
        _partida_id: partida.id,
      });
      if (rpcErr) throw rpcErr;

      onUpdated(data as Partida);
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
    : "—";

  return (
    <li className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {partida.fase}
          {partida.grupo ? ` · Grupo ${partida.grupo}` : ""} · {data}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            partida.status === "finalizada"
              ? "bg-accent/20 text-accent"
              : partida.status === "em_andamento"
                ? "bg-primary/20 text-primary"
                : "bg-secondary text-muted-foreground"
          }`}
        >
          {partida.status}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center justify-end gap-2 text-right">
          <span className="font-medium truncate">{mandante?.nome ?? "—"}</span>
          <span className="text-xl">{mandante?.bandeira ?? "🏳️"}</span>
        </div>
        <div className="flex items-center gap-2">
          <ScoreInput value={gm} onChange={setGm} disabled={saving} />
          <span className="text-muted-foreground">×</span>
          <ScoreInput value={gv} onChange={setGv} disabled={saving} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl">{visitante?.bandeira ?? "🏳️"}</span>
          <span className="font-medium truncate">{visitante?.nome ?? "—"}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Partida["status"])}
          disabled={saving}
          className="h-8 rounded-md border border-border bg-input/40 px-2 text-xs"
        >
          <option value="aguardando">Aguardando</option>
          <option value="em_andamento">Em andamento</option>
          <option value="finalizada">Finalizada</option>
        </select>
        <button
          onClick={salvar}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saving ? "Salvando" : saved ? "Salvo" : "Salvar e recalcular"}
        </button>
      </div>
      {erro && <div className="mt-2 text-xs text-destructive">{erro}</div>}
    </li>
  );
}

function ScoreInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      max={20}
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="-"
      className="h-10 w-12 rounded-md border border-border bg-input/40 text-center text-lg font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
    />
  );
}
