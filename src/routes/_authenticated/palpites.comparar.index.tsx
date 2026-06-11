import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FASE_LABEL, FASE_LABEL_CURTO, ordenarFases } from "@/lib/fases";
import { Flag } from "@/components/Flag";
import { useBolao } from "@/contexts/BolaoContext";

export const Route = createFileRoute("/_authenticated/palpites/comparar/")({
  head: () => ({
    meta: [
      { title: "Comparar palpites | BolãoEEL" },
      { name: "description", content: "Veja os palpites do bolão nos jogos já iniciados." },
    ],
  }),
  component: CompararIndex,
});

type Modo = "data" | "fase";

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

function rotuloDia(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

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

function jaIniciada(p: Partida): boolean {
  if (p.status !== "aguardando") return true;
  if (p.data_hora && new Date(p.data_hora) <= new Date()) return true;
  return false;
}

const SEM_DATA = "sem-data";

function CompararIndex() {
  const { bolaoAtivo } = useBolao();
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: sels }, { data: parts, error }] = await Promise.all([
          supabase.from("selecoes").select("id,nome,codigo,bandeira"),
          supabase.from("partidas").select("*").order("data_hora", { ascending: true }),
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

  const iniciadas = useMemo(() => partidas.filter(jaIniciada), [partidas]);

  // ---- Agrupamento por FASE ----
  const fases = useMemo(() => {
    const porFase = new Map<string, Partida[]>();
    for (const p of iniciadas) {
      if (!porFase.has(p.fase)) porFase.set(p.fase, []);
      porFase.get(p.fase)!.push(p);
    }
    return ordenarFases([...porFase.keys()]).map((fase) => {
      const lista = porFase.get(fase)!;
      const subMap = new Map<string, Partida[]>();
      for (const p of lista) {
        const k = fase === "grupos" ? (p.grupo ?? "?") : "_";
        if (!subMap.has(k)) subMap.set(k, []);
        subMap.get(k)!.push(p);
      }
      const sub = Array.from(subMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      return { fase, sub };
    });
  }, [iniciadas]);

  const [faseAtiva, setFaseAtiva] = useState<string | null>(null);
  useEffect(() => {
    if (faseAtiva === null && fases.length > 0) setFaseAtiva(fases[0].fase);
  }, [fases, faseAtiva]);
  const faseSelecionada = fases.find((f) => f.fase === faseAtiva) ?? fases[0];

  // ---- Agrupamento por DATA ----
  const dias = useMemo(() => {
    const set = new Set<string>();
    let temSemData = false;
    for (const p of iniciadas) {
      if (p.data_hora) set.add(diaLocal(p.data_hora));
      else temSemData = true;
    }
    const ordenados = [...set].sort();
    if (temSemData) ordenados.push(SEM_DATA);
    return ordenados;
  }, [iniciadas]);

  const partidasPorDia = useMemo(() => {
    const m = new Map<string, Partida[]>();
    for (const p of iniciadas) {
      const k = p.data_hora ? diaLocal(p.data_hora) : SEM_DATA;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    for (const lista of m.values()) {
      lista.sort((a, b) => (a.data_hora ?? "").localeCompare(b.data_hora ?? ""));
    }
    return m;
  }, [iniciadas]);

  // ---- Modo de visualização + dia ativo ----
  const [modo, setModo] = useState<Modo>("data");
  const [diaAtivo, setDiaAtivo] = useState<string | null>(null);

  // Default: dia mais recente com jogo iniciado (último dia disponível).
  useEffect(() => {
    if (diaAtivo !== null || dias.length === 0) return;
    const hoje = hojeLocal();
    const reais = dias.filter((d) => d !== SEM_DATA);
    // Prefere hoje se tiver jogo, senão o dia mais recente passado, senão o primeiro disponível.
    const alvo =
      reais.find((d) => d === hoje) ??
      [...reais].reverse().find((d) => d <= hoje) ??
      reais[0] ??
      dias[0];
    setDiaAtivo(alvo);
  }, [dias, diaAtivo]);

  const diasComJogo = useMemo(
    () => new Set(dias.filter((d) => d !== SEM_DATA)),
    [dias],
  );

  const idxAtivo = diaAtivo ? dias.indexOf(diaAtivo) : -1;
  const temAnterior = idxAtivo > 0;
  const temProximo = idxAtivo >= 0 && idxAtivo < dias.length - 1;
  const irParaDia = (delta: number) => {
    if (idxAtivo < 0) return;
    const alvo = dias[idxAtivo + delta];
    if (alvo) setDiaAtivo(alvo);
  };
  const listaDoDia = diaAtivo ? (partidasPorDia.get(diaAtivo) ?? []) : [];

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const renderCard = (p: Partida) => {
    const m = selecoes[p.mandante_id];
    const v = selecoes[p.visitante_id];
    const temPlacar = p.gols_mandante != null && p.gols_visitante != null;
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
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!temPlacar && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">
                  ao vivo
                </span>
              )}
              <span>
                {FASE_LABEL_CURTO[p.fase] ?? p.fase}
                {p.grupo ? ` · Grupo ${p.grupo}` : ""} · {data}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 font-medium">
              <Flag codigo={m?.codigo} bandeira={m?.bandeira} size={16} />
              <span className="truncate">{m?.nome ?? "—"}</span>
              {temPlacar ? (
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                  {p.gols_mandante} × {p.gols_visitante}
                </span>
              ) : (
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">vs</span>
              )}
              <span className="truncate">{v?.nome ?? "—"}</span>
              <Flag codigo={v?.codigo} bandeira={v?.bandeira} size={16} />
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Comparar palpites</h1>
        <p className="mt-1 text-muted-foreground">
          {bolaoAtivo
            ? `Palpites dos membros de "${bolaoAtivo.nome}" nos jogos já iniciados.`
            : "Depois que um jogo começa, veja o que cada membro do seu bolão palpitou."}
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
        <>
          {/* Controles: toggle Data/Fase + navegação de datas */}
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
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => irParaDia(-1)}
                  disabled={!temAnterior}
                  aria-label="Dia anterior"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary/50 disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

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

                <button
                  type="button"
                  onClick={() => irParaDia(1)}
                  disabled={!temProximo}
                  aria-label="Próximo dia"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary/50 disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* ---------------- Modo DATA ---------------- */}
          {modo === "data" && diaAtivo && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                {diaAtivo === SEM_DATA ? "Data a definir" : rotuloDia(diaAtivo)}
              </h3>
              {listaDoDia.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                  Nenhum jogo iniciado neste dia.
                </div>
              ) : (
                <ul className="grid gap-2">{listaDoDia.map(renderCard)}</ul>
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
                  <ul className="grid gap-2">{lista.map(renderCard)}</ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
