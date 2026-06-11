# BolãoEEL

> O bolão oficial do **Luka Doncic Fan Club** — Copa do Mundo 2026.

## Setup do Supabase externo

1. No painel do seu projeto Supabase, abra **SQL Editor** e cole/execute o arquivo [`db/migration_inicial.sql`](./db/migration_inicial.sql). É idempotente (pode rodar mais de uma vez).
2. Em **Authentication → Providers**, garanta que **Email** está habilitado. Se quiser pular a confirmação por e-mail durante o desenvolvimento, desabilite **Confirm email**.
3. Para liberar o primeiro admin, rode no SQL Editor depois de cadastrar sua conta:
   ```sql
   update public.perfis set is_admin = true where nome_usuario = 'seu_usuario';
   ```

## Credenciais (já configuradas como secrets)

- `EXTERNAL_SUPABASE_URL`
- `EXTERNAL_SUPABASE_ANON_KEY`
- `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (servidor apenas)

O frontend recebe URL + anon key via `/api/public/sb-config.js`, que é injetado pelo SSR no `__root.tsx`.

## Estrutura

- `src/lib/supabase.ts` — cliente do navegador
- `src/routes/auth.tsx` — login / cadastro
- `src/routes/_authenticated/` — área logada (dashboard + palpites)
- `db/migration_inicial.sql` — schema completo em PT-BR
