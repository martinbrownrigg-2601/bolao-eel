import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { mensagemErro } from "@/lib/utils";
import { Loader2, Plus, Users, LogIn } from "lucide-react";

export const Route = createFileRoute("/_authenticated/boloes/")({
  head: () => ({
    meta: [
      { title: "Bolões — BolãoEEL" },
      { name: "description", content: "Crie ou entre em um bolão com seus amigos." },
    ],
  }),
  component: BoloesIndex,
});

type Bolao = {
  id: string;
  nome: string;
  descricao: string | null;
  codigo_convite: string;
  is_publico: boolean;
  criador_id: string;
};

function BoloesIndex() {
  const router = useRouter();
  const [boloes, setBoloes] = useState<Bolao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // criar
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [publico, setPublico] = useState(false);
  const [criando, setCriando] = useState(false);

  // entrar
  const [codigo, setCodigo] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function carregar() {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    const { data: mb } = await supabase
      .from("membros_bolao").select("bolao_id").eq("usuario_id", u.user.id);
    const ids = (mb ?? []).map((m: { bolao_id: string }) => m.bolao_id);
    if (ids.length === 0) {
      setBoloes([]);
      setLoading(false);
      return;
    }
    const { data: bs } = await supabase
      .from("boloes")
      .select("id,nome,descricao,codigo_convite,is_publico,criador_id")
      .in("id", ids)
      .order("criado_em", { ascending: false });
    setBoloes((bs ?? []) as Bolao[]);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!nome.trim()) return;
    setCriando(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("boloes")
        .insert({
          nome: nome.trim(),
          descricao: descricao.trim() || null,
          is_publico: publico,
          criador_id: u.user.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      router.navigate({ to: "/boloes/$id", params: { id: data.id } });
    } catch (e: unknown) {
      if (e && typeof e === "object" && "message" in e) {
        setErro((e as { message: string }).message);
      } else if (e instanceof Error) {
        setErro(e.message);
      } else {
        setErro("Erro ao criar bolão");
      }
    } finally {
      setCriando(false);
    }
  }

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!codigo.trim()) return;
    setEntrando(true);
    try {
      const { data, error } = await supabase.rpc("entrar_bolao_por_codigo", {
        _codigo: codigo.trim(),
      });
      if (error) throw error;
      router.navigate({ to: "/boloes/$id", params: { id: data as string } });
    } catch (e) {
      setErro(mensagemErro(e, "Erro ao entrar"));
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Bolões</h1>
        <p className="mt-1 text-muted-foreground">
          Crie um bolão privado para jogar com a galera ou entre em um existente pelo código.
        </p>
      </header>

      {erro && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={criar} className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <Plus className="h-4 w-4 text-primary" /> Criar bolão
          </div>
          <input
            value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do bolão" required maxLength={60}
            className="h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm outline-none focus:border-primary"
          />
          <textarea
            value={descricao} onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)" maxLength={200} rows={2}
            className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={publico} onChange={(e) => setPublico(e.target.checked)} />
            Bolão público (qualquer um pode encontrar)
          </label>
          <button
            disabled={criando}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Criar
          </button>
        </form>

        <form onSubmit={entrar} className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <LogIn className="h-4 w-4 text-accent" /> Entrar em bolão
          </div>
          <input
            value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="Código de convite (ex.: A1B2C3)" maxLength={12}
            className="h-9 w-full rounded-md border border-border bg-input/40 px-3 text-sm uppercase tracking-widest outline-none focus:border-primary"
          />
          <button
            disabled={entrando}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {entrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Entrar
          </button>
        </form>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Meus bolões
        </h2>
        {loading ? (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : boloes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            Você ainda não participa de nenhum bolão. Crie um ou entre com um código.
          </div>
        ) : (
          <ul className="grid gap-2">
            {boloes.map((b) => (
              <li key={b.id}>
                <Link
                  to="/boloes/$id" params={{ id: b.id }}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60"
                >
                  <div>
                    <div className="font-semibold">{b.nome}</div>
                    {b.descricao && <div className="text-xs text-muted-foreground">{b.descricao}</div>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {b.is_publico && <span className="rounded bg-secondary/60 px-2 py-0.5">público</span>}
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {b.codigo_convite}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
