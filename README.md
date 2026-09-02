# Currency Converter Telegram Bot

Telegram-бот: находит во входящем тексте валюту (код ISO 4217 или название —
«евро», «долларов», «в юанях») и отвечает курсом относительно доллара США.
Две валюты — кросс-курс. Число перед валютой — конвертация суммы.

- **Backend:** Fastify (webhook)
- **Telegram:** голый `fetch` к Bot API, без SDK
- **Курсы:** [Open Exchange Rates](https://openexchangerates.org) (основной) /
  [Frankfurter](https://frankfurter.dev) (альтернативный) — переключается env-переменной
- **Архитектура:** чистая (domain / application / adapters), см. [docs/architecture.md](docs/architecture.md)

## Как работает

```
Пользователь → Telegram → POST /webhook → Fastify-адаптер
  → handleIncomingMessage (use case)
     → parseCurrencyQuery           (валюты + сумма из текста, справочник currencies)
     → getRateAgainstUsd | convertCurrency | getPopularRates | getRatesSource
        → RatesProvider.getSnapshot (порт → OXR / Frankfurter)
     → Messenger.sendMessage        (порт → Telegram Bot API)
```

Роутинг сообщения:

| Ввод | Ответ |
|------|-------|
| `/start`, `/help` | справка |
| `/rates` | курсы корзины популярных валют к USD |
| `/source` | активный источник курсов и дата данных |
| `EUR`, `курс евро`, `сколько стоит иена` | курс валюты к USD (прямой и обратный) |
| `EUR GBP`, `евро в фунтах` | кросс-курс EUR↔GBP |
| `100 EUR в USD`, `5000 рублей в юанях` | конвертация суммы |
| `USD` | подсказка: доллар — база отсчёта |
| валюты нет у провайдера (напр. RUB у Frankfurter) | отдельное сообщение |
| валюта не распознана / нет валют | подсказка |

## Структура

```
src/
  domain/          CurrencyCode, currencies (флаги/названия/синонимы), ошибки
  application/
    ports/         RatesProvider, Messenger (интерфейсы)
    useCases/      handleIncomingMessage, getRateAgainstUsd, convertCurrency,
                   getPopularRates, getRatesSource
    parsing/       parseCurrencyQuery (валюты + сумма)
    rateMath.ts    unitsPerBase, crossRate (чистая математика курсов)
    replyText.ts   тексты ответов, флаги
  adapters/
    telegram/      telegramMessenger, mapUpdate, telegramTypes
    rates/         openExchangeRatesProvider, frankfurterProvider, createRatesProvider
  config.ts        чтение env
  container.ts     composition root (сборка зависимостей)
  server.ts        Fastify-приложение (buildApp)
  index.ts         локальный запуск (listen)
api/index.ts       точка входа для Vercel (serverless)
scripts/           setWebhook / deleteWebhook / setCommands
test/              vitest — parsing, use cases, роутинг
docs/               C4-диаграммы PlantUML (*.puml) + architecture.md
```

## Локальный запуск

```bash
npm install
cp .env.example .env      # заполнить BOT_TOKEN, WEBHOOK_SECRET, OXR_APP_ID
npm run dev               # Fastify на :3000
```

Локально Telegram не достучится до `localhost` — либо прокинуть туннель
(`cloudflared` / `ngrok`) и зарегистрировать webhook, либо гонять use case'ы тестами.

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # -> dist/
```

## Провайдер курсов

`RATES_PROVIDER` в env:

- `oxr` (по умолчанию) — Open Exchange Rates. Нужен `OXR_APP_ID`
  (бесплатный ключ: https://openexchangerates.org/signup/free).
  Бесплатный тариф: база USD, обновление раз в час, ~1000 запросов/мес.
- `frankfurter` — без ключа, данные ЕЦБ, обновление раз в сутки по будням.

Ответ провайдера кешируется в памяти (OXR — 10 мин, Frankfurter — 30 мин),
чтобы не жечь лимит запросов.

## Деплой

Любой хостинг, где крутится Node ≥ 20. Нужен публичный HTTPS-URL для webhook.

**Vercel:** `api/index.ts` — готовая serverless-функция, `vercel.json` заворачивает
все пути на неё. Переменные окружения — в настройках проекта.

**VPS / Railway / Render / Fly:** `npm run build && npm start` (слушает `PORT`).

После деплоя — зарегистрировать webhook (один раз):

```bash
WEBHOOK_URL=https://<домен>/webhook npm run set-webhook
```

Секрет из `WEBHOOK_SECRET` уходит в Telegram как `secret_token`; каждый входящий
запрос на `/webhook` проверяется по заголовку `X-Telegram-Bot-Api-Secret-Token`.

Меню команд рядом с полем ввода (один раз, необязательно):

```bash
npm run set-commands
```

## Отступление от чистой архитектуры (осознанное)

`replyText.ts` (тексты ответов) лежит в `application`, хотя это слой представления.
Для бота такого размера отдельный presenter-порт — оверинжиниринг. Тексты —
чистые функции без привязки к Telegram, при желании выносятся легко.
