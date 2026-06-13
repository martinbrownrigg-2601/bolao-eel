import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha — BolãoEEL" },
      { name: "description", content: "Redefina sua senha no BolãoEEL." },
    ],
  }),
  component: ResetPasswordPage,
});

const inputCls =
  "w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

function ResetPasswordPage() {
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [linkInvalido, setLinkInvalido] = useState(false);
  const [temSessao, setTemSessao] = useState(false);

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (!hash.includes("type=recovery")) {
      setLinkInvalido(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setTemSessao(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) setTemSessao(true);
    });

    const timeout = setTimeout(() => {
      // Se depois de 5s não detectou sessão, assume link expirado/inválido
      setTemSessao((prev) => {
        if (!prev) setLinkInvalido(true);
        return prev;
      });
    }, 5000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senha.length < 6) {
      setErro("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      setOk(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setErro(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-primary/5">
          {linkInvalido && !temSessao ? (
            <>
              <h1 className="text-2xl font-bold">Link inválido</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                O link de recuperação expirou ou não é válido. Solicite um novo.
              </p>
              <div className="mt-6">
                <Link
                  to="/auth"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Voltar para o login
                </Link>
              </div>
            </>
          ) : ok ? (
            <>
              <h1 className="text-2xl font-bold">Senha redefinida!</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sua senha foi atualizada com sucesso. Agora você pode entrar com a nova senha.
              </p>
              <div className="mt-6">
                <Link
                  to="/auth"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Entrar
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Redefinir senha</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Digite sua nova senha abaixo.
              </p>

              {!temSessao && (
                <p className="mt-2 text-sm text-accent animate-pulse">
                  Verificando link de recuperação…
                </p>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Nova senha
                  </span>
                  <input
                    required
                    minLength={6}
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className={inputCls}
                    placeholder="••••••••"
                    disabled={!temSessao || loading}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Confirmar nova senha
                  </span>
                  <input
                    required
                    minLength={6}
                    type="password"
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    className={inputCls}
                    placeholder="••••••••"
                    disabled={!temSessao || loading}
                  />
                </label>

                {erro && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                    {erro}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!temSessao || loading}
                  className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "Salvando…" : "Salvar nova senha"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
