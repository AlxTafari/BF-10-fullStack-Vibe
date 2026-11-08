<!-- Спека «что делать». По факту не переписывается — факт живёт в ../../STATE.md. -->

# S08 — CI/CD

После спринта бот и админка проверяются в GitHub Actions на чистой БД на каждом PR в `main` и на каждом
изменении `main`. Изменение `main` — это прямой push или merge PR. Если проверки зелёные, изменение `main`
накатывает миграции и функции в отдельный prod-проект Supabase и выкладывает админку на Cloudflare Pages с
CSP-заголовком. Ручной `supabase db push` / `functions deploy` с ноутбука больше не нужен. Рядом лежит цикл
учебных заметок `docs/guides/ci-cd/`: как это устроено и почему.

Стартует после закрытия S07. Реализует ADR-007. С ним расходятся три решения (§3, STATE §3 при закрытии):
кроме PR разрешён прямой push в `main` (branch protection не включаем); интеграционные тесты гоняются против
`supabase start` в раннере; хостинг — Cloudflare Pages.

## 1. Цель и границы

- **Входит:**
  - Workflow `.github/workflows/guest-bot.yml`: проверки (§2.Б.1), интеграционные тесты на Supabase в Docker
    внутри раннера (§2.Б.2), деплой в prod (§2.Б.3). Срабатывает только на изменения
    `apps/04-05-supabase-lesson/**` и самого workflow.
  - Prod-окружение: новый проект Supabase, второй бот у BotFather, проект Cloudflare Pages (§2.А).
    Чек-лист первичной настройки — `docs/guides/ci-cd/prod-checklist.md`. Его же проходим вживую.
  - Сборка админки под prod: `VITE_*` из GitHub Variables, файл `admin/public/_headers` с CSP и заголовками
    безопасности, SPA-fallback (§2.В).
  - Перенос импортов бота в `imports` `deno.json` под правило `deno lint` `no-import-prefix` (вопрос 3): 48 файлов,
    два пакета — `npm:@supabase/supabase-js@2` (29 мест, запись в `deno.json` уже есть) и `jsr:@std/assert@1`
    (21 место, тесты). Правка механическая, поведение не меняется; `deno check` и тесты — до и после.
  - `deno.lock` коммитится, CI ставит зависимости бота с `--frozen` (вопрос 4).
  - Учебные заметки `docs/guides/ci-cd/` — пишутся в той же сессии, что и код, который они объясняют (§2.Г).
- **Не входит:**
  - Branch protection (запрет push в `main`, merge только при зелёном CI). Оба пути остаются открытыми: ветка
    → PR → merge и прямой push в `main`. От красного кода в prod защищает порядок jobs (`needs:`), а не запрет
    на merge. Включить защиту — когда появится второй разработчик; это галочка в настройках репозитория, YAML
    не меняется.
  - Preview-окружения на PR (Supabase Branching, превью Cloudflare). PR проверяется на БД раннера, админку на
    PR не выкладываем — бэклог.
  - Ручное подтверждение деплоя (GitHub Environment с required reviewers) — вопрос 2.
  - Автоматический откат миграций. Откат в проекте — только новой миграцией вперёд (§3, заметка 05).
  - Мониторинг и алерты (Sentry, логи функций во внешнем сервисе) — бэклог.
  - Свой домен для админки — бэклог; работаем на `*.pages.dev`.
  - CI для `01-currency-bot`, `02`, `03`: существующий `ci.yml` не трогаем, кроме фильтра путей (вопрос 6).
  - Баги BUG-001, BUG-002 — отдельно, не в этом спринте.
  - Отложенные с S05 ручные шаги `TESTER.md` — отдельным днём после закрытия S08, до того как дать ссылку на
    prod-бота реальным людям (вопрос 7). Хвост остаётся в STATE §4.

## 2. Что делаем

### 2.А Окружения и секреты

Два окружения:

