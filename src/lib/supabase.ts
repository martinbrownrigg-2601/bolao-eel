import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  interface Window {
    __SB__?: { url: string; anonKey: string };
    __SB_CLIENT__?: SupabaseClient;
  }
}

function getConfig() {
  if (typeof window === "undefined") {
    return {
      url: process.env.EXTERNAL_SUPABASE_URL ?? "",
      anonKey: process.env.EXTERNAL_SUPABASE_ANON_KEY ?? "",
    };
  }
  return window.__SB__ ?? { url: "", anonKey: "" };
}

function build(): SupabaseClient {
  const { url, anonKey } = getConfig();
  return createClient(url || "https://placeholder.supabase.co", anonKey || "placeholder", {
    auth: {
      persistSession: typeof window !== "undefined",
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function getSupabase(): SupabaseClient {
  if (typeof window === "undefined") return build();
  if (!window.__SB_CLIENT__) window.__SB_CLIENT__ = build();
  return window.__SB_CLIENT__;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = getSupabase() as unknown as Record<string | symbol, unknown>;
    return c[prop];
  },
});
