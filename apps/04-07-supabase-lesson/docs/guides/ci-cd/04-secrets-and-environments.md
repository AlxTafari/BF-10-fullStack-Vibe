# 04. Секреты и окружения: где что лежит и почему

Конспект к S08, сессия 3. Job'ы `deploy` и `deploy-admin` в
[`.github/workflows/guest-bot.yml`](../../../../../.github/workflows/guest-bot.yml) (строки 197–357 на момент
сессии 3). Всё ниже проверено на первом деплое 2026-11-10: прогон 42787232886 упал, 42789516871 зелёный.

---

## 1. Пять мест, где живут значения

У проекта нет одного «файла с настройками». Каждое значение лежит там, где его читает тот, кому оно нужно.

| Где | Кто читает | Что лежит | Видно ли |
|---|---|---|---|
| `.env`, `admin/.env.local` на ноутбуке | ты: `pnpm dev`, тесты, локальный CLI | ключи локального стека и dev-проекта | только тебе, в `.gitignore` |
| **GitHub Secrets** | workflow, через `${{ secrets.X }}` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | никому, даже владельцу после сохранения |
| **GitHub Variables** | workflow, через `${{ vars.X }}` | `SUPABASE_PROJECT_REF`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | всем, кто видит репозиторий и логи |
| **Секреты функций Supabase** | Edge Functions в облаке, через `Deno.env` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NOTIFY_GUEST_SECRET` | только в Dashboard проекта |
| **Vault** (схема `vault` в БД) | SQL-функция смены статуса заявки, которая зовёт `notify-guest` (миграция `20261015110000_request_status_rpc.sql`) | `notify_guest_url`, `notify_guest_secret` | только из SQL под нужной ролью |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` функции получают от Supabase сами, задавать
их не нужно.

CI деплоит код функций, но не трогает их секреты и Vault: они задаются руками один раз (спека S08, вопрос 1).
Поэтому новый секрет функции — это ручной шаг до деплоя кода, который его читает.

### Почему CI не видит твой `.env`

Раннер — чистая виртуалка. Он клонирует репозиторий, а `.env` в git нет. Всё, что нужно CI, надо отдать
GitHub'у отдельно. Поэтому значения из `.env` никуда не «переезжают»: в CI едут только те, что нужны деплою.

### Как секрет попадает в шаг

```yaml
- name: "Prod: migrations"
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
```

1. GitHub подставляет значение в переменную окружения **только этого шага**. Соседние шаги его не видят.
2. Supabase CLI сам читает переменные с этими именами. Флаги с токеном в командной строке не нужны.
3. Если значение секрета появится в логе, GitHub заменит его на `***`. В логе прогона так и видно:
   `SUPABASE_ACCESS_TOKEN: ***`.

Секреты подключаются в шаге, а не на уровне job'а: чем меньше шагов видят секрет, тем меньше мест, где он
может утечь (например, через чужой action, который печатает окружение).

Записываются секреты так (значение спрашивается интерактивно, в историю shell не попадает):

```bash
gh secret set SUPABASE_ACCESS_TOKEN
```

## 2. Что секрет, а что нет

Правило: **секрет — то, что даёт права. Публичное — то, что всё равно окажется у пользователя.**

### Anon-ключ — не секрет

`VITE_SUPABASE_ANON_KEY` лежит в Variables, и это не ошибка. Любая переменная `VITE_*` вшивается в JS-бандл,
а бандл скачивает каждый, кто откроет админку. Ключ виден в DevTools → Sources. Спрятать его в Secrets нельзя:
после сборки он всё равно окажется в публичном файле. Variables честно показывают, что значение публичное.

Сам по себе ключ говорит Supabase только «это аноним из этого проекта». Что аноним может, решают:

- **RLS-политики.** Без входа менеджера аноним ничего не читает и не пишет. Проверяет job `integration`
  (`admin/tests/rls.integration.test.ts`).
- **Выключенная регистрация.** Иначе любой с этим ключом завёл бы аккаунт и стал `authenticated`.

Поэтому проверять нужно политики, а не место хранения ключа. Таблица без RLS открыта всем, где бы ни
лежал ключ.

