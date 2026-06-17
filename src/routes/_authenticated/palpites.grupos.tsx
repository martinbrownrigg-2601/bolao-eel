import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FASE_LABEL, FASE_LABEL_CURTO, ordenarFases } from "@/lib/fases";
import { Flag } from "@/components/Flag";
import yagoMissImage from "../../images/yago_miss.webp";
import { useBolao } from "@/contexts/BolaoContext";
import { BOLAO_COPA_2026_ID } from "@/lib/boloes-especiais";

type Modo = "data" | "fase";

// Prazo fixo dos palpites extras: 13/06/2026 15h Brasília (UTC-3) = 18:00 UTC
const PRAZO_EXTRAS = new Date("2026-06-13T18:00:00Z");
function extrasAbertos() {
  return new Date() < PRAZO_EXTRAS;
}

type Jogador = { id: string; nome: string; selecao_id: string };
type PalpiteExtra = {
  id?: string;
  artilheiro_id: string | null;
  campeao_id: string | null;
  pontos_ganhos: number | null;
};

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

function tempoBloqueio(p: Partida): number | null {
  if (p.status !== "aguardando" && p.data_hora) {
    return new Date(p.data_hora).getTime();
  }

  if (p.data_hora) {
    return new Date(p.data_hora).getTime();
  }

  return null;
}
type Palpite = {
  partida_id: string;
  gols_mandante: number;
  gols_visitante: number;
  pontos_ganhos: number | null;
};

// Placar AO VIVO (referência visual; não afeta pontuação).
type PlacarLive = {
  partida_id: string;
  gols_mandante_live: number | null;
  gols_visitante_live: number | null;
  minuto: string | null;
  ao_vivo: boolean;
};

