import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Flag } from "@/components/Flag";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FASES_TODAS, FASE_LABEL, FASE_LABEL_CURTO, ordenarFases } from "@/lib/fases";

type Modo = "data" | "fase";

// Retorna "YYYY-MM-DD" no fuso de Brasília (UTC-3).
// Jogos entre 00h e 02h59 (Brasília) são agrupados no dia anterior.
function diaLocal(iso: string): string {
  const d = new Date(iso);
  const horaBrasilia = (d.getUTCHours() - 3 + 24) % 24;
  const recuar = horaBrasilia < 3;
  const msBrasilia = d.getTime() - 3 * 3600_000 - (recuar ? 24 * 3600_000 : 0);
  const ref = new Date(msBrasilia);
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ref.getUTCDate()).padStart(2, "0");
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

// Status real exibido na lista admin. Deriva de placar + horário, sem depender
// só do campo `status` cru (que costuma ficar travado em "aguardando").
type StatusReal = "finalizada" | "em_andamento" | "aguardando";
function statusReal(p: Partida): StatusReal {
  // Placar lançado => partida resolvida.
  if (p.gols_mandante != null && p.gols_visitante != null) return "finalizada";
  // Admin já marcou como finalizada (sem placar ainda) também conta.
  if (p.status === "finalizada") return "finalizada";
  // Horário já passou, mas ninguém lançou placar => em andamento.
  if (p.data_hora && new Date(p.data_hora) <= new Date()) return "em_andamento";
  return "aguardando";
}

const STATUS_LABEL: Record<StatusReal, string> = {
  finalizada: "Finalizada",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
};

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Admin — Resultados | BolãoEEL" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    prefill_fase: typeof search.prefill_fase === "string" ? search.prefill_fase : undefined,
    prefill_mandante: typeof search.prefill_mandante === "string" ? search.prefill_mandante : undefined,
    prefill_visitante: typeof search.prefill_visitante === "string" ? search.prefill_visitante : undefined,
    prefill_slot: typeof search.prefill_slot === "string" ? search.prefill_slot : undefined,
  }),
  component: AdminPage,
});

type Selecao = { id: string; nome: string; codigo: string; bandeira: string | null };
type Partida = {
  id: string;
  fase: string;
  grupo: string | null;
  data_hora: string | null;
  estadio: string | null;
  status: "aguardando" | "em_andamento" | "finalizada";
  mandante_id: string;
  visitante_id: string;
  gols_mandante: number | null;
  gols_visitante: number | null;
  penaltis_mandante: number | null;
  penaltis_visitante: number | null;
};

