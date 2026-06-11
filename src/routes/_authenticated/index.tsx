import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Target, Trophy, Users, ListChecks } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Início — BolãoEEL" },
      { name: "description", content: "Seu painel no BolãoEEL." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [nome, setNome] = useState<string>("");
  const [stats, setStats] = useState({ palpites: 0, pontos: 0 });

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: perfil } = await supabase
        .from("perfis")
        .select("nome_usuario")
        .eq("id", u.user.id)
        .maybeSingle();
      setNome(perfil?.nome_usuario ?? u.user.email ?? "");

      const { data: palpites } = await supabase
        .from("palpites")
        .select("pontos_ganhos")
        .eq("usuario_id", u.user.id);
      const total = palpites?.length ?? 0;
      const pts = (palpites ?? []).reduce((s, p) => s + (p.pontos_ganhos ?? 0), 0);
      setStats({ palpites: total, pontos: pts });
    })();
  }, []);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">
          Olá{nome ? `, ${nome}` : ""} 👋
        </h1>
        <p className="mt-1 text-muted-foreground">
          O bolão oficial do Luka Doncic Fan Club. Hora de cravar os placares.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Stat label="Palpites enviados" value={stats.palpites} icon={ListChecks} />
        <Stat label="Pontos acumulados" value={stats.pontos} icon={Trophy} accent />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Action
          to="/palpites/grupos"
          icon={Target}
          title="Palpitar fase de grupos"
          desc="Crave os placares dos 48 jogos da primeira fase."
        />
        <Action
          to="/bolao"
          icon={Users}
          title="Entrar ou criar um bolão"
          desc="Dispute com os amigos do clube usando um código de convite."
        />
      </section>
    </div>
  );
}

function Stat({
  label, value, icon: Icon, accent,
}: { label: string; value: number; icon: React.ElementType; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`h-5 w-5 ${accent ? "text-accent" : "text-primary"}`} />
      </div>
      <div className={`mt-2 text-3xl font-bold ${accent ? "text-accent" : ""}`}>{value}</div>
    </div>
  );
}

function Action({
  to, icon: Icon, title, desc,
}: { to: string; icon: React.ElementType; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/60 hover:bg-card/80"
    >
      <Icon className="h-6 w-6 text-primary transition-transform group-hover:scale-110" />
      <div className="mt-3 font-semibold">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{desc}</div>
    </Link>
  );
}
