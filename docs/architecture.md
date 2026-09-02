# Архитектура — C4

Диаграммы в нотации [C4 model](https://c4model.com), исходники — PlantUML
([C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML)).

Файлы:
- [`c4-context.puml`](c4-context.puml) — уровень 1, System Context
- [`c4-container.puml`](c4-container.puml) — уровень 2, Containers
- [`c4-component.puml`](c4-component.puml) — уровень 3, Components

## Как отрисовать

- **VS Code:** расширение *PlantUML* (`jebbs.plantuml`), `Alt+D` — превью.
- **CLI:** `plantuml docs/*.puml` (нужна Java) — получить PNG/SVG.
- **Онлайн:** вставить содержимое файла на <https://www.plantuml.com/plantuml>.
- `!include` тянет C4-PlantUML с GitHub — нужен доступ в сеть при первом рендере.

## Уровень 1 — System Context

Кто пользуется системой и с какими внешними сервисами она общается.

```plantuml
@startuml C4_Context
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/latest/C4_Context.puml

title Currency Converter Bot — System Context

Person(user, "Пользователь Telegram", "Пишет боту код валюты в свободном тексте")
System(bot, "Currency Converter Bot", "Находит в тексте коды валют и отвечает курсом к USD либо кросс-курсом двух валют")
System_Ext(tg, "Telegram Bot API", "Доставляет апдейты через webhook, принимает ответы бота")
System_Ext(oxr, "Open Exchange Rates", "Курсы валют, база USD (основной источник)")
System_Ext(frank, "Frankfurter API", "Курсы ЕЦБ, без ключа (альтернативный источник)")

Rel(user, tg, "Сообщение с кодом валюты")
Rel(tg, bot, "HTTPS POST /webhook (Update)")
Rel(bot, tg, "sendMessage", "HTTPS")
Rel(bot, oxr, "GET /latest.json", "HTTPS")
Rel(bot, frank, "GET /v1/latest", "HTTPS")

SHOW_LEGEND()
@enduml
```

## Уровень 2 — Containers

Приложение — один деплой-юнит (serverless-функция / Node-процесс). «Контейнеры»
здесь логические: транспорт, ядро и внешние адаптеры в одном рантайме.

```plantuml
@startuml C4_Container
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/latest/C4_Container.puml

title Currency Converter Bot — Containers

Person(user, "Пользователь Telegram")
System_Ext(tg, "Telegram Bot API")
System_Ext(rates, "Провайдер курсов", "Open Exchange Rates | Frankfurter")

System_Boundary(app, "Currency Converter Bot") {
    Container(http, "HTTP-адаптер", "Fastify", "POST /webhook: проверка секрета, маппинг Update, вызов use case. GET /health")
    Container(core, "Ядро приложения", "TypeScript", "Use cases, доменные правила, порты RatesProvider / Messenger")
    Container(adapters, "Внешние адаптеры", "fetch", "TelegramMessenger, OxrProvider, FrankfurterProvider (кеш в памяти)")
}

Rel(user, tg, "Пишет сообщение")
Rel(tg, http, "Update", "HTTPS + secret_token")
Rel(http, core, "handleIncomingMessage()")
Rel(core, adapters, "через порты-интерфейсы")
Rel(adapters, tg, "sendMessage", "HTTPS")
Rel(adapters, rates, "latest rates", "HTTPS")

SHOW_LEGEND()
@enduml
```

## Уровень 3 — Components (ядро приложения)

```plantuml
@startuml C4_Component
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/latest/C4_Component.puml

title Currency Converter Bot — Components (ядро приложения)

System_Ext(http, "HTTP-адаптер", "Fastify")
System_Ext(rates, "Провайдер курсов", "OXR | Frankfurter")
System_Ext(tg, "Telegram Bot API")

Container_Boundary(core, "Ядро приложения") {
    Component(handle, "handleIncomingMessage", "use case", "Роутинг: /help · /rates · /source · 1 валюта · 2 валюты · сумма")
    Component(parse, "parseCurrencyQuery", "parsing", "Достаёт валюты (коды + синонимы) и сумму из текста")
    Component(dict, "currencies", "domain", "Справочник: код, флаг, рус. название, синонимы")
    Component(rateUsd, "getRateAgainstUsd", "use case", "Курс валюты к USD (+ сумма)")
    Component(convert, "convertCurrency", "use case", "Кросс-курс / конвертация суммы")
    Component(popular, "getPopularRates", "use case", "Корзина популярных валют к USD (/rates)")
    Component(src, "getRatesSource", "use case", "Активный провайдер и дата данных (/source)")
    Component(math, "rateMath", "domain logic", "unitsPerBase, crossRate")
    Component(reply, "replyText", "presentation", "Форматирование ответов, флаги валют")
    Component(portRates, "RatesProvider", "port (interface)", "getSnapshot()")
    Component(portMsg, "Messenger", "port (interface)", "sendMessage()")
}

Rel(http, handle, "вызывает")
Rel(handle, parse, "разбор текста")
Rel(parse, dict, "коды и синонимы")
Rel(reply, dict, "флаги")
Rel(handle, rateUsd, "одна валюта")
Rel(handle, convert, "две валюты")
Rel(handle, popular, "/rates")
Rel(handle, src, "/source")
Rel(handle, reply, "форматирование")
Rel(handle, portMsg, "sendMessage")
Rel(rateUsd, math, "")
Rel(convert, math, "")
Rel(popular, math, "")
Rel(rateUsd, portRates, "getSnapshot")
Rel(convert, portRates, "getSnapshot")
Rel(popular, portRates, "getSnapshot")
Rel(src, portRates, "getSnapshot")
Rel(portRates, rates, "реализация: fetch + кеш")
Rel(portMsg, tg, "реализация: fetch")

SHOW_LEGEND()
@enduml
```

## Слои и правило зависимостей

```
domain/         ← ни от кого не зависит (CurrencyCode, ошибки)
application/    ← зависит только от domain (use cases, порты, rateMath, parsing, replyText)
adapters/      ← реализуют порты application (telegram/*, rates/*)
config, container, server, api/  ← composition root, знают про всё
```

Зависимости направлены внутрь: `adapters → application → domain`.
Use case не импортирует ничего из `adapters/` — только порты-интерфейсы.
