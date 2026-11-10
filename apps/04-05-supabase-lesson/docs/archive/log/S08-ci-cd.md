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

## 2026-11-08 — S08, сессия 3: prod-окружение и job deploy
**Цель:** prod-проект Supabase, второй бот, хостинг админки по `prod-checklist.md` (вживую), Secrets/Variables, `_headers` с CSP, job `deploy` + smoke; заметки `04`, `05`, `06`, `prod-checklist`.
**Решения:**
- **Отдельного prod-проекта и второго бота нет** (отступление от спеки §1, §2.А). Проект учебный, ботом пользуется только разработчик. CI деплоит в существующий `myrest-guest-bot-dev` и бот `@myrest_guest_bot`. Секреты функций, Vault, seed, webhook и менеджер уже на месте, чек-лист сокращён до доступа CI, хостинга админки и Auth Site URL. Шаги для отдельного prod — приложением в `prod-checklist.md`. Цель деплоя задаёт только Variable `SUPABASE_PROJECT_REF`. Цена решения: миграции в этот проект теперь катит только CI (миграция с ноутбука мимо `main` ломает следующий `db push`), функции с ноутбука перезаписываются следующим push в `main`. История миграций проекта до подключения CI совпадает с локальной (13/13).
- Ручной `db push` закрыт: скрипт `db:push` (и `db:push:rest` через него) печатает «миграции катит только CI» и выходит с ошибкой. Паролем БД закрыть нельзя: CLI с ноутбука ходит через личный токен и временную login-роль, без пароля (`migration list --linked` отработал без него). Голый `supabase db push` остаётся возможным, ограничение — по договорённости. Миграция проверяется в PR (`integration`) или локально (`supabase start`). `deploy:rest` оставлен: функции с ноутбука ничего не ломают, следующий push в `main` их перезапишет.
- CSP и хостинг админки — см. запись 2026-11-10 (Cloudflare Pages заменён на GitHub Pages). `style-src 'unsafe-inline'` нужен из-за sonner: он вставляет `<style>` из JS (подтверждено в `node_modules/sonner`). Добавлен `object-src 'none'`.
- `concurrency` workflow: `cancel-in-progress` только для PR. Раньше стоял `true` для всех, и второй push в `main` отменил бы весь прогон вместе с deploy посреди миграции.
- Функции — `functions deploy --use-api` (сборка на стороне Supabase, без Docker-образа).
**Осталось:** (заполняется по ходу)

## 2026-11-10 — S08, сессия 3 (продолжение): только GitHub, без Cloudflare
**Цель:** убрать второй внешний сервис из деплоя. В учебном проекте важнее понять механику CI/CD на одном инструменте, чем подключать ещё один аккаунт и токены.
**Решения:**
- Админка — на **GitHub Pages** вместо Cloudflare Pages (отступление от спеки §2.А, §3). Из чек-листа ушли аккаунт Cloudflare, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `wrangler pages project create`, Variables `CF_PAGES_PROJECT` и `ADMIN_URL`. Остались 2 секрета (Supabase) и 3 Variables. Публикация — `actions/upload-pages-artifact@v5` + `actions/deploy-pages@v5` через OIDC, без токенов.
- Workflow: `deploy` (миграции, функции, smoke функций, окружение `production`) и отдельный `deploy-admin` после него (окружение `github-pages`, права `pages: write` + `id-token: write` только у него).
- Ограничения Pages описываются в заметке 06, а не обходятся: нет своих заголовков ответа, поэтому CSP — тегом `<meta>` (плагин `cspMeta` в `vite.config.ts`), а `frame-ancestors` и `X-Frame-Options` так не задать, защиты от встраивания во фрейм нет. Нет SPA-fallback: `404.html` = копия `index.html`, глубокая ссылка открывается, но со статусом 404. Сайт в подпапке `/<репозиторий>/`: `base` из `ADMIN_BASE_PATH` и `basepath` роутера из `import.meta.env.BASE_URL`.
- `LoginForm`: `router.history.push` → `router.navigate({ href })`. `history.push` не знает про `basepath` и после входа увёл бы на `/bookings/…` мимо подпапки.
- Локально: сборка с `ADMIN_BASE_PATH=/BF-10-fullStack-Vibe/` даёт ассеты с префиксом и CSP первым тегом `<head>`, lint чистый. В браузере на Pages не проверено, проверит первый деплой и шаг Е чек-листа.
**Осталось:** пройти `prod-checklist.md` (A, Б1 включить Pages, В, Г2 Site URL = `https://alxtafari.github.io/BF-10-fullStack-Vibe/`), первый деплой, заметки `04`, `05`, `06`.

