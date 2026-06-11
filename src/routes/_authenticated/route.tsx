import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { AppShell } from "@/components/AppShell";
import { BolaoProvider } from "@/contexts/BolaoContext";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
  },
  component: () => (
    <BolaoProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </BolaoProvider>
  ),
});
