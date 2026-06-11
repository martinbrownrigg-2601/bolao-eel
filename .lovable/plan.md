## Plano de continuação — BolãoEEL

Vou seguir em fases pequenas e verificáveis. Hoje atacamos as duas frentes pedidas: **bolões com convite** e **dados reais da Copa 2026**. As demais ficam preparadas no schema mas entram depois.

### Fase 1 — Bolões com link de convite (MVP funcional)

Schema (migration nova, idempotente, mantendo o que já existe):
- `boloes`: adicionar `codigo_convite text unique` (gerado por trigger, 8 chars), `descricao`, `is_publico bool default false`, `criado_por uuid` (já existe).
- `membros_bolao` (já existe): adicionar `papel` (`dono` | `membro`), `entrou_em`.
- RLS:
  - SELECT bolão: membro OU `is_publico = true` OU dono.
  - INSERT bolão: usuário autenticado vira `dono` automaticamente (trigger cria `membros_bolao`).
  - INSERT membros_bolao via RPC `entrar_bolao_por_codigo(codigo text)` (security definer) — evita expor a tabela.
- Function: `entrar_bolao_por_codigo` valida código, insere membro, retorna `bolao_id`.

Telas:
- `/_authenticated/boloes` — lista "Meus bolões" + botão **Criar bolão** + campo **Entrar com código**.
- `/_authenticated/boloes/$id` — detalhes: nome, descrição, membros, **link de convite** copiável (`/_authenticated/boloes/entrar/$codigo`), ranking dos membros (soma de `pontos_ganhos` em `palpites`).
- `/_authenticated/boloes/entrar/$codigo` — chama a RPC, redireciona para o bolão.
- Nav do `AppShell`: adicionar item **Bolões**.

### Fase 2 — Dados reais da Copa 2026

A FIFA ainda não oficializou todos os jogos da fase de grupos da Copa de 2026 (sorteio em dez/2025). Vou substituir o seed atual por dados oficiais já conhecidos:
- **48 seleções classificadas/projetadas** com bandeiras emoji, código FIFA e confederação.
- **Grupos A–L** com as 12 sedes e jogos confirmados pela FIFA (calendário 11/jun a 19/jul/2026, com cidade/estádio por jogo).
- Campos novos em `partidas`: `cidade`, `estadio`, `numero_jogo` (1..104).
- Seed gerado em SQL puro a partir de planilha que vou montar em script — todos os 72 jogos da fase de grupos + 32 jogos do mata-mata (placeholders de seleção quando depender de classificação).

Como a lista oficial dos confrontos depende do sorteio, vou marcar claramente no README que os pareamentos de grupo são editáveis pelo admin (próxima fase) e usar os **slots oficiais por sede/data/horário** já divulgados pela FIFA, com seleções placeholder (A1, A2, …) onde ainda não houver sorteio.

### Fase 3 (preparada, não construída ainda)
- Painel admin para lançar resultados (recalcula `pontos_ganhos` via trigger já existente).
- Ranking ao vivo via Realtime.
- Mata-mata com avanço automático.

### Detalhes técnicos
- Tudo em TanStack file routes sob `_authenticated/`.
- Sem server functions novas nessa fase — leituras/escritas vão direto pelo `supabase` browser client com RLS + RPC `entrar_bolao_por_codigo`.
- Migration entregue em `db/migration_boloes.sql` (segunda migration, idempotente). Você roda no SQL Editor.

### Pergunta antes de codar
1. Confirmo o uso de **placeholders A1/A2** nos jogos enquanto o sorteio oficial não sai? (alternativa: deixar só seleções classificadas e nenhum confronto — fica sem jogos para palpitar).
2. Bolões podem ser **públicos** (qualquer um entra sem código) ou só por convite? Plano atual: ambos, com flag.