| | dev | prod |
|---|---|---|
| Supabase | `myrest-guest-bot-dev` (как сейчас) | новый проект, например `myrest-guest-bot-prod` |
| Бот | `@myrest_guest_bot` | новый бот у BotFather |
| Кто деплоит | ты руками (`pnpm deploy:rest` и т. п.) | только GitHub Actions с `main` |
| Админка | `pnpm dev:admin` локально | Cloudflare Pages |
| Данные | вымышленный seed | вопрос 5 |

Хранилища в GitHub (Settings → Secrets and variables → Actions):

- **Secrets** (шифруются, в логах маскируются):
  - `SUPABASE_ACCESS_TOKEN` — личный токен Supabase CLI (Account → Access Tokens);
  - `SUPABASE_DB_PASSWORD` — пароль БД prod-проекта, нужен для `supabase db push`;
  - `CLOUDFLARE_API_TOKEN` — токен с правом только «Cloudflare Pages: Edit»;
  - `CLOUDFLARE_ACCOUNT_ID`.
- **Variables** (не секретны, видны в логах):
  - `SUPABASE_PROJECT_REF` — ref prod-проекта;
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — публичные по природе, всё равно уходят в бандл браузера
    (`guides/supabase-rls-auth.md` §1). Положить их в Secrets — ошибка понимания, а не лишняя защита;
  - `CF_PAGES_PROJECT` — имя проекта Pages.