## 2026-11-10 — S08, первый деплой: db push не достучался до БД
**Цель:** первый прогон `deploy` (шаг Д чек-листа).
**Решения:**
- Прогон 42787232886: `checks`, `integration` зелёные, `deploy` упал на `db push` с `IPv6 is not supported on your current network`, `deploy-admin` пропущен, prod не тронут. Причина подтверждена: у раннеров GitHub нет IPv6, прямой адрес БД только IPv6, а адрес пулера (IPv4) `link` не сохранил: ограниченному токену не хватало `database_pooling_config_read` (Connection Pooling: Read). Запрос пулера в `link` best-effort (исходники CLI, `link-services-core.ts`), ошибка проглатывается. Проверено `curl` к Management API: 403 с `missing_permissions`.
- Токен пересоздаётся с этим правом. В шаг `Prod: migrations` добавлена проверка `supabase/.temp/pooler-url` после `link`: падение с понятным текстом вместо ошибки про IPv6.
- Второй прогон (`bffe0da`) зелёный целиком: `Remote database is up to date`, обе функции выложены, smoke 401 `forbidden`, админка на Pages отвечает 200.
- Д2: `migration list --linked` — 13/13, Local и Remote совпадают.
- Локальный CLI отвечал `Invalid access token`: в `.env` лежал `SUPABASE_ACCESS_TOKEN` удалённого токена, CLI берёт его раньше `supabase login`, и повторный `login`, судя по всему, сохранил в связку ключей его же. Строка из `.env` удалена, после повторного `login` CLI работает. Локально токен в `.env` не нужен.
- Шаг Е: вход менеджером на Pages работает (пароль менеджера задан заново через SQL Editor: «Send password recovery» отвечал `requested path is invalid`, а экрана сброса пароля в админке всё равно нет). Во время брони — BUG-003 (`unavailable` на шаге гостей, гипотеза: повторное нажатие кнопки часа).
- Заметки `04` (секреты, окружения, токен и пулер, OIDC), `05` (порядок деплоя, expand → contract, откат), `06` (GitHub Pages, CSP в `<meta>`). В `05` записано: откат через `workflow_dispatch` со старого коммита, как планировала спека, с условием `github.ref == 'refs/heads/main'` не работает; откат — `git revert` + push.
- Шаг Е досмотрен: F5 на заявке, CSP, Realtime и уведомления работают.
**Осталось:** приёмка S08 (см. запись ниже), хвост: экрана сброса пароля в админке нет.

## 2026-11-10 — S08, сессия 4: приёмка по §5 спеки
**Цель:** пройти сценарий приёмки §5, затем ритуал закрытия.
**Решения:**
- **П.1.** Прогоны `b6bb096` (42799072567) и `75053e1` (42801411768): все четыре job'а зелёные, `deploy` ждал `checks` и `integration`. Job'ов четыре, а не три, как в спеке: админка вынесена в `deploy-admin`. Время: `checks` ~45 с, `integration` ~2,5 мин, `deploy` ~25 с, `deploy-admin` ~50 с, весь путь ~4 мин.
- **П.2.** PR #2 из ветки `s08-acceptance`. Коммит `e6d7d30` с ошибкой типа: `checks` красный на `TS2322` в `admin/src/acceptanceCheck.ts`, статус на PR красный, `deploy` и `deploy-admin` skipped. GitHub показывает пропущенные job'ы серыми, а не скрывает их, как написано в спеке. Исправление `b27450b`: PR зелёный, деплой всё так же skipped. Merge (`75053e1`, руками: `gh pr merge` из сессии заблокирован проверкой прав) → в `main` выполнились все job'ы с деплоем.
- **П.4.** В логе `integration` PR-прогона `supabase start` применил все 14 миграций по порядку на пустую БД, включая новую.
- **П.6, п.8.** Ручная проверка на шаге Е: бот (`/start`, меню, FAQ, карточка блюда, бронь), заявка в админке по WebSocket без F5, уведомление менеджеру, подтверждение брони → уведомление гостю.
- **П.7.** Вход менеджером на Pages, F5 на `/bookings/<id>` открывает карточку (статус документа 404, ограничение Pages). Проверено в браузере: первый тег `<head>` — `<meta http-equiv="Content-Security-Policy">` с `script-src 'self'` и `wss://<ref>.supabase.co`; вставленный inline-`<script>` не выполнился, событие нарушения `script-src-elem`. Пункт спеки сформулирован под Cloudflare (заголовок ответа, `*.pages.dev`), проверен в варианте Pages.
- **П.9.** Миграция `20261110100000_restaurants_comment.sql` (только `comment on table restaurants`) через PR и merge: `deploy` применил её в prod, `migration list --linked` — 14/14.
- **П.10.** `deno lint` по 80 файлам функций чистый; `grep` импортов `npm:`/`jsr:` в `supabase/functions` пуст.
- **П.11** принят.
- Попутно: на главной репозитория в Contributors виден `@claude`. В живой истории `main` подписей нет, API `/contributors` возвращает только владельца. Источник — `Co-Authored-By: Claude` в коммите `88d5daf`, убранном force-push'ами до S08; блок на главной, видимо, из кэша GitHub (гипотеза). Чинится поддержкой GitHub (сборка мусора), не правкой истории.
**Осталось:**
- П.3: прямой push в `main` с поломкой `BOOKING_SENT` → `integration` красный, `deploy` skipped → revert.
- П.5: push только в `apps/01-currency-bot/` → `guest-bot.yml` не запускается → revert.
- Удалить ветку `s08-acceptance` на GitHub (при merge не удалилась).
**Итог:** S08 принят 2026-11-10. **П.3 и П.5 не проверены** — приняты без прогона, перенесены хвостом в `STATE.md` §4. Ветка `s08-acceptance` на GitHub не удалена.
