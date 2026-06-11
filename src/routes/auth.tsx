import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/auth")({
  ssr: false,
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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/", replace: true });
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: {
            data: { nome_usuario: nomeUsuario },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setInfo("Conta criada! Verifique seu e-mail para confirmar (se exigido) e depois faça login.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        router.navigate({ to: "/", replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setErro(traduzirErro(msg));
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
          <h1 className="text-2xl font-bold">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O bolão oficial do Luka Doncic Fan Club.
          </p>

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

            {erro && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {erro}
              </div>
            )}
            {info && (
              <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Não tem conta?{" "}
                <button
                  className="font-medium text-accent hover:underline"
                  onClick={() => { setMode("signup"); setErro(null); setInfo(null); }}
                >
                  Cadastre-se
                </button>
              </>
            ) : (
              <>
                Já tem conta?{" "}
                <button
                  className="font-medium text-accent hover:underline"
                  onClick={() => { setMode("login"); setErro(null); setInfo(null); }}
                >
                  Entrar
                </button>
              </>
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
  return msg;
}
