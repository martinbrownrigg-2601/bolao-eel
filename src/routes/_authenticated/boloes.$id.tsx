import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Copy, Check, Users, Trophy, ArrowLeft, LogOut, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/boloes/$id")({
  head: () => ({ meta: [{ title: "Bolão — BolãoEEL" }] }),
  component: BolaoDetalhe,
});

type Bolao = {
  id: string;
  nome: string;
  descricao: string | null;
  codigo_convite: string;
  is_publico: boolean;
  criador_id: string;
};
type Membro = { usuario_id: string; entrou_em: string };
type Perfil = { id: string; nome_usuario: string; nome_exibicao: string | null };
type Pont = { usuario_id: string; pontos_total: number; jogos_pontuados: number };

function BolaoDetalhe() {
  const { id } = Route.useParams();
  const router = useRouter();
  const [bolao, setBolao] = useState<Bolao | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [perfis, setPerfis] = useState<Record<string, Perfil>>({});
  const [ranking, setRanking] = useState<
    { uid: string; nome: string; pontos: number; jogos: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        setUid(u.user?.id ?? null);

        const { data: b, error: eb } = await supabase
          .from("boloes")
          .select("id,nome,descricao,codigo_convite,is_publico,criador_id")
          .eq("id", id)
          .single();
        if (eb) throw eb;
        setBolao(b as Bolao);

        const { data: ms } = await supabase
          .from("membros_bolao")
          .select("usuario_id,entrou_em")
          .eq("bolao_id", id);
        const ids = ((ms as Membro[]) ?? []).map((m) => m.usuario_id);

        if (ids.length > 0) {
          const [{ data: ps }, { data: pts }] = await Promise.all([
            supabase.from("perfis").select("id,nome_usuario,nome_exibicao").in("id", ids),
            supabase
              .from("v_pontuacao_usuario")
              .select("usuario_id,pontos_total,jogos_pontuados")
              .in("usuario_id", ids),
          ]);
          const pMap: Record<string, Perfil> = {};
          (ps ?? []).forEach((p) => (pMap[p.id] = p as Perfil));
          setPerfis(pMap);
          const ptMap: Record<string, Pont> = {};
          (pts ?? []).forEach((p) => (ptMap[(p as Pont).usuario_id] = p as Pont));
          const r = ids
            .map((uid) => ({
              uid,
              nome: pMap[uid]?.nome_exibicao || pMap[uid]?.nome_usuario || "—",
              pontos: ptMap[uid]?.pontos_total ?? 0,
              jogos: ptMap[uid]?.jogos_pontuados ?? 0,
            }))
            .sort((a, b) => b.pontos - a.pontos);
          setRanking(r);
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao carregar bolão");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function copiarLink() {
    if (!bolao) return;
    const url = `${window.location.origin}/boloes/entrar/${bolao.codigo_convite}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });
  }

  async function sairDoBolao() {
    if (!bolao || !uid) return;
    if (!confirm("Tem certeza que deseja sair deste bolão?")) return;
    setSaindo(true);
    setErro(null);
    try {
      const { error } = await supabase
        .from("membros_bolao")
        .delete()
        .eq("bolao_id", bolao.id)
        .eq("usuario_id", uid);
      if (error) throw error;
      router.navigate({ to: "/boloes" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao sair do bolão");
      setSaindo(false);
    }
  }

  async function excluirBolao() {
    if (!bolao) return;
    if (!confirm("Excluir o bolão para todos os membros? Esta ação não pode ser desfeita.")) return;
    setSaindo(true);
    setErro(null);
    try {
      const { error } = await supabase.from("boloes").delete().eq("id", bolao.id);
      if (error) throw error;
      router.navigate({ to: "/boloes" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir bolão");
      setSaindo(false);
    }
  }

  const ehCriador = !!bolao && bolao.criador_id === uid;

  if (loading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (erro || !bolao) {
    return (
      <div className="space-y-4">
        <Link
          to="/boloes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {erro ?? "Bolão não encontrado."}
        </div>
      </div>
    );
  }

  const linkConvite = `${typeof window !== "undefined" ? window.location.origin : ""}/boloes/entrar/${bolao.codigo_convite}`;

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/boloes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Bolões
        </Link>
        <h1 className="mt-2 text-3xl font-bold">{bolao.nome}</h1>
        {bolao.descricao && <p className="mt-1 text-muted-foreground">{bolao.descricao}</p>}
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" /> Convide a galera
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Compartilhe o código{" "}
          <span className="font-mono font-bold text-foreground">{bolao.codigo_convite}</span> ou o
          link abaixo.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={linkConvite}
            className="h-9 w-full flex-1 rounded-md border border-border bg-input/40 px-3 text-xs outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            onClick={copiarLink}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          <Trophy className="h-4 w-4" /> Ranking ({ranking.length}{" "}
          {ranking.length === 1 ? "membro" : "membros"})
        </h2>
        <ul className="grid gap-2">
          {ranking.map((r, i) => (
            <li
              key={r.uid}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-7 w-7 place-items-center rounded-md text-xs font-bold ${i === 0 ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground"}`}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium">{r.nome}</div>
                  <div className="text-xs text-muted-foreground">{r.jogos} jogo(s) pontuado(s)</div>
                </div>
              </div>
              <div className="text-lg font-bold text-primary">
                {r.pontos} <span className="text-xs font-normal text-muted-foreground">pts</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        {ehCriador ? (
          <>
            <div className="text-sm font-semibold">Excluir bolão</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Como criador, você não pode sair — mas pode excluir o bolão. Todos os membros serão
              removidos. Esta ação é permanente.
            </p>
            <button
              onClick={excluirBolao}
              disabled={saindo}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              {saindo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Excluir bolão
            </button>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold">Sair do bolão</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Você deixará de participar deste bolão. Pode voltar depois com o código de convite.
            </p>
            <button
              onClick={sairDoBolao}
              disabled={saindo}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              {saindo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              Sair do bolão
            </button>
          </>
        )}
      </section>
    </div>
  );
}