Секреты Edge Functions (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NOTIFY_GUEST_SECRET`) и Vault
(`notify_guest_url`, `notify_guest_secret`) в GitHub **не кладём**. Они задаются один раз при создании
prod-проекта (`supabase secrets set`, SQL для Vault) и живут в Supabase. CI их не знает и не меняет. Чем
меньше секретов проходит через CI, тем меньше поверхность утечки (вопрос 1).

Service-role ключ prod-проекта не попадает в GitHub вообще: деплою он не нужен, тесты идут на локальной БД
раннера.

### 2.Б Workflow

Один файл `.github/workflows/guest-bot.yml`, три job'а:

```
on:
  push:         branches: [main]   ─ прямой push и merge PR (merge для GitHub — тоже push в main)
  pull_request: branches: [main]   ─ открытие PR и каждый новый коммит в его ветку
  workflow_dispatch                ─ ручной запуск из вкладки Actions
  (у push и pull_request — paths: apps/04-05-supabase-lesson/**, .github/workflows/guest-bot.yml)

checks ──┐
         ├──► deploy   (только push в main или ручной запуск; concurrency: guest-bot-prod)
integration ┘
```

| Событие | `checks` | `integration` | `deploy` |
|---|---|---|---|
| PR в `main` (открыт / новый коммит) | да | да | **нет** — код ещё не в `main` |
| Merge PR в `main` | да | да | да |
| Прямой push в `main` | да | да | да |
| Push в ветку без PR | нет | нет | нет |
| `workflow_dispatch` | да | да | да |

Условие `deploy`: `if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'`. После merge
проверки прогоняются второй раз, уже на коммите в `main`. Это не лишнее: пока PR висел, `main` мог уйти вперёд,
и в prod уезжает именно склеенный код, а не тот, что проверялся в PR.

`checks` и `integration` идут параллельно, `deploy` ждёт оба (`needs: [checks, integration]`). Любой красный
job — деплоя нет. `workflow_dispatch` позволяет перезапустить деплой руками, в том числе со старого коммита
для отката функций (заметка 05).

PR из ветки этого же репозитория получает Secrets, PR из форка — нет. Job'ам PR секреты и не нужны:
`integration` работает с БД раннера, а `deploy` на PR не запускается.

#### 2.Б.1 `checks` — быстрые проверки без БД

Шаги (каждый — отдельный `step`, чтобы в логе было видно, что упало):

1. `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` с `cache: pnpm`, `denoland/setup-deno`
   (версия Deno — та, что в edge runtime Supabase; сверить в начале сессии 1).
2. `pnpm install --frozen-lockfile`.
3. Бот: `pnpm check:layers:rest`, `deno check --frozen` по всем `index.ts` функций и тестам, `deno lint` (после
   переноса импортов — без отключённых правил), `deno test --allow-env --frozen` — только домен, интеграционные
   без `SUPABASE_URL` пропускаются сами. `--frozen`: lock не совпал с импортами — красный job, а не тихое
   обновление версий.
4. Админка: `pnpm check:layers:admin`, `typecheck`, `lint`, `build`. `pnpm test` здесь не запускаем: без env
   интеграционные файлы `tests/` упадут. Юнит-тесты `src/` — вопрос 8.

Цель — меньше 3 минут. Это первый сигнал «сломал типы».

#### 2.Б.2 `integration` — тесты на чистом Supabase в раннере

Раннер GitHub — одноразовая виртуалка Ubuntu с Docker. `supabase start` поднимает в ней Postgres, Auth,
Realtime, PostgREST и Edge Runtime, применяет все миграции с нуля и `seed.sql`. После job'а виртуалка
уничтожается вместе с БД.

1. checkout, pnpm, node, deno, `supabase/setup-cli` (версия CLI = версия из `package.json`, сверить).
2. `supabase start -x studio,imgproxy,inbucket,…` — лишние контейнеры отключить, чтобы ускорить старт (точный
   список — сессия 2).
3. Сгенерировать `apps/04-05-supabase-lesson/.env` из `supabase status -o env`: `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Имена переменных в выводе CLI сверить: новые версии
   печатают ещё и publishable/secret-ключи. Файл подхватывают оба потребителя: `deno test --env-file=../../.env`
   и `admin/vite.config.ts` (`loadEnv` из корня приложения). **Боевой код и конфиги тестов ради CI не
   меняются.**
4. `deno test --allow-env --allow-net --allow-read --env-file=../../.env` — все тесты бота, включая сценарии S07.
5. `pnpm test:admin` — юнит + интеграционные (RLS, RPC статусов, Realtime, чат).
6. На падении — `supabase status` и логи контейнеров в вывод (`if: failure()`), иначе разбираться вслепую.

Что это даёт сверх зелёных тестов: миграции проверяются **с чистого листа**. Сейчас они накатывались только
поверх dev-БД по одной, и миграция, которая молча полагается на ручную правку в dev, здесь упадёт.

Известные риски (проверить в сессии 2, найденное — в LOG):

- Тесты могли незаметно полагаться на данные dev-БД, которых нет в `seed.sql` (менеджер, `manager_chat_id`,
  часы работы).
- Realtime после холодного старта медленный. У `realtime.integration.test.ts` нет прогрева (STATE §4); если он
  падает в CI, добавить тот же прогрев, что в тесте чата.
- `pg_cron`, `pg_net`, Vault локально есть, но секретов `notify_guest_*` в Vault нет. Триггер пишет `warning`,
  тесты статусов на это не завязаны (сверить).
- Лимит времени job'а — `timeout-minutes: 20`, чтобы зависший контейнер не жёг минуты.

#### 2.Б.3 `deploy` — выкладка в prod

`if: github.ref == 'refs/heads/main'`, `concurrency: { group: guest-bot-prod, cancel-in-progress: false }`.
Два пуша подряд не деплоят параллельно: второй ждёт первого и не отменяет его на середине миграции.

Порядок важен, шаги идут строго друг за другом:

1. **Миграции:** `supabase link --project-ref $SUPABASE_PROJECT_REF` → `supabase db push`. Сначала схема:
   код, который ждёт новую колонку, не должен выйти раньше колонки. Наши миграции и так пишутся по схеме
   expand → contract (валюта, S04; `p_bucket default`, S07), поэтому новая схема совместима со старым кодом.
2. **Функции:** `supabase functions deploy --project-ref $SUPABASE_PROJECT_REF` (все функции из
   `supabase/functions`, `verify_jwt` берётся из `config.toml`).
3. **Админка:** `pnpm build:admin` с `VITE_*` из Variables → `cloudflare/wrangler-action` →
   `pages deploy admin/dist --project-name=$CF_PAGES_PROJECT --branch=main`.
4. **Smoke-проверка:** `curl` к webhook без секрета → ожидаем 401/403, не 5xx; `curl` к админке →
   200 и заголовок `content-security-policy` на месте.

Падение шага N останавливает следующие. Если миграции прошли, а функции упали, prod остаётся на новой схеме со
старым кодом. Expand → contract делает такое состояние безопасным.

### 2.В Админка под prod

- `admin/public/_headers` (Vite копирует `public/` в `dist/` как есть):
  ```
  /*
    Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
      connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; img-src 'self' data: https:;
      font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
    X-Frame-Options: DENY
    Referrer-Policy: strict-origin-when-cross-origin
    X-Content-Type-Options: nosniff
  ```
  `<ref>` подставляется при сборке из `VITE_SUPABASE_URL` (шаг в workflow или плагин Vite — сессия 3). Хардкод
  ref'а prod-проекта в репозитории не нужен.
  `style-src 'unsafe-inline'` — предположение: Radix и sonner ставят inline-стили через атрибут `style`.
  Проверить на сборке: без него консоль покажет нарушения. Для скриптов `unsafe-inline` **запрещён**
  (роадмап §3.2) — ради этого заголовка всё и делается.
- SPA-fallback: Cloudflare Pages сам отдаёт `index.html` на неизвестный путь, если в `dist/` нет `404.html`.
  Проверить F5 на `/bookings/<id>`.
- Prod Auth: в Dashboard prod-проекта выключить регистрацию (`enable_signup = false` живёт в `config.toml`
  только для локального стека), `site_url` = адрес Pages. Менеджер заводится руками по README.

### 2.Г Учебные заметки `docs/guides/ci-cd/`

Формат как у `guides/supabase-rls-auth.md`: конспект, не спека и не ADR. Объясняет на **нашем** workflow, со
ссылками на строки файла. Каждая заметка пишется в той сессии, где появляется её код, и до коммита сверяется с
реальным поведением (лог прогона, скриншот вкладки Actions — текстом).

| Файл | О чём | Сессия |
|---|---|---|
| `README.md` | Оглавление, словарь: CI, CD (delivery vs deployment), pipeline, workflow, job, step, runner, action, artifact, trigger | 1 |
| `01-ci-cd-basics.md` | Зачем CI/CD, что было бы без него у нас (ручной деплой с ноутбука, забытая миграция), «зелёный main» | 1 |
| `02-github-actions-anatomy.md` | Разбор `guest-bot.yml`: `on` (push / pull_request / workflow_dispatch, почему merge — это push), `paths`, `jobs`, `needs`, `if`, `runs-on`, `uses` vs `run`, кэш pnpm, статус на странице PR, где смотреть логи, как перезапустить; branch protection — что это и почему пока выключено | 1 |
| `03-database-in-ci.md` | Почему не общая dev-БД, что делает `supabase start` в раннере, `status -o env`, миграции с чистого листа, частые причины падений | 2 |
| `04-secrets-and-environments.md` | Secrets vs Variables vs `.env`; почему anon-ключ не секрет, а service-role — да; маскирование; минимальные права токенов; секреты форков | 3 |
| `05-deploy-and-rollback.md` | Порядок «миграции → функции → фронт», expand → contract, `concurrency`, откат функций передеплоем старого коммита, откат схемы только вперёд | 3 |
| `06-spa-hosting-and-csp.md` | Как Pages раздаёт SPA, `_headers`, что ломает каждая директива CSP, как читать нарушения в консоли | 3 |
| `prod-checklist.md` | Пошагово: новый проект Supabase → секреты функций → Vault → webhook → Auth → менеджер → Pages | 3 |

Заметка, написанная до кода, правится по факту. В ней не остаётся того, что не подтвердилось на прогоне.

## 3. Инварианты, которые этот спринт обязан удержать

- **В prod выкладывает только CI.** После S08 ручной `db push` / `functions deploy` в prod-проект запрещён: иначе
  prod разъедется с `main`. Скрипты `deploy:rest`, `db:push:rest`, `link:rest` остаются для dev. В README
  явно написать, куда они смотрят.
- **Деплой только после зелёных `checks` и `integration`.** Никаких `continue-on-error` на шагах проверок.
- **Боевой код не меняется ради CI.** Env для тестов генерируется в workflow; флаги `if (CI)` в коде запрещены
  (тот же принцип, что в S07 §3).
- **Секреты не печатаются.** Никаких `echo $SECRET`, `cat .env` в логе; `set -x` в шагах с секретами не
  включать. Помнить, что маска GitHub не ловит секрет, который скрипт преобразовал (base64, подстрока).
- **Схема — только вперёд (expand → contract).** Миграция не ломает код предыдущего деплоя: между шагами 1 и 2
  деплоя prod какое-то время работает на новой схеме со старыми функциями.
- **CSP без `unsafe-inline` / `unsafe-eval` в `script-src`** (роадмап §3.2). Тексты гостей в админке — только
  как текст (S05 §2.В, S06 §3.7). CSP — второй рубеж, не замена.
- **ADR-008:** `pnpm check:layers:rest` и `check:layers:admin` — обязательные шаги `checks`.
- **Заявки бессрочны, тесты не трогают prod.** Интеграционные тесты в CI видят только локальную БД раннера.
  `SUPABASE_URL` prod-проекта в job `integration` не попадает.
- **PR никогда не деплоит.** Деплой — только из `main` (push, merge, ручной запуск). Условие `if:` у `deploy`
  проверяется на приёмке нарочным PR (§5, шаг 2).
- **ADR-007 обновляется при закрытии.** Три отступления (прямой push в `main` наравне с PR, `supabase start`, Cloudflare Pages)
  вносятся в ADR, а не остаются только в STATE.

## 4. Открытые вопросы объёма

Все вопросы решены 2026-11-08 (QA, запись «S08: ответы на вопросы спеки»).

1. **Секреты функций — руками или из CI?** Предлагаю руками один раз (`prod-checklist.md`): они почти не
   меняются, а через CI пришлось бы держать токен бота в GitHub. Альтернатива — шаг `supabase secrets set` в
   `deploy` из GitHub Secrets.
   **Решено:** руками один раз по `prod-checklist.md`.
2. **Ручное подтверждение деплоя.** Предлагаю без него (пуш в `main` = релиз), но `deploy` пометить
   `environment: production`: в GitHub появится история деплоев, а подтверждение потом включается галочкой без
   правки YAML. Ок?
   **Решено:** без подтверждения, `environment: production` у `deploy` есть.
3. **`deno lint` и `no-import-prefix`.** (а) Перенести `npm:`/`jsr:` в `imports` `deno.json` — правильнее,
   правка импортов по всем функциям; (б) отключить правило в `deno.json`. Предлагаю (б) в этом спринте и баг
   tooling на (а): правка импортов — рефакторинг вне темы CI.
   **Решено:** (а) — переносим импорты в `deno.json` в этом спринте (сессия 1), правило не отключаем.
4. **Коммитить `deno.lock`?** Сейчас не коммитится (STATE §4) и висит в `git status`. Предлагаю коммитить и в CI
   запускать с `--frozen`: та же роль, что `--frozen-lockfile` у pnpm, CI ставит ровно те версии, что
   проверены. Альтернатива — `.gitignore`.
   **Решено:** коммитить, CI с `--frozen`.
5. **Данные prod.** Prod-бот увидят реальные люди. (а) Тот же вымышленный seed «Лавраки» через
   `db:seed:remote` на prod; (б) пустой ресторан, заполнить через админку. Предлагаю (а) пока нет реального
   ресторана: так бот сразу показывает меню. `seed.sql` на prod — только руками, CI его не запускает.
   **Решено:** (а) — вымышленный seed, один раз руками.
6. **Существующий `ci.yml` (конвертер валют)** срабатывает на любой push. Добавить ему `paths:
   apps/01-currency-bot/**`? Предлагаю да, одна строка, иначе каждый пуш гостевого бота гоняет чужие тесты.
   **Решено:** да, `paths: apps/01-currency-bot/**`.
7. **Ручные шаги S05 (`TESTER.md`)** — проходить на prod в рамках приёмки S08 или отдельным днём после?
   Предлагаю в приёмке: STATE §4 прямо требует «до прод-запуска».
   **Решено:** отдельно после закрытия S08, до публикации prod-бота. В приёмку S08 не входят.
8. **Юнит-тесты админки в `checks`.** Вынести `src/**` в отдельный vitest-проект или скрипт `test:unit`, чтобы
   быстрый job ловил и их? Предлагаю нет: `integration` всё равно гоняет полный `pnpm test`, второй прогон
   только удлиняет. Вернуться, если `integration` станет медленнее 10 минут.
   **Решено:** нет, только в `integration`.
9. **Smoke-проверка после деплоя** (§2.Б.3, шаг 4) — делать? Предлагаю да, два `curl`. Иначе «деплой зелёный,
   а бот отвечает 500» узнаём от гостя.
   **Решено:** да.

## 5. Что показываем на приёмке

Проверяет пользователь.

1. Вкладка Actions: последний push в `main` — три job'а зелёные, `deploy` ждал оба. Время `checks` и
   `integration` записано в LOG.
2. **Путь через PR:** ветка с ошибкой типа в `admin/src` → PR в `main` → `checks` красный, на странице PR
   красный статус, job `deploy` в списке отсутствует. Исправить коммитом в ту же ветку → PR зелёный, `deploy`
   всё так же не запускался. Merge → на `main` запускаются все три job'а, `deploy` выкатывает.
3. **Прямой push, поломка теста:** в `content.ts` заменить `BOOKING_SENT` (как на приёмке S07) → push в `main` →
   `integration` красный на сценарном тесте, `deploy` пропущен (серый), prod не изменился. Вернуть.
4. **Миграция с нуля:** в логе `integration` видно, что `supabase start` применил все миграции по порядку на
   пустую БД.
5. Push с правкой только в `apps/01-currency-bot/` → `guest-bot.yml` не запускается.
6. Prod-бот: `/start` → меню, FAQ, карточка блюда, бронь до «Отправить» → заявка появилась в prod-админке по
   WebSocket, менеджеру пришло уведомление в Telegram.
7. Prod-админка на `*.pages.dev`: вход менеджером, F5 на `/bookings/<id>` открывает карточку, а не 404.
   DevTools → Network → ответ документа содержит `content-security-policy`; в консоли нет нарушений CSP.
   Попытка выполнить `<script>` из консоли через `document.body.append(...)` с inline-кодом блокируется.
8. Подтверждение брони в prod-админке → гостю пришло уведомление (Vault и `notify-guest` в prod настроены).
9. Новая миграция (безвредная, например комментарий к таблице) → push → она применилась в prod без ручных
   действий (`supabase migration list --linked` на prod).
10. `deno lint` по функциям чистый без отключённых правил; в коде функций нет `npm:`/`jsr:` в импортах
    (`grep -rE '"(npm|jsr):' supabase/functions --include='*.ts'` пусто).
11. Заметки `docs/guides/ci-cd/` прочитаны; что непонятно — записано вопросом в QA и поправлено в заметке.