Новый формат ключа — `sb_publishable_…`. Это то же самое, что anon, supabase-js принимает оба.

### Что секрет всегда

| Значение | Почему | Где можно |
|---|---|---|
| `service_role` (`sb_secret_…`) | обходит RLS, полный доступ к данным | только секреты функций; **никогда** в `VITE_*` |
| `SUPABASE_ACCESS_TOKEN` | управляет проектом через Management API | GitHub Secrets |
| `SUPABASE_DB_PASSWORD` | прямой доступ к Postgres мимо всех API | GitHub Secrets, менеджер паролей |
| `TELEGRAM_BOT_TOKEN` | кто знает токен, тот и есть бот | секреты функций |

Признак настоящей утечки: `service_role` в переменной с префиксом `VITE_`.

### Публичный репозиторий и логи

У публичного репозитория логи Actions видны всем. Значения Variables печатаются в логах открыто
(`SUPABASE_PROJECT_REF: xzbxalxqeehtcwleoudw`). Для них это нормально: ref и так в URL, а anon-ключ в бандле.

## 3. Токен Supabase с ограниченными правами

`SUPABASE_ACCESS_TOKEN` — персональный токен (PAT) с Dashboard → Account → Access Tokens. Раньше токен давал
полный доступ ко всем проектам аккаунта. Теперь права задаются по отдельности, и токен можно ограничить
одним проектом.

### Минимальный набор для нашего workflow

| Право (раздел формы) | Уровень | Кому нужно |
|---|---|---|
| Project Settings (Project) | Read | `supabase link` |
| API Keys (Application services) | Read | `supabase link` |
| API Key Secrets (Application services) | Read | `supabase link` |
| **Connection Pooling (Database)** | Read | `supabase link`: адрес пулера, иначе `db push` не подключится (§4) |
| Edge Functions (Application services) | Read-write | `supabase functions deploy` |

Особенности формы:

- Разделы (Project, Database, Application services…) — свёрнутые аккордеоны. Права внутри не видны, пока
  раздел не раскрыт. Connection Pooling лежит в Database рядом с Database Config, не путать.
- **Права задаются при создании и потом не меняются.** Забыл право — новый токен, старый удалить,
  `gh secret set` ещё раз.

Права на миграции не нужны. `db push` ходит в базу по `SUPABASE_DB_PASSWORD`, а пароль права токена не
ограничивают. Безопасность миграций держится на пароле БД, а не на токене.

### Как узнать, какого права не хватает, без CI

Management API на нехватку прав отвечает 403 со списком. Любой эндпоинт можно проверить `curl`:

```bash
read -s T && curl -s -H "Authorization: Bearer $T" \
  https://api.supabase.com/v1/projects/<ref>/config/database/pooler; unset T
```

Ответ старого токена на первом деплое:

```json
{"message":"Missing required permission(s): database_pooling_config_read","error":{"missing_permissions":["database_pooling_config_read"]}}
```

Имя в ответе (`database_pooling_config_read`) — внутреннее. В форме оно называется Connection Pooling: Read.

### `supabase login` — это другой токен

Вход через браузер (`supabase login`) создаёт **отдельный** токен с полным доступом и кладёт его в связку
ключей macOS. Это токен ноутбука, не CI. Ограниченный токен создаётся только в Dashboard.

Грабли, на которые наступили: CLI читает `SUPABASE_ACCESS_TOKEN` из `.env` приложения **раньше**, чем токен из
`supabase login`. В `.env` лежал удалённый токен, и локальный CLI отвечал `Invalid access token` даже после
повторного входа: `login`, судя по всему, сохранил в связку тот же токен из окружения. Лечение — убрать строку
из `.env` и войти ещё раз. Локально токен в `.env` не нужен совсем.

## 4. Первое падение: IPv6 и пулер

Прогон 42787232886, шаг `Prod: migrations`:

```
Finished supabase link.
IPv6 is not supported on your current network
Run supabase link --project-ref xzbxalxqeehtcwleoudw to setup IPv4 connection.
Error: Process completed with exit code 1.
```

Цепочка причин:

