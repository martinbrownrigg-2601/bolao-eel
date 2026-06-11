import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sb-config.js")({
  server: {
    handlers: {
      GET: async () => {
        let url = (process.env.EXTERNAL_SUPABASE_URL ?? "").trim();
        // supabase-js precisa do domínio raiz, sem /rest/v1, /auth/v1 ou barra final
        url = url.replace(/\/(rest|auth|storage|realtime)\/v\d+\/?$/i, "");
        url = url.replace(/\/+$/, "");
        const anonKey = (process.env.EXTERNAL_SUPABASE_ANON_KEY ?? "").trim();
        const body = `window.__SB__=${JSON.stringify({ url, anonKey })};`;
        return new Response(body, {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=60",
          },
        });
      },
    },
  },
});
