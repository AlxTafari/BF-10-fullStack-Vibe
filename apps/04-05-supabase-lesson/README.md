# Гостевой бот ресторана

Telegram-бот на Supabase Edge Functions. Документация реализации — `docs/` (начинать с `docs/STATE.md`).

## Уведомления менеджеру о заявках (S03)

Бот шлёт менеджеру сообщение о каждой новой заявке на бронь и обращении. Куда слать — колонка `restaurants.manager_chat_id`; личный id в seed не коммитим, ставится вручную в каждом проекте Supabase.

1. Менеджер пишет боту `/start` — иначе Telegram не даст боту написать первым.
2. Узнать chat id: открыть `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` и найти `message.chat.id` в сообщении менеджера (токен нигде не публиковать).
3. Выставить в SQL Editor дашборда Supabase:
   ```sql
   update restaurants set manager_chat_id = 123456789;
   ```

Пока `manager_chat_id` пуст, заявки сохраняются, а `manager_notified_at` остаётся `null` (в логах функции — предупреждение).

## Часы работы и бронь

Проверка брони использует `restaurants.opening_hours` (jsonb: ключ — ISO-день недели `"1"`…`"7"`, значение `{"open":"13:00","close":"24:00"}`, нет ключа = выходной, `null` = без ограничений). Свободный текст `working_hours` показывается гостю в «О ресторане». Правка из админки — S04, пока — через seed/SQL.

## Тесты

```bash
cd supabase/functions
deno test --allow-env                       # домен; интеграционный тест пропускается без SUPABASE_URL
deno test --allow-env --allow-net --allow-read --env-file=../../.env   # с интеграционным тестом идемпотентности (dev-БД)
```
