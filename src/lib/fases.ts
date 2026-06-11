// Fases do torneio — fonte única usada em palpites e admin.
// A ordem aqui define a ordem de exibição/abas.

export const FASE_ORDEM = [
  "grupos",
  "trinta_e_dois_avos",
  "oitavas",
  "quartas",
  "semifinais",
  "disputa_terceiro",
  "final",
] as const;

export type Fase = (typeof FASE_ORDEM)[number];

// Rótulo longo (títulos/abas) e curto (chips/linhas compactas).
export const FASE_LABEL: Record<string, string> = {
  grupos: "Fase de grupos",
  trinta_e_dois_avos: "32 avos de final",
  oitavas: "Oitavas de final",
  quartas: "Quartas de final",
  semifinais: "Semifinais",
  disputa_terceiro: "Disputa de 3º lugar",
  final: "Final",
};

export const FASE_LABEL_CURTO: Record<string, string> = {
  grupos: "Grupos",
  trinta_e_dois_avos: "32 avos",
  oitavas: "Oitavas",
  quartas: "Quartas",
  semifinais: "Semis",
  disputa_terceiro: "3º lugar",
  final: "Final",
};

// Fases que o admin pode criar manualmente (todas exceto grupos).
export const FASES_MATA_MATA = FASE_ORDEM.filter((f) => f !== "grupos").map((value) => ({
  value,
  label: FASE_LABEL[value],
}));

// Todas as fases (inclui grupos) — para edição/criação livre no admin.
export const FASES_TODAS = FASE_ORDEM.map((value) => ({ value, label: FASE_LABEL[value] }));

export function ordenarFases(fases: string[]): string[] {
  return [...fases].sort((a, b) => FASE_ORDEM.indexOf(a as Fase) - FASE_ORDEM.indexOf(b as Fase));
}
