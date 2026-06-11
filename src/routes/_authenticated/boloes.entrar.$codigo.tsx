import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/boloes/entrar/$codigo")({
  head: () => ({ meta: [{ title: "Entrar no bolão — BolãoEEL" }] }),
  component: EntrarBolao,
});

function EntrarBolao() {
  const { codigo } = Route.useParams();
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc("entrar_bolao_por_codigo", { _codigo: codigo });
        if (error) throw error;
        router.navigate({ to: "/boloes/$id", params: { id: data as string }, replace: true });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível entrar no bolão.");
      }
    })();
  }, [codigo, router]);

  if (erro) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
        {erro}
      </div>
    );
  }
  return (
    <div className="grid place-items-center py-20 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="mt-3 text-sm">Entrando no bolão…</p>
    </div>
  );
}
