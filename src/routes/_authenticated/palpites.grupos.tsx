import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FASE_LABEL, FASE_LABEL_CURTO, ordenarFases } from "@/lib/fases";

type Modo = "data" | "fase";

// Chave de dia no fuso LOCAL (não UTC) — "YYYY-MM-DD".
function diaLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function hojeLocal(): string {
  return diaLocal(new Date().toISOString());
}

// "YYYY-MM-DD" <-> Date (meia-noite local), para o calendário.
function dateDeDia(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function diaDeDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Rótulo amigável de um dia "YYYY-MM-DD".
function rotuloDia(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

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

// Uma partida deixa de aceitar palpite quando começa (data_hora passou)
// ou quando o admin já tirou do status "aguardando".
function palpiteFechado(p: Partida): boolean {
  if (p.status !== "aguardando") return true;
  if (p.data_hora && new Date(p.data_hora) <= new Date()) return true;
  return false;
}
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
          supabase.from("partidas").select("*").order("data_hora", { ascending: true }),
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

  // ---- Agrupamento por FASE (dentro de grupos, subdivide por letra) ----
  const fases = useMemo(() => {
    const porFase = new Map<string, Partida[]>();
    for (const p of partidas) {
      if (!porFase.has(p.fase)) porFase.set(p.fase, []);
      porFase.get(p.fase)!.push(p);
    }
    return ordenarFases([...porFase.keys()]).map((fase) => {
      const lista = porFase.get(fase)!;
      // subgrupos: por letra (grupos) ou um único bloco (mata-mata)
      const subMap = new Map<string, Partida[]>();
      for (const p of lista) {
        const k = fase === "grupos" ? (p.grupo ?? "?") : "_";
        if (!subMap.has(k)) subMap.set(k, []);
        subMap.get(k)!.push(p);
      }
      const sub = Array.from(subMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      return { fase, sub };
    });
  }, [partidas]);

  const [faseAtiva, setFaseAtiva] = useState<string | null>(null);
  // Seleciona a primeira fase disponível assim que as partidas carregam.
  useEffect(() => {
    if (faseAtiva === null && fases.length > 0) setFaseAtiva(fases[0].fase);
  }, [fases, faseAtiva]);

  const faseSelecionada = fases.find((f) => f.fase === faseAtiva) ?? fases[0];

  // ---- Agrupamento por DATA (dias com partida, ordenados) ----
  // Partidas sem data_hora ("a definir") ficam num balde próprio.
  const SEM_DATA = "sem-data";
  const dias = useMemo(() => {
    const set = new Set<string>();
    let temSemData = false;
    for (const p of partidas) {
      if (p.data_hora) set.add(diaLocal(p.data_hora));
      else temSemData = true;
    }
    const ordenados = [...set].sort();
    if (temSemData) ordenados.push(SEM_DATA);
    return ordenados;
  }, [partidas]);

  const partidasPorDia = useMemo(() => {
    const m = new Map<string, Partida[]>();
    for (const p of partidas) {
      const k = p.data_hora ? diaLocal(p.data_hora) : SEM_DATA;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    // dentro do dia, ordena por horário
    for (const lista of m.values()) {
      lista.sort((a, b) => (a.data_hora ?? "").localeCompare(b.data_hora ?? ""));
    }
    return m;
  }, [partidas]);

  // ---- Modo de visualização + dia ativo ----
  const [modo, setModo] = useState<Modo>("data");
  const [diaAtivo, setDiaAtivo] = useState<string | null>(null);

  // Default: dia de HOJE; se não houver jogo hoje, o próximo dia futuro;
  // se não houver futuro, o último dia disponível.
  useEffect(() => {
    if (diaAtivo !== null || dias.length === 0) return;
    const hoje = hojeLocal();
    const reais = dias.filter((d) => d !== SEM_DATA);
    const alvo =
      reais.find((d) => d === hoje) ??
      reais.find((d) => d > hoje) ??
      reais[reais.length - 1] ??
      dias[0];
    setDiaAtivo(alvo);
  }, [dias, diaAtivo]);

  // Dias reais (com jogo) para habilitar no calendário — exclui o balde "sem data".
  const diasComJogo = useMemo(
    () => new Set(dias.filter((d) => d !== SEM_DATA)),
    [dias],
  );
  const listaDoDia = diaAtivo ? (partidasPorDia.get(diaAtivo) ?? []) : [];

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const renderRow = (p: Partida, mostrarGrupo: boolean) => (
    <PartidaRow
      key={p.id}
      partida={p}
      mandante={selecoes[p.mandante_id]}
      visitante={selecoes[p.visitante_id]}
      palpite={palpites[p.id]}
      grupoLabel={
        mostrarGrupo
          ? p.fase === "grupos"
            ? p.grupo
              ? `Grupo ${p.grupo}`
              : null
            : (FASE_LABEL_CURTO[p.fase] ?? p.fase)
          : null
      }
      onSaved={(np) => setPalpites((prev) => ({ ...prev, [p.id]: np }))}
    />
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Palpites</h1>
        <p className="mt-1 text-muted-foreground">
          Crave o placar. <span className="text-primary font-medium">5 pts</span> pelo resultado +{" "}
          <span className="text-accent font-medium">2 pts</span> pelo placar exato. Palpites fecham
          no início de cada jogo.
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

      {/* Linha única de controles: toggle + (no modo data) picker de calendário */}
      {partidas.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {(["data", "fase"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  modo === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "data" ? "Data" : "Fase"}
              </button>
            ))}
          </div>

          {modo === "data" && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-secondary/50">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  {diaAtivo && diaAtivo !== SEM_DATA
                    ? rotuloDia(diaAtivo)
                    : diaAtivo === SEM_DATA
                      ? "Data a definir"
                      : "Escolher dia"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={diaAtivo && diaAtivo !== SEM_DATA ? dateDeDia(diaAtivo) : undefined}
                  onSelect={(d) => d && setDiaAtivo(diaDeDate(d))}
                  defaultMonth={
                    diaAtivo && diaAtivo !== SEM_DATA ? dateDeDia(diaAtivo) : new Date()
                  }
                  disabled={(d) => !diasComJogo.has(diaDeDate(d))}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* ---------------- Modo DATA ---------------- */}
      {modo === "data" && diaAtivo && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {diaAtivo === SEM_DATA ? "Data a definir" : rotuloDia(diaAtivo)}
          </h3>
          {listaDoDia.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
              Nenhum jogo neste dia.
            </div>
          ) : (
            <ul className="grid gap-2">{listaDoDia.map((p) => renderRow(p, true))}</ul>
          )}
        </section>
      )}

      {/* ---------------- Modo FASE ---------------- */}
      {modo === "fase" && fases.length > 0 && (
        <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
          {fases.map(({ fase }) => (
            <button
              key={fase}
              onClick={() => setFaseAtiva(fase)}
              className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                faseSelecionada?.fase === fase
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {FASE_LABEL_CURTO[fase] ?? fase}
            </button>
          ))}
        </nav>
      )}

      {modo === "fase" && faseSelecionada && (
        <div className="space-y-6">
          {faseSelecionada.fase !== "grupos" && (
            <h2 className="text-xl font-bold text-primary">
              {FASE_LABEL[faseSelecionada.fase] ?? faseSelecionada.fase}
            </h2>
          )}
          {faseSelecionada.sub.map(([k, lista]) => (
            <section key={k}>
              {faseSelecionada.fase === "grupos" ? (
                <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-foreground font-bold">
                    {k}
                  </span>
                  Grupo {k}
                </h3>
              ) : null}
              <ul className="grid gap-2">{lista.map((p) => renderRow(p, false))}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PartidaRow({
  partida,
  mandante,
  visitante,
  palpite,
  grupoLabel,
  onSaved,
}: {
  partida: Partida;
  mandante?: Selecao;
  visitante?: Selecao;
  palpite?: Palpite;
  grupoLabel?: string | null;
  onSaved: (p: Palpite) => void;
}) {
  const bloqueado = palpiteFechado(partida);
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
          { onConflict: "usuario_id,partida_id" },
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
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Data a definir";

  return (
    <li className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {grupoLabel && (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold uppercase tracking-wide">
              {grupoLabel}
            </span>
          )}
          <span>{data}</span>
        </div>
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
          {bloqueado ? (
            <Link
              to="/palpites/comparar/$id"
              params={{ id: partida.id }}
              className="font-medium text-primary hover:underline"
            >
              Ver palpites do bolão →
            </Link>
          ) : (
            "Você pode editar até o início do jogo."
          )}
        </div>
        {!bloqueado && (
          <button
            onClick={salvar}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {saving ? "Salvando" : saved ? "Salvo" : palpite ? "Atualizar" : "Salvar"}
          </button>
        )}
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
      className="h-10 w-12 rounded-md border border-border bg-input/40 text-center text-lg font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
    />
  );
}
