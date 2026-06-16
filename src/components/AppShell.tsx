import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";
import { supabase } from "@/lib/supabase";
import { LogOut, Home, Target, Users, Shield, Trophy, Eye, ChevronDown, Check, BarChart2 } from "lucide-react";
import { useBolao } from "@/contexts/BolaoContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const baseNav = [
  { to: "/" as const, label: "Início", icon: Home, exact: true },
  { to: "/palpites/grupos" as const, label: "Palpites", icon: Target, exact: false },
  { to: "/palpites/comparar" as const, label: "Comparar", icon: Eye, exact: false },
  { to: "/ranking" as const, label: "Ranking", icon: Trophy, exact: false },
  { to: "/tabela" as const, label: "Tabela", icon: BarChart2, exact: false },
  { to: "/boloes" as const, label: "Bolões", icon: Users, exact: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const { boloes, bolaoAtivo, setBolaoAtivo } = useBolao();

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("perfis")
        .select("is_admin")
        .eq("id", u.user.id)
        .maybeSingle();
      if (active) setIsAdmin(!!data?.is_admin);
    })();
    return () => {
      active = false;
    };
  }, []);

  const nav = isAdmin
    ? [...baseNav, { to: "/admin" as const, label: "Admin", icon: Shield, exact: false }]
    : baseNav;

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/">
            <BrandLogo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            {boloes.length > 1 && bolaoAtivo && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary max-w-[180px]">
                    <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{bolaoAtivo.nome}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Visualizando bolão
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {boloes.map((b) => (
                    <DropdownMenuItem
                      key={b.id}
                      onClick={() => setBolaoAtivo(b)}
                      className="flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="truncate">{b.nome}</span>
                      {b.id === bolaoAtivo.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {boloes.length === 1 && bolaoAtivo && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground max-w-[180px]">
                <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{bolaoAtivo.nome}</span>
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <LogOut className="h-3.5 w-3.5" /> Sair
            </button>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2">
          <ul className="flex gap-1">
            {nav.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground data-[status=active]:bg-primary/15 data-[status=active]:text-primary"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