function AdminPage() {
  const { prefill_fase, prefill_mandante, prefill_visitante, prefill_slot } = Route.useSearch();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [selecoes, setSelecoes] = useState<Record<string, Selecao>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "aguardando" | "em_andamento" | "finalizada">(
    "todas",
  );
  const [modo, setModo] = useState<Modo>("data");
  const [faseAtiva, setFaseAtiva] = useState<string | null>(null);
  const [diaAtivo, setDiaAtivo] = useState<string | null>(null);

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

  // Aplica o filtro de status (derivado) antes de qualquer agrupamento.
  const porStatus = useMemo(
    () => partidas.filter((p) => filtro === "todas" || statusReal(p) === filtro),
    [partidas, filtro],
  );

  // Fases que têm ao menos uma partida (após filtro), em ordem oficial.
  const fasesDisponiveis = useMemo(
    () => ordenarFases([...new Set(porStatus.map((p) => p.fase))]),
    [porStatus],
  );

  // Seleciona a primeira fase assim que as partidas carregam.
  useEffect(() => {
    if (faseAtiva === null && fasesDisponiveis.length > 0) setFaseAtiva(fasesDisponiveis[0]);
  }, [fasesDisponiveis, faseAtiva]);

  // ---- Agrupamento por DATA (dias com partida, ordenados) ----
  // Partidas sem data_hora ("a definir") ficam num balde próprio.
  const SEM_DATA = "sem-data";
  const dias = useMemo(() => {
    const set = new Set<string>();
    let temSemData = false;
    for (const p of porStatus) {
      if (p.data_hora) set.add(diaLocal(p.data_hora));
      else temSemData = true;
    }
    const ordenados = [...set].sort();
    if (temSemData) ordenados.push(SEM_DATA);
    return ordenados;
  }, [porStatus]);

  const partidasPorDia = useMemo(() => {
    const m = new Map<string, Partida[]>();
    for (const p of porStatus) {
      const k = p.data_hora ? diaLocal(p.data_hora) : SEM_DATA;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    for (const lista of m.values()) {
      lista.sort((a, b) => (a.data_hora ?? "").localeCompare(b.data_hora ?? ""));
    }
    return m;
  }, [porStatus]);

  // Default: dia de HOJE; senão o próximo dia futuro; senão o último disponível.
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

  // Dias reais (com jogo) para habilitar no calendário.
  const diasComJogo = useMemo(() => new Set(dias.filter((d) => d !== SEM_DATA)), [dias]);

  // Navegação prev/next entre os dias disponíveis.
  const idxAtivo = diaAtivo ? dias.indexOf(diaAtivo) : -1;
  const temAnterior = idxAtivo > 0;
  const temProximo = idxAtivo >= 0 && idxAtivo < dias.length - 1;
  const irParaDia = (delta: number) => {
    if (idxAtivo < 0) return;
    const alvo = dias[idxAtivo + delta];
    if (alvo) setDiaAtivo(alvo);
  };
  const listaDoDia = diaAtivo ? (partidasPorDia.get(diaAtivo) ?? []) : [];

  // Modo FASE: partidas da fase ativa.
  const filtradasFase = useMemo(
    () => porStatus.filter((p) => faseAtiva === null || p.fase === faseAtiva),
    [porStatus, faseAtiva],
  );

  const selecoesList = useMemo(
    () => Object.values(selecoes).sort((a, b) => a.nome.localeCompare(b.nome)),
    [selecoes],
  );

  const renderRow = (p: Partida) => (
    <PartidaAdminRow
      key={p.id}
      partida={p}
      mandante={selecoes[p.mandante_id]}
      visitante={selecoes[p.visitante_id]}
      selecoes={selecoesList}
      onUpdated={(np) => setPartidas((prev) => prev.map((x) => (x.id === np.id ? np : x)))}
      onReload={() => void carregar()}
    />
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
              {f === "todas"
                ? "Todas"
                : f === "em_andamento"
                  ? "Em andamento"
                  : f === "aguardando"
                    ? "Aguardando"
                    : "Finalizadas"}
            </button>
          ))}
        </div>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro}
        </div>
      )}

      <SincronizarResultados />

      <ResultadoExtrasAdmin selecoes={selecoesList} />

      <CriarPartida
        selecoes={selecoesList}
        onCriada={() => void carregar()}
        prefill={prefill_fase ? { fase: prefill_fase, mandante: prefill_mandante, visitante: prefill_visitante, slot: prefill_slot } : undefined}
      />

      {/* Linha de controles: toggle Data/Fase + (no modo data) picker de calendário */}
      {porStatus.length > 0 && (
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
              Nenhuma partida nesse dia.
            </div>
          ) : (
            <ul className="grid gap-2">{listaDoDia.map(renderRow)}</ul>
          )}
        </section>
      )}

      {/* ---------------- Modo FASE ---------------- */}
      {modo === "fase" && fasesDisponiveis.length > 0 && (
        <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
          {fasesDisponiveis.map((fase) => (
            <button
              key={fase}
              onClick={() => setFaseAtiva(fase)}
              className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                faseAtiva === fase
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {FASE_LABEL_CURTO[fase] ?? fase}
            </button>
          ))}
        </nav>
      )}

      {modo === "fase" && (
        <section>
          {faseAtiva && faseAtiva !== "grupos" && (
            <h2 className="mb-3 text-xl font-bold text-primary">
              {FASE_LABEL[faseAtiva] ?? faseAtiva}
            </h2>
          )}
          <ul className="grid gap-2">
            {filtradasFase.map(renderRow)}
            {filtradasFase.length === 0 && (
              <li className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                Nenhuma partida nesse filtro.
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function AdminSelecaoDropdown({
  value,
  onChange,
  selecoes,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  selecoes: Selecao[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const sel = selecoes.find((s) => s.id === value);
  const filtradas = busca
    ? selecoes.filter((s) => s.nome.toLowerCase().includes(busca.toLowerCase()))
    : selecoes;

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

function AdminJogadorDropdown({
  artilheiroId,
  onChangeArtilheiro,
  selMap,
  jogadores,
  selecoesList,
}: {
  artilheiroId: string;
  onChangeArtilheiro: (id: string) => void;
  selMap: Record<string, Selecao>;
  jogadores: { id: string; nome: string; selecao_id: string }[];
  selecoesList: Selecao[];
}) {
  const jogadorSel = jogadores.find((j) => j.id === artilheiroId);
  const [selFiltroId, setSelFiltroId] = useState(jogadorSel?.selecao_id ?? "");

  useEffect(() => {
    if (jogadorSel) setSelFiltroId(jogadorSel.selecao_id);
  }, [jogadorSel]);

  const jogadoresDaSel = useMemo(
    () =>
      selFiltroId
        ? jogadores
            .filter((j) => j.selecao_id === selFiltroId)
            .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        : [],
    [jogadores, selFiltroId],
  );

  const selFiltro = selMap[selFiltroId];
  const [openJog, setOpenJog] = useState(false);
  const [buscaJog, setBuscaJog] = useState("");
  const jogFiltrados = buscaJog
    ? jogadoresDaSel.filter((j) => j.nome.toLowerCase().includes(buscaJog.toLowerCase()))
    : jogadoresDaSel;

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <AdminSelecaoDropdown
          value={selFiltroId}
          onChange={(id) => {
            setSelFiltroId(id);
            onChangeArtilheiro("");
          }}
          selecoes={selecoesList}
          placeholder="Seleção..."
        />
      </div>
      <div className="flex-1">
        <Popover open={openJog} onOpenChange={setOpenJog}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!selFiltroId}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-input/40 px-2 text-sm text-left hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40"
            >
              {jogadorSel ? (
                <>
                  {selFiltro && (
                    <Flag codigo={selFiltro.codigo} bandeira={selFiltro.bandeira} size={14} />
                  )}
                  <span className="flex-1 truncate">{jogadorSel.nome}</span>
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

// Dispara a sincronização automática de resultados (Edge Function "sync-resultados"
// via RPC admin_disparar_sync). A função roda sozinha a cada ~30 min pelo cron;
// este botão serve para forçar uma sincronização sob demanda / testar.
function SincronizarResultados() {
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function sincronizar() {
    setErro(null);
    setMsg(null);
    setRodando(true);
    try {
      const { error } = await supabase.rpc("admin_disparar_sync");
      if (error) throw error;
      // A Edge Function processa de forma assíncrona; o resultado aparece nas
      // partidas em alguns segundos. Recarregue para ver os placares.
      setMsg("Sincronização disparada. Os placares aparecem em instantes — recarregue a lista.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao sincronizar");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Sincronizar resultados (FIFA)</p>
          <p className="text-xs text-muted-foreground">
            Preenche placares dos jogos encerrados automaticamente. Roda sozinho a cada 30 min.
          </p>
        </div>
        <button
          onClick={sincronizar}
          disabled={rodando}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {rodando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {rodando ? "Sincronizando" : "Sincronizar agora"}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-accent">{msg}</p>}
      {erro && <p className="mt-2 text-xs text-destructive">{erro}</p>}
    </div>
  );
}

function ResultadoExtrasAdmin({ selecoes }: { selecoes: Selecao[] }) {
  type Jogador = { id: string; nome: string; selecao_id: string };
  const [jogadores, setJogadores] = useState<Jogador[]>([]);
  const [artilheiroId, setArtilheiroId] = useState("");
  const [campeaoId, setCampeaoId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const selMap = useMemo(() => {
    const m: Record<string, Selecao> = {};
    selecoes.forEach((s) => (m[s.id] = s));
    return m;
  }, [selecoes]);

  useEffect(() => {
    if (!aberto || jogadores.length > 0) return;
    supabase
      .from("jogadores")
      .select("id,nome,selecao_id")
      .order("nome")
      .then(({ data }) => {
        setJogadores((data ?? []) as Jogador[]);
      });
  }, [aberto, jogadores.length]);

  async function calcular() {
    if (!artilheiroId || !campeaoId) {
      setErro("Selecione artilheiro e seleção campeã.");
      return;
    }
    setErro(null);
    setSaving(true);
    try {
      const { error } = await supabase.rpc("calcular_pontos_extras", {
        _artilheiro_real_id: artilheiroId,
        _campeao_real_id: campeaoId,
      });
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao calcular");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
      >
        <span>Palpites Especiais — Resultado Real</span>
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? "rotate-90" : "-rotate-90"}`}
        />
      </button>
      {aberto && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Defina o artilheiro real e a seleção campeã. Ao salvar, os pontos de todos os palpites
            especiais são recalculados (15 pts cada).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Artilheiro real</label>
              <AdminJogadorDropdown
                artilheiroId={artilheiroId}
                onChangeArtilheiro={setArtilheiroId}
                selMap={selMap}
                jogadores={jogadores}
                selecoesList={selecoes}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Seleção campeã real</label>
              <AdminSelecaoDropdown
                value={campeaoId}
                onChange={setCampeaoId}
                selecoes={selecoes}
                placeholder="— Escolha uma seleção —"
              />
            </div>
          </div>
          {erro && <p className="text-xs text-destructive">{erro}</p>}
          <button
            onClick={calcular}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? "Calculando..." : saved ? "Pontos calculados!" : "Salvar e calcular pontos"}
          </button>
        </div>
      )}
    </div>
  );
}

function PartidaAdminRow({
  partida,
  mandante,
  visitante,
  selecoes,
  onUpdated,
  onReload,
}: {
  partida: Partida;
  mandante?: Selecao;
  visitante?: Selecao;
  selecoes: Selecao[];
  onUpdated: (p: Partida) => void;
  onReload: () => void;
}) {
  const [gm, setGm] = useState<string>(
    partida.gols_mandante != null ? String(partida.gols_mandante) : "",
  );
  const [gv, setGv] = useState<string>(
    partida.gols_visitante != null ? String(partida.gols_visitante) : "",
  );
  // Pênaltis (só relevantes em empate de mata-mata).
  const [pm, setPm] = useState<string>(
    partida.penaltis_mandante != null ? String(partida.penaltis_mandante) : "",
  );
  const [pv, setPv] = useState<string>(
    partida.penaltis_visitante != null ? String(partida.penaltis_visitante) : "",
  );
  const [status, setStatus] = useState<Partida["status"]>(partida.status);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Edição dos dados da partida (times/fase/grupo/data/estádio) e exclusão.
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<FormState>({
    fase: partida.fase,
    grupo: partida.grupo ?? "",
    mandante: mandante?.codigo ?? "",
    visitante: visitante?.codigo ?? "",
    dataHora: isoParaLocalInput(partida.data_hora),
    estadio: partida.estadio ?? "",
  });

  async function salvarEdicao() {
    setErro(null);
    setSaving(true);
    const msg = await salvarPartida(form, partida.id);
    setSaving(false);
    if (msg) {
      setErro(msg);
      return;
    }
    setEditando(false);
    onReload();
  }

  async function excluir() {
    if (!confirm("Excluir esta partida? Os palpites associados serão removidos.")) return;
    setErro(null);
    setSaving(true);
    const { error } = await supabase.rpc("admin_delete_partida", { _partida_id: partida.id });
    setSaving(false);
    if (error) {
      setErro(error.message);
      return;
    }
    onReload();
  }

  async function salvar() {
    setErro(null);
    setSaving(true);
    try {
      const nm = gm === "" ? null : parseInt(gm, 10);
      const nv = gv === "" ? null : parseInt(gv, 10);
      if (status === "finalizada" && (nm == null || nv == null)) {
        throw new Error("Informe o placar para finalizar.");
      }
      // Pênaltis só valem em empate de mata-mata; fora disso grava null.
      const empateMataMata = partida.fase !== "grupos" && nm != null && nm === nv;
      const npm = empateMataMata && pm !== "" ? parseInt(pm, 10) : null;
      const npv = empateMataMata && pv !== "" ? parseInt(pv, 10) : null;
      if (empateMataMata && (npm != null) !== (npv != null)) {
        throw new Error("Informe os pênaltis dos dois lados (ou nenhum).");
      }
      if (npm != null && npm === npv) {
        throw new Error("A disputa de pênaltis não pode terminar empatada.");
      }
      const { data, error } = await supabase
        .from("partidas")
        .update({
          gols_mandante: nm,
          gols_visitante: nv,
          penaltis_mandante: npm,
          penaltis_visitante: npv,
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
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <li className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {FASE_LABEL_CURTO[partida.fase] ?? partida.fase}
          {partida.grupo ? ` · Grupo ${partida.grupo}` : ""} · {data}
        </span>
        <div className="flex items-center gap-2">
          {(() => {
            const sr = statusReal(partida);
            return (
              <span
                className={`rounded-full px-2 py-0.5 font-semibold ${
                  sr === "finalizada"
                    ? "bg-accent/20 text-accent"
                    : sr === "em_andamento"
                      ? "bg-primary/20 text-primary"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {STATUS_LABEL[sr]}
              </span>
            );
          })()}
          <button
            onClick={() => setEditando((v) => !v)}
            disabled={saving}
            title="Editar dados da partida"
            className="rounded p-1 hover:bg-secondary/60 disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={excluir}
            disabled={saving}
            title="Excluir partida"
            className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editando && (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-background/40 p-3">
          <div className="text-xs font-semibold text-muted-foreground">Editar dados da partida</div>
          <CamposPartida form={form} setForm={setForm} selecoes={selecoes} />
          <div className="flex items-center gap-2">
            <button
              onClick={salvarEdicao}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Salvar alterações
            </button>
            <button
              onClick={() => setEditando(false)}
              disabled={saving}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary/60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center justify-end gap-2 text-right">
          <span className="font-medium truncate">{mandante?.nome ?? "—"}</span>
          <Flag codigo={mandante?.codigo} bandeira={mandante?.bandeira} size={18} />
        </div>
        <div className="flex items-center gap-2">
          <ScoreInput value={gm} onChange={setGm} disabled={saving} />
          <span className="text-muted-foreground">×</span>
          <ScoreInput value={gv} onChange={setGv} disabled={saving} />
        </div>
        <div className="flex items-center gap-2">
          <Flag codigo={visitante?.codigo} bandeira={visitante?.bandeira} size={18} />
          <span className="font-medium truncate">{visitante?.nome ?? "—"}</span>
        </div>
      </div>
      {partida.fase !== "grupos" && gm !== "" && gv !== "" && parseInt(gm, 10) === parseInt(gv, 10) && (
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="text-right text-[11px] text-muted-foreground">Pênaltis</span>
          <div className="flex items-center gap-2">
            <ScoreInput value={pm} onChange={setPm} disabled={saving} />
            <span className="text-muted-foreground">×</span>
            <ScoreInput value={pv} onChange={setPv} disabled={saving} />
          </div>
          <span />
        </div>
      )}
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
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <Check className="h-3.5 w-3.5" />
          ) : null}
          {saving ? "Salvando" : saved ? "Salvo" : "Salvar e recalcular"}
        </button>
      </div>
      {erro && <div className="mt-2 text-xs text-destructive">{erro}</div>}
    </li>
  );
}

// Converte um ISO (UTC) para o formato aceito por <input type="datetime-local">
// no fuso local do navegador.
function isoParaLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

// Campos compartilhados entre criar e editar. Controlado pelo pai.
type FormState = {
  fase: string;
  grupo: string;
  mandante: string;
  visitante: string;
  dataHora: string;
  estadio: string;
  // Slot do chaveamento (M73…M104) quando a partida é criada a partir do bracket.
  // Vincula a partida ao card certo, independente do horário. Vazio fora do mata-mata.
  slot?: string;
};

function CamposPartida({
  form,
  setForm,
  selecoes,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  selecoes: Selecao[];
}) {
  const up = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium">
        Fase
        <select
          value={form.fase}
          onChange={(e) => up({ fase: e.target.value })}
          className="mt-1 h-9 w-full rounded-md border border-border bg-input/40 px-2 text-sm"
        >
          {FASES_TODAS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium">
        Grupo {form.fase === "grupos" ? "(A–L)" : "(deixe vazio no mata-mata)"}
        <input
          type="text"
          value={form.grupo}
          maxLength={2}
          onChange={(e) => up({ grupo: e.target.value.toUpperCase() })}
          placeholder={form.fase === "grupos" ? "Ex.: A" : "—"}
          className="mt-1 h-9 w-full rounded-md border border-border bg-input/40 px-2 text-sm uppercase"
        />
      </label>
      <label className="text-xs font-medium">
        Mandante
        <SelecaoSelect
          value={form.mandante}
          onChange={(v) => up({ mandante: v })}
          selecoes={selecoes}
        />
      </label>
      <label className="text-xs font-medium">
        Visitante
        <SelecaoSelect
          value={form.visitante}
          onChange={(v) => up({ visitante: v })}
          selecoes={selecoes}
        />
      </label>
      <label className="text-xs font-medium">
        Data e hora (seu horário local)
        <input
          type="datetime-local"
          value={form.dataHora}
          onChange={(e) => up({ dataHora: e.target.value })}
          className="mt-1 h-9 w-full rounded-md border border-border bg-input/40 px-2 text-sm"
        />
      </label>
      <label className="text-xs font-medium">
        Estádio / sede (opcional)
        <input
          type="text"
          value={form.estadio}
          onChange={(e) => up({ estadio: e.target.value })}
          placeholder="Ex.: MetLife Stadium, East Rutherford"
          className="mt-1 h-9 w-full rounded-md border border-border bg-input/40 px-2 text-sm"
        />
      </label>
    </div>
  );
}

// Chama a RPC de upsert. Retorna mensagem de erro ou null em sucesso.
async function salvarPartida(form: FormState, partidaId?: string): Promise<string | null> {
  if (!form.mandante || !form.visitante) return "Escolha as duas seleções.";
  if (form.mandante === form.visitante) return "Mandante e visitante não podem ser iguais.";
  if (form.fase === "grupos" && !form.grupo.trim()) return "Informe o grupo (A–L).";
  const { error } = await supabase.rpc("admin_upsert_partida", {
    _fase: form.fase,
    _grupo: form.fase === "grupos" ? form.grupo.trim() : null,
    _mandante_codigo: form.mandante,
    _visitante_codigo: form.visitante,
    _data_hora: form.dataHora ? new Date(form.dataHora).toISOString() : null,
    _estadio: form.estadio || null,
    _partida_id: partidaId ?? null,
    _bracket_slot: form.slot || null,
  });
  return error ? error.message : null;
}

const FORM_VAZIO: FormState = {
  fase: "oitavas",
  grupo: "",
  mandante: "",
  visitante: "",
  dataHora: "",
  estadio: "",
};

function CriarPartida({
  selecoes,
  onCriada,
  prefill,
}: {
  selecoes: Selecao[];
  onCriada: () => void;
  prefill?: { fase?: string; mandante?: string; visitante?: string; slot?: string };
}) {
  const [aberto, setAberto] = useState(!!prefill);
  const [form, setForm] = useState<FormState>(() =>
    prefill
      ? {
          ...FORM_VAZIO,
          fase: prefill.fase ?? FORM_VAZIO.fase,
          mandante: prefill.mandante ?? "",
          visitante: prefill.visitante ?? "",
          slot: prefill.slot,
        }
      : FORM_VAZIO,
  );
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function criar() {
    setErro(null);
    setSaving(true);
    const msg = await salvarPartida(form);
    setSaving(false);
    if (msg) {
      setErro(msg);
      return;
    }
    setOk(true);
    setForm(FORM_VAZIO);
    onCriada();
    setTimeout(() => setOk(false), 1500);
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-primary" /> Criar partida
        </span>
        <span className="text-xs text-muted-foreground">{aberto ? "fechar" : "abrir"}</span>
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          <p className="text-xs text-muted-foreground">
            Cadastre uma partida de qualquer fase. No mata-mata deixe o grupo vazio. Os palpites
            abrem automaticamente e fecham no horário do jogo.
          </p>
          <CamposPartida form={form} setForm={setForm} selecoes={selecoes} />
          {erro && <div className="text-xs text-destructive">{erro}</div>}
          <button
            onClick={criar}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : ok ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            {saving ? "Criando" : ok ? "Criada" : "Criar partida"}
          </button>
        </div>
      )}
    </div>
  );
}

function SelecaoSelect({
  value,
  onChange,
  selecoes,
}: {
  value: string;
  onChange: (v: string) => void;
  selecoes: Selecao[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 h-9 w-full rounded-md border border-border bg-input/40 px-2 text-sm"
    >
      <option value="">— selecione —</option>
      {selecoes.map((s) => (
        <option key={s.id} value={s.codigo}>
          {s.bandeira ? `${s.bandeira} ` : ""}
          {s.nome}
        </option>
      ))}
    </select>
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
