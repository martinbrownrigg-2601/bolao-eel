import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — BolãoEEL" },
      { name: "description", content: "Entre ou crie sua conta no BolãoEEL." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const { redirect } = Route.useSearch();
  const destino = redirect && redirect.startsWith("/") ? redirect : "/";

  function irParaApp() {
    router.navigate({ to: destino, replace: true });
  }

  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) irParaApp();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviado(false);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { data: { nome_usuario: nomeUsuario } },
        });
        if (error) throw error;
        if (!data.session) {
          const { error: e2 } = await supabase.auth.signInWithPassword({
            email,
            password: senha,
          });
          if (e2) throw e2;
        }
        irParaApp();
      } else if (mode === "forgot") {
        const redirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}/reset-password`
            : "/reset-password";
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) throw error;
        setEnviado(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: senha,
        });
        if (error) throw error;
        irParaApp();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setErro(traduzirErro(msg));
    } finally {
      setLoading(false);
    }
  }

  const titulo =
    mode === "login"
      ? "Entrar"
      : mode === "signup"
        ? "Criar conta"
        : "Recuperar senha";

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-primary/5">
          <h1 className="text-2xl font-bold">{titulo}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O bolão oficial do Luka Doncic Fan Club.
          </p>

          {enviado && mode === "forgot" && (
            <div className="mt-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success-foreground">
              Enviamos um link de recuperação para{" "}
              <span className="font-medium">{email}</span>. Verifique sua
              caixa de entrada (e spam).
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <Field label="Nome de usuário">
                <input
                  required
                  minLength={3}
                  value={nomeUsuario}
                  onChange={(e) => setNomeUsuario(e.target.value)}
                  className={inputCls}
                  placeholder="luka77"
                />
              </Field>
            )}
            <Field label="E-mail">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="voce@exemplo.com"
              />
            </Field>
            {mode !== "forgot" && (
              <Field label="Senha">
                <input
                  required
                  minLength={6}
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </Field>
            )}

            {erro && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading
                ? "Aguarde…"
                : mode === "forgot"
                  ? "Enviar link de recuperação"
                  : mode === "signup"
                    ? "Criar conta"
                    : "Entrar"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground space-y-2">
            {mode === "login" && (
              <>
                <div>
                  <button
                    className="font-medium text-accent hover:underline"
                    onClick={() => {
                      setMode("forgot");
                      setErro(null);
                      setEnviado(false);
                    }}
                  >
                    Esqueci minha senha
                  </button>
                </div>
                <div>
                  Não tem conta?{" "}
                  <button
                    className="font-medium text-accent hover:underline"
                    onClick={() => {
                      setMode("signup");
                      setErro(null);
                      setEnviado(false);
                    }}
                  >
                    Cadastre-se
                  </button>
                </div>
              </>
            )}
            {mode === "signup" && (
              <div>
                Já tem conta?{" "}
                <button
                  className="font-medium text-accent hover:underline"
                  onClick={() => {
                    setMode("login");
                    setErro(null);
                    setEnviado(false);
                  }}
                >
                  Entrar
                </button>
              </div>
            )}
            {mode === "forgot" && (
              <div>
                Lembrou a senha?{" "}
                <button
                  className="font-medium text-accent hover:underline"
                  onClick={() => {
                    setMode("login");
                    setErro(null);
                    setEnviado(false);
                  }}
                >
                  Entrar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-input/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function traduzirErro(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(msg)) return "Este e-mail já está cadastrado.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar.";
  if (/password.*6/i.test(msg)) return "A senha deve ter pelo menos 6 caracteres.";
  if (/for security reasons, you can only request this after/i.test(msg))
    return "Aguarde alguns segundos antes de solicitar novamente.";
  if (/email rate limit exceeded/i.test(msg))
    return "Muitas tentativas. Tente novamente mais tarde.";
  return msg;
}
