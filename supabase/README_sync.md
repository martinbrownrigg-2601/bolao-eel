# Sincronização automática de resultados (FIFA 2026)

Preenche o placar/status das partidas automaticamente a partir da API pública da
FIFA, sem remover o preenchimento manual do admin (que segue como fallback). A
pontuação não muda: reaproveita a RPC `calcular_pontos_partida`.

## Componentes

| Peça | Arquivo | O quê |
|---|---|---|
| Migração SQL | `db/migration_sync_resultados.sql` | colunas de mapeamento + RPCs `sync_resultado_partida` e `admin_disparar_sync` |
| Edge Function | `supabase/functions/sync-resultados/index.ts` | busca jogos encerrados na FIFA e grava cada um via RPC |
| Script de seed | `scripts/seed_fifa_team_ids.mjs` | gera o `UPDATE` que mapeia os 48 times (FIFA `Abbreviation` → `codigo`) |
| Botão admin | `src/routes/_authenticated/admin.tsx` (`SincronizarResultados`) | dispara a sync sob demanda |

## Passo a passo (ordem de execução)

### 1. Descobrir o `idSeason` da Copa 2026
A API: `https://api.fifa.com/api/v3/calendar/matches?idSeason=<ID>&count=5&language=en`.
Sonde até achar a temporada com os jogos de jun/jul 2026 (ex.: confira datas e times
retornados). Guarde o número como `FIFA_ID_SEASON`.

> A API da FIFA é **não-documentada** (interna do site). Funciona e é grátis, mas pode
> mudar de formato sem aviso — por isso o `idSeason` fica em variável, não no código.

### 2. Aplicar a migração
No **SQL Editor** do Supabase, rode `db/migration_sync_resultados.sql` (idempotente).

### 3. Mapear os 48 times
```bash
# usa EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_ANON_KEY do .env
FIFA_ID_SEASON=<id> node scripts/seed_fifa_team_ids.mjs
```
Revise no stderr os times que **não** casaram (ex.: diferenças de sigla como KOR/COR),
ajuste manualmente se preciso, e cole o bloco `UPDATE` (stdout) na seção 4 da migração —
depois rode esse `UPDATE` no SQL Editor. Verifique:
```sql
select codigo from public.selecoes where fifa_team_id is null;  -- deve ficar vazio
```

### 4. Subir a Edge Function
```bash
supabase init                       # só na primeira vez (cria a pasta supabase/)
supabase link --project-ref mzklpojuftvmvjbjliom
supabase functions deploy sync-resultados
```

### 5. Configurar os secrets (NUNCA commitar)
```bash
supabase secrets set FIFA_ID_SEASON=<id>
supabase secrets set SYNC_SHARED_SECRET=<gere-um-segredo-forte>
```
> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente pela
> plataforma — **não** os defina e **não** coloque a service-role key em `.env` nem no frontend.

### 6. Apontar a RPC do botão para a função (GUCs do banco)
No SQL Editor, com a **mesma** URL/segredo da função:
```sql
alter database postgres set app.sync_url    = 'https://mzklpojuftvmvjbjliom.functions.supabase.co/sync-resultados';
alter database postgres set app.sync_secret = '<mesmo SYNC_SHARED_SECRET>';
```
(reconecte a sessão para os GUCs valerem)

### 7. Agendar (a cada 30 min) — pg_cron + pg_net (grátis)
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('sync-resultados-30min', '*/30 * * * *', $$
  select net.http_post(
    url := 'https://mzklpojuftvmvjbjliom.functions.supabase.co/sync-resultados',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','<mesmo segredo>'),
    body := '{}'::jsonb);
$$);
-- remover:  select cron.unschedule('sync-resultados-30min');
```

## Como testar (end-to-end)

1. **RPC isolada** — no SQL Editor, com dados de um jogo já encerrado conhecido:
   ```sql
   select public.sync_resultado_partida('<fifa_match_id>','<home_fifa_id>','<away_fifa_id>',2,1);
   ```
   Confirme que a partida virou `finalizada` com o placar na **orientação certa**
   (mandante/visitante) e que `palpites.pontos_ganhos` foi recalculado.
2. **Edge Function** — chame com o header de segredo e veja o resumo JSON
   (`updated`/`skipped`/`no_partida`/`unmapped_team`).
3. **Botão admin** — clique "Sincronizar agora"; em segundos os jogos encerrados aparecem
   finalizados na lista, sem digitação.
4. **Cron** — após a 1ª execução agendada, confira `select * from cron.job_run_details order by start_time desc limit 5;`.
5. **Idempotência** — rode 2x; a 2ª só retorna `skipped`, sem mexer em pontos.

## Notas / limites

- **Mata-mata**: enquanto os times de uma fase não forem cadastrados em `partidas`, os
  jogos correspondentes retornam `no_partida` e são ignorados; assim que você criar a
  partida (fluxo manual de sempre), a próxima sync preenche.
- **Fallback**: o preenchimento manual por partida continua funcionando normalmente.

---

# Placar ao vivo (referência visual)

Mostra o placar PARCIAL dos jogos em andamento, **sem afetar a pontuação**. Os pontos
continuam vindo só de `partidas`/`calcular_pontos_partida` (sync-resultados). O ao vivo
vive numa tabela isolada e é lido apenas pela UI.

## Componentes

| Peça | Arquivo | O quê |
|---|---|---|
| Migração SQL | `db/migration_placar_ao_vivo.sql` | tabela `placares_ao_vivo` + RPC `upsert_placar_ao_vivo` (service_role) |
| Edge Function | `supabase/functions/sync-ao-vivo/index.ts` | busca jogos ao vivo na FIFA e atualiza a tabela; sai cedo se não houver jogo |
| UI | `palpites.grupos.tsx`, `palpites.comparar.$id.tsx` | selo "AO VIVO x–y · min'" com polling de 45s |

## Passos (depois da sync-resultados já configurada)

1. **Migração**: rode `db/migration_placar_ao_vivo.sql` no SQL Editor.
2. **Deploy**: `supabase functions deploy sync-ao-vivo` (o `config.toml` já marca `verify_jwt=false`).
   Reusa os secrets `FIFA_ID_SEASON` / `SYNC_SHARED_SECRET` — nada novo a setar.
3. **Cron de 1 min** (SQL Editor) — a função aborta sozinha quando não há jogo ao vivo,
   então o custo é desprezível:
   ```sql
   select cron.schedule('sync-ao-vivo-1min', '* * * * *', $$
     select net.http_post(
       url := 'https://mzklpojuftvmvjbjliom.functions.supabase.co/sync-ao-vivo',
       headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','<mesmo segredo>'),
       body := '{}'::jsonb);
   $$);
   -- remover:  select cron.unschedule('sync-ao-vivo-1min');
   ```

## Como testar

Durante um jogo real (ou ajuste manual de teste):
```sql
-- simula um jogo ao vivo sem mexer em partidas:
select public.upsert_placar_ao_vivo(
  '<fifa_match_id>','<home_fifa_id>','<away_fifa_id>', 1, 0, '67''', true);
select * from public.placares_ao_vivo where ao_vivo;
```
Abra a lista de palpites / comparar palpites: o selo "AO VIVO 1–0 · 67'" aparece e some
quando `ao_vivo` vira false. Confirme que `palpites.pontos_ganhos` NÃO mudou.

## Garantia de isolamento

`upsert_placar_ao_vivo` só escreve em `placares_ao_vivo` — nunca em `partidas`, nunca chama
`calcular_pontos_partida`. Não há trigger. Logo, o ao vivo é puramente informativo.
