# Гостевой бот ресторана

Telegram-бот на Supabase Edge Functions. Документация реализации — `docs/` (начинать с `docs/STATE.md`).

## Админка (S04)

Каталог `admin/` — Vite + React + TypeScript, вход по email и паролю через Supabase Auth. Своего сервера нет: браузер ходит в Supabase с anon-ключом, права ограничивает RLS.

```bash
cp admin/.env.example admin/.env.local   # URL проекта и anon-ключ (Project Settings → API)
pnpm dev:admin                           # http://localhost:5173
```

В `admin/.env.local` — только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. **Service-role ключ сюда не класть никогда**: всё из `VITE_*` попадает в бандл браузера.

### Как завести менеджера

Самостоятельной регистрации нет (`enable_signup = false`; для удалённого проекта то же — Authentication → Sign In / Providers → отключить «Allow new users to sign up»). Менеджера заводит владелец проекта. Пользователь Auth — ещё не менеджер: доступ даёт строка в `restaurant_managers`.

1. Dashboard → Authentication → Users → «Add user» (email + пароль, «Auto Confirm User»). Скопировать `User UID`.
2. SQL Editor:
   ```sql
   insert into restaurant_managers (user_id, restaurant_id)
   values ('<User UID>', (select id from restaurants order by created_at limit 1));
   ```

Без второго шага пользователь войдёт, но увидит «Нет доступа к ресторану» и ни одной строки данных. Один пользователь — один ресторан.

### Как узнать `manager_chat_id`

Поле «Telegram chat id менеджера» на экране «Ресторан». Менеджер сначала пишет боту `/start`, затем chat id берётся из `getUpdates` — шаги в разделе «Уведомления менеджеру» ниже. Пустое поле = уведомления выключены.

### Проверки админки

```bash
pnpm typecheck:admin && pnpm lint:admin && pnpm test:admin && pnpm build:admin
pnpm check:layers:admin     # правило зависимостей слоёв (ADR-008)
```

`pnpm test:admin` включает интеграционный тест RLS (`admin/tests/rls.integration.test.ts`) против dev-БД: аноним, посторонний пользователь и менеджер чужого ресторана пытаются читать и писать мимо интерфейса. Ему нужны `SUPABASE_URL`, `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY` из `.env` в корне приложения (тот же файл, что у бота); без service-role ключа тест пропускается. Тест создаёт свои рестораны и пользователей (`rls-test-…`, `rls-*@example.test`) и удаляет их в конце. Перед приёмкой и после любых правок RLS-политик запускайте его.

Ключ не должен попадать в код приложения: `grep -riE service_role admin/src admin/dist` — пусто (ключ упоминается только в `vite.config.ts` и `tests/`, которые в бандл не входят).

## Уведомления менеджеру о заявках (S03)

Бот шлёт менеджеру сообщение о каждой новой заявке на бронь и обращении. Куда слать — колонка `restaurants.manager_chat_id`; личный id в seed не коммитим, ставится вручную в каждом проекте Supabase.

1. Менеджер пишет боту `/start` — иначе Telegram не даст боту написать первым.
2. Узнать chat id: открыть `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` и найти `message.chat.id` в сообщении менеджера (токен нигде не публиковать).
3. Выставить в SQL Editor дашборда Supabase:
   ```sql
   update restaurants set manager_chat_id = 123456789;
   ```

Пока `manager_chat_id` пуст, заявки сохраняются, а `manager_notified_at` остаётся `null` (в логах функции — предупреждение).

## Уведомления гостю о решении по брони (S05)

Когда менеджер подтверждает, отклоняет или отменяет бронь в админке, RPC `set_booking_status` обновляет статус, триггер БД через `pg_net` вызывает Edge Function `notify-guest`, а она пишет гостю в Telegram. Гостю не пишем, если время брони уже наступило, если бронь отменил сам гость и при каскадной отмене исходной брони.

Настройка проекта (один раз, значение секрета в чат и в git не попадает):

1. Придумать длинный случайный секрет и выставить его функции: `supabase secrets set NOTIFY_GUEST_SECRET=<секрет> --project-ref <ref>`.
2. Задеплоить функцию: `supabase functions deploy notify-guest --project-ref <ref>` (`verify_jwt = false` в `config.toml`: вызов идёт из БД, защищён заголовком `x-notify-secret`).
3. Положить в Vault (SQL Editor дашборда, либо `supabase db query --linked -f файл.sql` из временного файла):
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-guest', 'notify_guest_url');
   select vault.create_secret('<тот же секрет>', 'notify_guest_secret');
   ```

Пока Vault пуст, статус меняется как обычно, а триггер лишь пишет `warning`; у заявки в админке появляется метка «гость не уведомлён».

## Часы работы и бронь

Проверка брони использует `restaurants.opening_hours` (jsonb: ключ — ISO-день недели `"1"`…`"7"`, значение `{"open":"13:00","close":"24:00"}`, нет ключа = выходной, `null` = без ограничений). Свободный текст `working_hours` показывается гостю в «О ресторане». Правка — на экране «Ресторан» админки.

## Тесты

```bash
cd supabase/functions
deno test --allow-env                       # домен; интеграционный тест пропускается без SUPABASE_URL
deno test --allow-env --allow-net --allow-read --env-file=../../.env   # с интеграционным тестом идемпотентности (dev-БД)
```