1. Прямой адрес базы `db.<ref>.supabase.co` на бесплатном плане доступен **только по IPv6**.
2. У раннеров GitHub **нет IPv6**.
3. Для таких сетей у Supabase есть пулер соединений (Supavisor) с IPv4:
   `aws-1-eu-central-1.pooler.supabase.com`. `supabase link` записывает его адрес в
   `supabase/.temp/pooler-url`, и `db push` переключается на него сам, если прямой адрес недоступен.
4. `link` запрашивает адрес пулера в режиме **best-effort** (по исходникам CLI, `link-services-core.ts`): при
   ошибке молча пропускает и всё равно пишет `Finished supabase link`. Токену не хватало права на пулер →
   403 → файла нет → `db push` упал с ошибкой про IPv6, которая ничего не говорит о правах.

На ноутбуке всё работало: токен от `supabase login` полный, и `pooler-url` там есть.

Защита в workflow — проверка сразу после `link`:

```yaml
supabase link --project-ref "$SUPABASE_PROJECT_REF"
[ -s supabase/.temp/pooler-url ] || {
  echo "::error::link не сохранил адрес пулера: токену SUPABASE_ACCESS_TOKEN нужно право Connection Pooling: Read"
  exit 1
}
```

Общий урок: инструмент, который глотает ошибки («best-effort»), переносит падение туда, где причину уже не
видно. Если от результата такого шага что-то зависит, проверяй результат сам и падай с понятным текстом.

## 5. OIDC: деплой на Pages без токена

У `deploy-admin` нет ни одного секрета, и всё равно он публикует сайт. Работает так:

```yaml
permissions:
  contents: read
  pages: write      # право публиковать Pages этого репозитория
  id-token: write   # право запросить у GitHub OIDC-токен
```

1. `actions/deploy-pages` просит у GitHub подписанный **OIDC-токен** (OpenID Connect): короткоживущий документ
   «я — workflow `guest-bot.yml` из репозитория `AlxTafari/BF-10-fullStack-Vibe`, ветка `main`, прогон N».
2. Сервис Pages проверяет подпись GitHub и публикует артефакт.
3. Токен живёт минуты, хранить его негде и украсть заранее нечего.

Сравни со Supabase: там долгоживущий токен, который нужно создать, сохранить, следить за сроком и пересоздать
при утечке. OIDC умеют и облака (AWS, GCP, Azure): «доверяй workflow из такого-то репозитория» вместо ключа в
Secrets. Supabase так не умеет, поэтому там PAT.

## 6. Environments и права по job'ам

```yaml
deploy:
  environment: production
deploy-admin:
  environment:
    name: github-pages
    url: ${{ steps.pages.outputs.page_url }}
```

**Environment** — именованная цель деплоя в настройках репозитория (Settings → Environments). Что даёт:

- **История.** На главной странице репозитория и во вкладке Environments видно, какой коммит сейчас в prod.
  У `github-pages` рядом ссылка на сайт (`url`).
- **Правила защиты** без правки YAML: ручное подтверждение деплоя (Required reviewers), ограничение веток.
  У `github-pages` GitHub по умолчанию разрешает деплой только из ветки по умолчанию.
- **Свои секреты.** Environment может хранить секреты, видимые только job'ам с этим environment. Мы держим всё
  на уровне репозитория: окружение одно.

`production` создался сам при первом прогоне, `github-pages` — при включении Pages.

**Права — по job'ам.** На уровне workflow `permissions: contents: read`, и только `deploy-admin` получает
`pages: write` и `id-token: write`. Так проверки и тесты не могут ни публиковать сайт, ни получить OIDC-токен,
даже если в зависимостях окажется вредный код.

## 7. Шпаргалка

- Новый секрет для CI → `gh secret set ИМЯ`, в шаге `env: ИМЯ: ${{ secrets.ИМЯ }}`.
- Новое публичное значение → `gh variable set ИМЯ --body значение`, `${{ vars.ИМЯ }}`.
- Значение уходит в браузер (`VITE_*`) → это Variable, не Secret, и в нём не может быть ничего, дающего права.
- Деплой упал с 403 → смотреть `missing_permissions`, создавать новый токен.
- Локальный CLI ругается на токен → нет ли `SUPABASE_ACCESS_TOKEN` в `.env` или окружении shell.
