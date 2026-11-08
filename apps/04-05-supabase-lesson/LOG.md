# LOG — Гостевой бот ресторана

Журнал текущего незакрытого спринта. «Почему решили так». Растёт по ходу сессий.
Спринт закрыт → записи целиком → `docs/archive/log/<спринт>.md`, этот файл очищается.

Формат записи:

```
## [YYYY-MM-DD] — [краткое описание сессии]
**Цель:** …
**Решения:** …
**Осталось:** …
```

---

## 2026-11-08 — спека S08 (CI/CD)
**Цель:** написать спеку и план сессий S08: GitHub Actions, prod-окружение, учебные заметки по CI/CD.
**Решения:**
- Хостинг админки — Cloudflare Pages: настоящий CSP-заголовок через `_headers`, SPA-fallback. GitHub Pages отклонён: CSP только через `<meta>` (без `frame-ancestors`), хак с `404.html`.
- Интеграционные тесты в CI — `supabase start` в раннере GitHub (Docker, чистая БД на прогон, миграции с нуля). Общая dev-БД отклонена: секреты в CI, прогоны мешают ручным тестам.
- Отдельный prod-проект Supabase и второй бот; `main` деплоит в prod, dev остаётся для ручной работы.
- Оба пути в `main`: ветка → PR → merge и прямой push. PR запускает только проверки, деплой — только из `main`. Branch protection не включаем, иначе прямой push невозможен.
- Учебные заметки — `docs/guides/ci-cd/`, каждая пишется в сессии, где появляется её код.
- Вопросы §4 спеки решены (QA): секреты функций руками; деплой без подтверждения, но с `environment: production`; импорты бота переносятся в `deno.json` сейчас; `deno.lock` в git, CI с `--frozen`; prod на вымышленном seed; `paths` старому `ci.yml`; шаги `TESTER.md` — после S08; юниты админки только в `integration`; smoke после деплоя.
**Осталось:** сессия 1 — перенос импортов, `deno.lock`, job `checks`, заметки `README`, `01`, `02`.

## 2026-11-08 — S08, сессия 1: job checks, импорты бота, deno.lock
**Цель:** workflow `guest-bot.yml` с быстрыми проверками, перенос импортов бота в `deno.json`, коммит `deno.lock`, заметки `ci-cd/README`, `01`, `02`.
**Решения:**
- Импорты: 48 файлов, `npm:@supabase/supabase-js@2` → `@supabase/supabase-js`, `jsr:@std/assert@1` → `@std/assert`, версии — в общем `supabase/functions/deno.json`. Документация Supabase не гарантирует общий `deno.json` при деплое (рекомендует свой на функцию), поэтому обеим функциям в `config.toml` прописан `import_map = "./functions/deno.json"`: один источник версий, явный путь для CLI. **Не проверено на рантайме Supabase** (Docker локально не запущен): в сессии 2 job `integration` вызывает функцию через `supabase start` — `curl` без секрета, ждём 401; окончательно — первый деплой.
- `deno lint`: кроме `no-import-prefix` было 5 `require-await` в `testing/fakeTelegram.ts`. `async` без `await` там намеренный (throw → отклонённый Promise, как у настоящего клиента) — `deno-lint-ignore-file require-await` с объяснением, код не менялся.
- `deno.lock` пересоздан после переноса импортов и коммитится; CI — `deno check/test --frozen`.
- Версии в CI: pnpm 11.17.0 (как локально; `allowBuilds` в `pnpm-workspace.yaml` требует 10+), Node 24, Deno 2.9.7. Actions — текущие мажорные (`checkout@v7`, `setup-node@v7`, `pnpm/action-setup@v6`, `setup-deno@v2`): у v4 рантайм Node 20, который GitHub выводит из оборота.
- `checks` не гоняет тесты админки (решение вопроса 8); `build` проходит без `VITE_*`, проверка env в `supabaseClient` срабатывает только в браузере.
- `concurrency` проверок — по `github.ref` с отменой устаревшего прогона; `permissions: contents: read`.
- Старый `ci.yml` (конвертер) получил `paths` на свою папку.
- Все шаги `checks` прогнаны локально теми же командами: зелёные (бот — 131 юнит-тест, lint 80 файлов чисто).
- Первый прогон на GitHub (push `18edbb2`): `checks` зелёный за 42 с. Тестовый PR #1 (ошибка типа в `plural.ts`): событие `pull_request`, красный на `Admin: typecheck` (TS2322), lint/build пропущены, 32 с; старый `CI` на PR не запустился (`paths` работает). PR закрыт без merge, ветка удалена. На PR видны проверки Vercel — приложение конвертера валют, не наш workflow. Notice: `ubuntu-latest` переезжает на Ubuntu 26 — оставлен ярлык.
**Осталось:** сессия 2 — job `integration` (`supabase start`, тесты бота и админки, `curl` к функции на проверку `import_map`).

## 2026-11-08 — S08, сессия 2: job integration, Supabase в раннере
**Цель:** job `integration` — `supabase start` в раннере, все тесты бота и админки на чистой БД, проверка `import_map` функций на edge runtime; заметка `ci-cd/03`.
**Решения:**
- CLI — `supabase/setup-cli@v3` с версией `2.117.0` (как в `pnpm-lock.yaml`), не `pnpm exec`: postinstall пакета `supabase` (скачивает бинарник) не выполняется, в `allowBuilds` только esbuild.
- `supabase start -x studio,mailpit,storage-api,imgproxy,postgres-meta,logflare,vector,supavisor`: остаются Postgres, Auth, PostgREST, Realtime, Kong, Edge Runtime. Storage в проекте не используется.
- `.env` — `supabase status -o env --override-name api.url=SUPABASE_URL …` (имена `api.url`, `auth.anon_key`, `auth.service_role_key` подтверждены прогоном); проверка наличия трёх переменных без печати файла. Тесты и конфиги не менялись.
- `import_map` **подтверждён на локальном edge runtime**: POST без секрета → `telegram-webhook` и `notify-guest` отвечают `401 forbidden` (тело сверяется, чтобы не спутать с 401 от Kong). Окончательно — первый деплой в prod.
- Первый прогон: все 4 интеграционных файла админки упали — `Email logins are disabled`. Причина подтверждена: `[auth.email] enable_signup = false` в `config.toml` CLI превращает в `GOTRUE_EXTERNAL_EMAIL_ENABLED=false` — выключает email-вход целиком. Исправлено на `true`; регистрацию закрывает `[auth] enable_signup = false`. Для prod (сессия 3, `prod-checklist`): в Dashboard выключить «Allow new users to sign up», провайдер Email оставить включённым.
- Риски спеки не подтвердились: тесты не зависят от данных dev вне `seed.sql`; Realtime прошёл без прогрева; отсутствие `notify_guest_*` в Vault тесты статусов не ломает.
- Отладка — в ветке `s08-integration` через `gh workflow run --ref`, в `main` попал уже зелёный вариант.
- Второй прогон зелёный: `checks` 44 с, `integration` 2 мин 03 с (`supabase start` ~62 с, все 13 миграций с нуля + seed; бот 157/157 без пропусков, админка 311/311). В первом прогоне ECR ответил `Rate exceeded`, CLI повторил сам — возможный источник случайных падений, лечится перезапуском.
**Осталось:** сессия 3 — job `deploy`, prod-окружение (Supabase, BotFather, Cloudflare Pages), `_headers` с CSP, заметки `04`, `05`, `06`, `prod-checklist`.