function PalpitesGrupos() {
  const { bolaoAtivo } = useBolao();
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [palpites, setPalpites] = useState<Record<string, Palpite>>({});
  const [placaresLive, setPlacaresLive] = useState<Record<string, PlacarLive>>({});
  const [jogadores, setJogadores] = useState<Jogador[]>([]);
  const [palpiteExtra, setPalpiteExtra] = useState<PalpiteExtra | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: sels }, { data: parts }, { data: u }, { data: jogs }] = await Promise.all([
          supabase.from("selecoes").select("id,nome,codigo,bandeira"),
          supabase.from("partidas").select("*").order("data_hora", { ascending: true }),
          supabase.auth.getUser(),
          supabase.from("jogadores").select("id,nome,selecao_id").order("nome"),
        ]);

        const selMap: Record<string, Selecao> = {};
        (sels ?? []).forEach((s) => (selMap[s.id] = s as Selecao));
        setSelecoes(selMap);
        setPartidas((parts ?? []) as Partida[]);
        setJogadores((jogs ?? []) as Jogador[]);

        if (u.user) {
          const [{ data: pls }, { data: pe }] = await Promise.all([
            supabase
              .from("palpites")
              .select("partida_id,gols_mandante,gols_visitante,pontos_ganhos")
              .eq("usuario_id", u.user.id),
            bolaoAtivo
              ? supabase
                  .from("palpites_extras")
                  .select("id,artilheiro_id,campeao_id,pontos_ganhos")
                  .eq("usuario_id", u.user.id)
                  .eq("bolao_id", bolaoAtivo.id)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
          ]);
          const pMap: Record<string, Palpite> = {};
          (pls ?? []).forEach((p) => (pMap[p.partida_id] = p as Palpite));
          setPalpites(pMap);
          if (pe) setPalpiteExtra(pe as PalpiteExtra);
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    })();
  }, [bolaoAtivo]);

  // ---- Placar AO VIVO: busca inicial + polling a cada 45s SÓ se houver jogo
  // ao vivo (referência visual; não interfere na pontuação). ----
  useEffect(() => {
    let cancelado = false;

    async function buscarLive(): Promise<boolean> {
      const { data } = await supabase
        .from("placares_ao_vivo")
        .select("partida_id,gols_mandante_live,gols_visitante_live,minuto,ao_vivo")
        .eq("ao_vivo", true);
      if (cancelado) return false;
      const m: Record<string, PlacarLive> = {};
      (data ?? []).forEach((l) => (m[l.partida_id] = l as PlacarLive));
      setPlacaresLive(m);
      return (data ?? []).length > 0;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = (temLive: boolean) => {
      if (cancelado) return;
      // Sem jogo ao vivo: relaxa o polling (5 min) para detectar o início.
      timer = setTimeout(loop, temLive ? 45_000 : 5 * 60_000);
    };
    const loop = async () => agendar(await buscarLive());
    void loop();

    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
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
  const diasComJogo = useMemo(() => new Set(dias.filter((d) => d !== SEM_DATA)), [dias]);

  // Navegação prev/next entre os dias disponíveis (na ordem de `dias`).
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

  const renderRow = (p: Partida, mostrarGrupo: boolean) => (
    <PartidaRow
      key={p.id}
      partida={p}
      mandante={selecoes[p.mandante_id]}
      visitante={selecoes[p.visitante_id]}
      palpite={palpites[p.id]}
      live={placaresLive[p.id]}
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

      {/* Palpites Especiais */}
      {bolaoAtivo && jogadores.length > 0 && (
        <PalpitesExtrasCard
          selecoes={selecoes}
          jogadores={jogadores}
          palpiteExtra={palpiteExtra}
          bolaoId={bolaoAtivo.id}
          onSaved={setPalpiteExtra}
        />
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

// Dropdown customizado de seleção (com Flag)
function SelecaoDropdown({
  value,
  onChange,
  selecoesList,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  selecoesList: Selecao[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const sel = selecoesList.find((s) => s.id === value);
  const filtradas = busca
    ? selecoesList.filter((s) => s.nome.toLowerCase().includes(busca.toLowerCase()))
    : selecoesList;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-input/40 px-2 text-sm text-left hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {sel ? (
            <>
              <Flag codigo={sel.codigo} bandeira={sel.bandeira} size={16} />
              <span className="flex-1 truncate">{sel.nome}</span>
            </>
          ) : (
            <span className="flex-1 text-muted-foreground">{placeholder}</span>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="border-b border-border px-2 py-1.5">
          <input
            autoFocus
            placeholder="Buscar seleção..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-60 overflow-y-auto py-1">
          <li>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setBusca("");
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary/50"
            >
              — nenhuma —
            </button>
          </li>
          {filtradas.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                  setBusca("");
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary/50 ${s.id === value ? "bg-primary/10 font-medium" : ""}`}
              >
                <Flag codigo={s.codigo} bandeira={s.bandeira} size={16} />
                {s.nome}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// Dropdown customizado de jogador (dois passos: seleção → jogador)
function JogadorDropdown({
  artilheiroId,
  onChangeArtilheiro,
  selecoes,
  jogadores,
}: {
  artilheiroId: string;
  onChangeArtilheiro: (id: string) => void;
  selecoes: Record<string, Selecao>;
  jogadores: Jogador[];
}) {
  // Passo 1: seleção escolhida para filtrar jogadores
  const jogadorSelecionado = jogadores.find((j) => j.id === artilheiroId);
  const [selFiltroId, setSelFiltroId] = useState<string>(jogadorSelecionado?.selecao_id ?? "");

  // Quando o artilheiro muda externamente (ex: sincronização inicial), atualiza o filtro
  useEffect(() => {
    if (jogadorSelecionado) setSelFiltroId(jogadorSelecionado.selecao_id);
  }, [jogadorSelecionado]);

  const selecoesList = useMemo(
    () => Object.values(selecoes).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [selecoes],
  );

  const jogadoresDaSel = useMemo(
    () =>
      selFiltroId
        ? jogadores
            .filter((j) => j.selecao_id === selFiltroId)
            .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        : [],
    [jogadores, selFiltroId],
  );

  const selFiltro = selecoes[selFiltroId];

  const [openJog, setOpenJog] = useState(false);
  const [buscaJog, setBuscaJog] = useState("");
  const jogFiltrados = buscaJog
    ? jogadoresDaSel.filter((j) => j.nome.toLowerCase().includes(buscaJog.toLowerCase()))
    : jogadoresDaSel;

  return (
    <div className="flex gap-2">
      {/* Passo 1: seleção */}
      <div className="flex-1">
        <SelecaoDropdown
          value={selFiltroId}
          onChange={(id) => {
            setSelFiltroId(id);
            onChangeArtilheiro(""); // limpa jogador ao trocar seleção
          }}
          selecoesList={selecoesList}
          placeholder="Seleção..."
        />
      </div>

      {/* Passo 2: jogador */}
      <div className="flex-1">
        <Popover open={openJog} onOpenChange={setOpenJog}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!selFiltroId}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-input/40 px-2 text-sm text-left hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40"
            >
              {jogadorSelecionado ? (
                <>
                  {selFiltro && (
                    <Flag codigo={selFiltro.codigo} bandeira={selFiltro.bandeira} size={14} />
                  )}
                  <span className="flex-1 truncate">{jogadorSelecionado.nome}</span>
                </>
              ) : (
                <span className="flex-1 text-muted-foreground">
                  {selFiltroId ? "Jogador..." : "—"}
                </span>
              )}
              <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <div className="border-b border-border px-2 py-1.5">
              <input
                autoFocus
                placeholder="Buscar jogador..."
                value={buscaJog}
                onChange={(e) => setBuscaJog(e.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul className="max-h-60 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChangeArtilheiro("");
                    setOpenJog(false);
                    setBuscaJog("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary/50"
                >
                  — nenhum —
                </button>
              </li>
              {jogFiltrados.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeArtilheiro(j.id);
                      setOpenJog(false);
                      setBuscaJog("");
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary/50 ${j.id === artilheiroId ? "bg-primary/10 font-medium" : ""}`}
                  >
                    {j.nome}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function PalpitesExtrasCard({
  selecoes,
  jogadores,
  palpiteExtra,
  bolaoId,
  onSaved,
}: {
  selecoes: Record<string, Selecao>;
  jogadores: Jogador[];
  palpiteExtra: PalpiteExtra | null;
  bolaoId: string;
  onSaved: (p: PalpiteExtra) => void;
}) {
  const aberto = extrasAbertos();
  const [expandido, setExpandido] = useState(false);
  const [artilheiroId, setArtilheiroId] = useState(palpiteExtra?.artilheiro_id ?? "");
  const [campeaoId, setCampeaoId] = useState(palpiteExtra?.campeao_id ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (palpiteExtra) {
      setArtilheiroId(palpiteExtra.artilheiro_id ?? "");
      setCampeaoId(palpiteExtra.campeao_id ?? "");
    }
  }, [palpiteExtra]);

  const selecoesList = useMemo(
    () => Object.values(selecoes).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [selecoes],
  );

  const jogadorSel = jogadores.find((j) => j.id === artilheiroId);
  const campeaoSel = selecoes[campeaoId];
  const artilheiroSel = jogadorSel ? selecoes[jogadorSel.selecao_id] : null;

  // Resumo para o header recolhido
  const resumoArtilheiro = jogadorSel ? jogadorSel.nome : "—";
  const resumoCampeao = campeaoSel ? campeaoSel.nome : "—";

  async function salvar() {
    setErro(null);
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("palpites_extras")
        .upsert(
          {
            usuario_id: u.user.id,
            bolao_id: bolaoId,
            artilheiro_id: artilheiroId || null,
            campeao_id: campeaoId || null,
          },
          { onConflict: "usuario_id,bolao_id" },
        )
        .select("id,artilheiro_id,campeao_id,pontos_ganhos")
        .single();
      if (error) throw error;
      onSaved(data as PalpiteExtra);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const prazoStr = PRAZO_EXTRAS.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
      {/* Header clicável */}
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm shrink-0">Palpites Especiais</span>
          {!expandido && (
            <span className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground truncate">
              <span className="flex items-center gap-1">
                {artilheiroSel && (
                  <Flag codigo={artilheiroSel.codigo} bandeira={artilheiroSel.bandeira} size={13} />
                )}
                {resumoArtilheiro}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                {campeaoSel && (
                  <Flag codigo={campeaoSel.codigo} bandeira={campeaoSel.bandeira} size={13} />
                )}
                {resumoCampeao}
              </span>
              {palpiteExtra?.pontos_ganhos != null && (
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">
                  +{palpiteExtra.pontos_ganhos} pts
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:block">
            {aberto ? `até ${prazoStr}` : "encerrado"}
          </span>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${expandido ? "rotate-90" : "-rotate-90"}`}
          />
        </div>
      </button>

      {/* Conteúdo expandido */}
      {expandido && (
        <div className="border-t border-primary/20 px-4 py-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Artilheiro */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <span>Artilheiro</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                  15 pts
                </span>
              </label>
              {aberto ? (
                <JogadorDropdown
                  artilheiroId={artilheiroId}
                  onChangeArtilheiro={setArtilheiroId}
                  selecoes={selecoes}
                  jogadores={jogadores}
                />
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  {jogadorSel ? (
                    <>
                      {artilheiroSel && (
                        <Flag
                          codigo={artilheiroSel.codigo}
                          bandeira={artilheiroSel.bandeira}
                          size={16}
                        />
                      )}
                      <span>{jogadorSel.nome}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Não preenchido</span>
                  )}
                  {palpiteExtra?.pontos_ganhos != null && (
                    <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                      {palpiteExtra.pontos_ganhos >= 15 ? "+15 pts" : "+0 pts"}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Campeã */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <span>Seleção Campeã</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                  15 pts
                </span>
              </label>
              {aberto ? (
                <SelecaoDropdown
                  value={campeaoId}
                  onChange={setCampeaoId}
                  selecoesList={selecoesList}
                  placeholder="— Escolha uma seleção —"
                />
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  {campeaoSel ? (
                    <>
                      <Flag codigo={campeaoSel.codigo} bandeira={campeaoSel.bandeira} size={16} />
                      <span>{campeaoSel.nome}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Não preenchido</span>
                  )}
                  {palpiteExtra?.pontos_ganhos != null && (
                    <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                      {palpiteExtra.pontos_ganhos >= 15 ? "+15 pts" : "+0 pts"}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {aberto && (
            <div className="flex items-center justify-between gap-2">
              {erro && <span className="text-xs text-destructive">{erro}</span>}
              <button
                onClick={salvar}
                disabled={saving || (!artilheiroId && !campeaoId)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                {saving ? "Salvando" : saved ? "Salvo" : "Salvar palpites especiais"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Selo "AO VIVO 1–0 · 67'" — referência visual, não influi na pontuação.
function PlacarLiveSelo({ live }: { live?: PlacarLive }) {
  if (!live?.ao_vivo || live.gols_mandante_live == null || live.gols_visitante_live == null) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      AO VIVO {live.gols_mandante_live}–{live.gols_visitante_live}
      {live.minuto ? ` · ${live.minuto}` : ""}
    </span>
  );
}

function PartidaRow({
  partida,
  mandante,
  visitante,
  palpite,
  live,
  grupoLabel,
  onSaved,
}: {
  partida: Partida;
  mandante?: Selecao;
  visitante?: Selecao;
  palpite?: Palpite;
  live?: PlacarLive;
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

  const { bolaoAtivo } = useBolao();
  const eCopa2026 = bolaoAtivo?.id === BOLAO_COPA_2026_ID;

  const acertouExato =
    bloqueado &&
    palpite != null &&
    partida.gols_mandante != null &&
    partida.gols_visitante != null &&
    palpite.gols_mandante === partida.gols_mandante &&
    palpite.gols_visitante === partida.gols_visitante;

  const semPontuacao = (palpite?.pontos_ganhos ?? 0) <= 0;
  const mostraYagoAposFim = (() => {
    if (!eCopa2026) return false;
    if (!bloqueado || !semPontuacao) return false;
    const bloqueadoEm = tempoBloqueio(partida);
    if (!bloqueadoEm) return false;
    const limiteExibicao = bloqueadoEm + 2 * 60 * 60 * 1000;
    return Date.now() >= limiteExibicao;
  })();

  const mostrarAustinReaves = eCopa2026 && acertouExato;
  const mostrarYago = !mostrarAustinReaves && mostraYagoAposFim;

  return (
    <li className="relative flex items-start gap-3 rounded-lg border border-border bg-card p-3 sm:p-4 overflow-hidden">
      {mostrarAustinReaves && (
        <img
          src="https://media1.tenor.com/m/r9CdFhGNJxAAAAAd/austin-reaves-reaves.gif"
          alt="I'm him!"
          className="absolute top-1/2 -translate-y-1/2 right-24 h-3/5 w-auto object-cover pointer-events-none"
        />
      )}
      <div className="flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {grupoLabel && (
              <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold uppercase tracking-wide">
                {grupoLabel}
              </span>
            )}
            <span>{data}</span>
            <PlacarLiveSelo live={live} />
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
            <Flag codigo={mandante?.codigo} bandeira={mandante?.bandeira} size={18} />
          </div>
          <div className="flex items-center gap-2">
            <ScoreInput value={gm} onChange={setGm} disabled={bloqueado || saving} />
            <span className="text-muted-foreground">×</span>
            <ScoreInput value={gv} onChange={setGv} disabled={bloqueado || saving} />
          </div>
          <div className="flex items-center gap-2">
            <Flag codigo={visitante?.codigo} bandeira={visitante?.bandeira} size={18} />
            <span className="font-medium truncate">{visitante?.nome ?? "—"}</span>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {bloqueado ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/palpites/comparar/$id"
                  params={{ id: partida.id }}
                  className="font-medium text-primary hover:underline"
                >
                  Ver palpites do bolão →
                </Link>
              </div>
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
      </div>
      {mostrarYago && (
        <div className="flex items-center justify-center">
          <img
            src={yagoMissImage}
            alt="Sem pontuação"
            className="mt-1 h-22 w-22  shrink-0 rounded-full object-cover ring-2 ring-border shadow-sm"
          />
        </div>
      )}
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
