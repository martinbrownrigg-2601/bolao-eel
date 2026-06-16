// =====================================================================
// scripts/seed_fifa_team_ids.mjs   (one-time, descartável)
//
// Gera o bloco UPDATE que preenche selecoes.fifa_team_id, casando a
// abreviação de 3 letras da FIFA (campo "Abbreviation") com selecoes.codigo.
//
// Como usar:
//   1. Descubra o idSeason da Copa 2026 (veja README_sync.md) e exporte:
//        FIFA_ID_SEASON=<id>
//   2. Garanta as variáveis do Supabase (já no .env do projeto):
//        EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_ANON_KEY
//   3. node scripts/seed_fifa_team_ids.mjs
//
// Saída:
//   * imprime no stderr os times da FIFA que NÃO casaram com nenhum codigo
//     (revise manualmente: pode ser diferença de sigla, ex. KOR/COR);
//   * imprime no stdout o bloco SQL pronto para colar em
//     db/migration_sync_resultados.sql.
//
// Observação: a API da FIFA é não-documentada; se o formato mudar, ajuste
// os caminhos de campo abaixo (Results / Home / Away / Abbreviation / IdTeam).
// =====================================================================
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.EXTERNAL_SUPABASE_URL;
const SB_KEY = process.env.EXTERNAL_SUPABASE_ANON_KEY;
const ID_SEASON = process.env.FIFA_ID_SEASON;

if (!SB_URL || !SB_KEY) {
  console.error("Faltam EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_ANON_KEY (use o .env).");
  process.exit(1);
}
if (!ID_SEASON) {
  console.error("Defina FIFA_ID_SEASON (idSeason da Copa 2026).");
  process.exit(1);
}

// 1. Lê os códigos das seleções já cadastradas.
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const { data: selecoes, error } = await sb.from("selecoes").select("codigo,nome");
if (error) {
  console.error("Erro ao ler selecoes:", error.message);
  process.exit(1);
}
const codigos = new Set(selecoes.map((s) => s.codigo.toUpperCase()));

// 2. Busca os jogos da temporada na FIFA e coleta { Abbreviation -> IdTeam }.
const url =
  `https://api.fifa.com/api/v3/calendar/matches?idSeason=${ID_SEASON}` +
  `&count=200&language=en`;
const res = await fetch(url, { headers: { accept: "application/json" } });
if (!res.ok) {
  console.error("Falha ao buscar FIFA:", res.status, await res.text());
  process.exit(1);
}
const payload = await res.json();
const jogos = payload.Results ?? [];

const fifaTimes = new Map(); // Abbreviation -> { idTeam, name }
for (const m of jogos) {
  for (const t of [m.Home, m.Away]) {
    if (!t?.Abbreviation || !t?.IdTeam) continue;
    const abbr = String(t.Abbreviation).toUpperCase();
    if (!fifaTimes.has(abbr)) {
      const name = Array.isArray(t.TeamName) ? t.TeamName[0]?.Description : t.TeamName;
      fifaTimes.set(abbr, { idTeam: String(t.IdTeam), name: name ?? abbr });
    }
  }
}

// 3. Casa por abreviação. Separa casados x não-casados.
const linhas = [];
const naoCasadosFifa = [];
for (const [abbr, info] of fifaTimes) {
  if (codigos.has(abbr)) linhas.push([abbr, info.idTeam]);
  else naoCasadosFifa.push({ abbr, ...info });
}
const codigosCasados = new Set(linhas.map((l) => l[0]));
const semFifa = [...codigos].filter((c) => !codigosCasados.has(c));

// 4. Relatório de revisão no stderr.
if (naoCasadosFifa.length) {
  console.error("\n⚠️  Times da FIFA sem código correspondente (revise manualmente):");
  for (const t of naoCasadosFifa) console.error(`   FIFA ${t.abbr} (${t.name}) id=${t.idTeam}`);
}
if (semFifa.length) {
  console.error("\n⚠️  Seleções nossas sem time FIFA casado:");
  console.error("   " + semFifa.join(", "));
}
console.error(
  `\n✔️  Casados automaticamente: ${linhas.length} de ${selecoes.length} seleções.\n`,
);

// 5. Emite o SQL no stdout.
linhas.sort((a, b) => a[0].localeCompare(b[0]));
const values = linhas.map(([cod, id]) => `  ('${cod}','${id}')`).join(",\n");
console.log(`-- Gerado por scripts/seed_fifa_team_ids.mjs (idSeason=${ID_SEASON})
update public.selecoes as s set fifa_team_id = v.fid
from (values
${values}
) as v(cod, fid)
where s.codigo = v.cod;`);
