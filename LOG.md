## 2026-09-02 — Каркас Telegram-бота конвертера валют

**Цель:** собрать простого бота: во входящем тексте ищет коды валют, отвечает
курсом к USD; два кода — кросс-курс. Чистая архитектура, Fastify, webhook, деплой позже.

**Решения:**
- Транспорт: webhook (long polling на serverless не живёт). Секрет через
  `secret_token` Telegram + проверка заголовка `X-Telegram-Bot-Api-Secret-Token`.
- Telegram — голый `fetch`, без SDK (адаптер `telegramMessenger`).
- Провайдер курсов через порт `RatesProvider`: `openExchangeRatesProvider` (основной,
  нужен ключ, база USD) + `frankfurterProvider` (без ключа, запасной). Выбор — env
  `RATES_PROVIDER`. Ответ кешируется в памяти.
- Слои: domain → application (use cases, порты, rateMath, parsing, replyText) →
  adapters. Composition root — `container.ts` + `server.ts`. `api/index.ts` — вход Vercel.
- Кросс-курс считается через общую базу: `crossRate = unitsPerBase(to) / unitsPerBase(from)`.
- Распознавание кодов — белый список (`KNOWN_CURRENCY_CODES`), чтобы «THE», «FOR» не
  считались валютами.
- Тесты: vitest (14 шт) — parsing, use cases, роутинг `handleIncomingMessage`.
  vitest 4 (rolldown) падал на нативном биндинге — откат на vitest 3.
- C4-диаграммы (context/container/component) — `docs/architecture.md`, Mermaid.

**Проверено:**
- `tsc --noEmit` — чисто; `npm test` — 14/14; `npm run build` — ок.
- Smoke: `/health` 200, `/webhook` без секрета 401, с секретом 200.
- Живой запрос к Frankfurter — курсы приходят, математика сходится.

**Осталось:**
- Пользователь: получить `OXR_APP_ID`, вписать в `.env` и в переменные хостинга.
- Деплой (делает пользователь), затем `npm run set-webhook` с боевым URL.
- Подключить публичный репозиторий.
- По желанию: команда переключения провайдера на лету, ещё источники.

## 2026-09-02 (2) — Фичи: меню, /rates, /source, флаги, суммы, словарь

**Цель:** добавить функционал без переусложнения (см. docs/ideas.md).

**Сделано:**
- `src/domain/currencies.ts` — справочник: код → флаг, рус. название, синонимы.
  `KNOWN_CURRENCY_CODES`, `ALIAS_TO_CODE`, `POPULAR_CODES` выводятся из него.
- `toCurrencyCode` теперь резолвит и синонимы («евро», «долларов», «в юанях»).
- `extractCurrencyCodes` → `parseCurrencyQuery`: возвращает `{ amount, codes }`.
  Регэксп по терминам с lookaround (кириллица + `\b` не дружат), число перед
  первой валютой. Разделители тысяч не поддерживаются осознанно.
- Use cases `getRateAgainstUsd` / `convertCurrency` приняли опциональный `amount`.
- Новые use cases: `getPopularRates` (/rates), `getRatesSource` (/source).
- `replyText`: флаги валют, строка суммы, форматтеры popular/source.
- `handleIncomingMessage`: команды через `parseCommand` (чистит `@botname` для групп),
  ветка «только USD» → подсказка про базу.
- Новая ошибка `RateNotAvailableError` (валюта известна нам, но нет у провайдера,
  напр. RUB у Frankfurter) — отдельное сообщение вместо «источник недоступен».
- `scripts/setCommands.ts` + `npm run set-commands` — меню команд (`setMyCommands`).
- Тесты: 31 (было 14). Диаграмма компонентов и README обновлены.

**Проверено:** tsc чисто, 31/31, build ок. Живой прогон handler через OXR:
EUR, «100 евро в долларах», «5000 рублей в юанях», /rates, /source, USD, мусор — ок.

**Осталось:**
- Пользователь: `npm run set-commands` (меню), редеплой с новым кодом.
- Webhook перерегистрировать не нужно (URL прежний).

## 2026-09-02 (3) — Инфраструктура: CI + заглушка на корень

**Цель:** довести репозиторий до вида «публичный» для сдачи.

**Сделано:**
- `.github/workflows/ci.yml` — на push в main и на PR: `npm ci` → `npm run typecheck`
  → `npm test`. Node 20, кеш npm.
- `GET /` в `src/server.ts` — раньше Vercel-rewrite вёл сюда любой GET и Fastify
  отдавал 500 (нет роута). Теперь `{ ok, bot, repo }`.

**Проверено:** tsc чисто, 31/31.
