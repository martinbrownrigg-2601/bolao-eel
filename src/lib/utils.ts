import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extrai uma mensagem legível de qualquer erro — em especial do
 * PostgrestError do supabase-js, que NÃO é instância de Error (é um objeto
 * comum com message/details/hint/code). Usar `e instanceof Error` engole
 * esses erros e mostra só um fallback genérico.
 */
export function mensagemErro(e: unknown, fallback = "Algo deu errado."): string {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.details, o.hint]
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (partes.length > 0) return partes.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return fallback;
}
