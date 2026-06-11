import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sb-config.js")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.EXTERNAL_SUPABASE_URL ?? "";
        const anonKey = process.env.EXTERNAL_SUPABASE_ANON_KEY ?? "";
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
