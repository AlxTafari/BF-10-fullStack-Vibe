# 06. Хостинг SPA на GitHub Pages и CSP

Конспект к S08, сессия 3. Job `deploy-admin` в [`.github/workflows/guest-bot.yml`](../../../../../.github/workflows/guest-bot.yml)
(строки 271–357), плагин `cspMeta` и `base` в [`admin/vite.config.ts`](../../../admin/vite.config.ts), `basepath`
в [`admin/src/main.tsx`](../../../admin/src/main.tsx). Адрес админки:
`https://alxtafari.github.io/BF-10-fullStack-Vibe/`.

---

## 1. Почему GitHub Pages, а не Cloudflare Pages

Спека S08 планировала Cloudflare Pages: он умеет свои заголовки ответа (файл `_headers`) и сам отдаёт
`index.html` на любой неизвестный путь. Это закрывает CSP и SPA без обходных путей.

Решено иначе (2026-11-10): учебный проект, цель — понять механику CI/CD на одном инструменте, а не подключать
второй аккаунт, токен и CLI (`wrangler`). GitHub Pages для публичного репозитория бесплатен, а деплой на него
вообще не требует токенов (OIDC, [04](04-secrets-and-environments.md) §5).

Цена — три ограничения Pages. Они не обходятся, а описаны здесь:

| Ограничение | Что сделали | Что потеряли |
|---|---|---|
| Сайт в подпапке `/<репозиторий>/` | `base` в Vite, `basepath` в роутере | ничего |
| Нет SPA-fallback | `404.html` = копия `index.html` | глубокая ссылка открывается со статусом 404 |
| Нельзя задать заголовки ответа | CSP тегом `<meta>` | защиту от встраивания во фрейм, `X-Frame-Options` и прочие заголовки безопасности |

Если админкой начнут пользоваться всерьёз, возврат к хостингу с заголовками (Cloudflare Pages, Netlify,
Vercel) — это смена двух шагов в `deploy-admin` и одного плагина в `vite.config.ts`.

## 2. Как Pages раздаёт сайт

Сайт **проекта** (не пользователя) живёт по адресу `https://<владелец>.github.io/<репозиторий>/`. Pages —
статический хостинг: на запрос `/BF-10-fullStack-Vibe/assets/index-C3QN.js` он ищет файл
`assets/index-C3QN.js` в опубликованном артефакте и отдаёт его. Никакого кода на сервере, никакой логики
маршрутов.

Публикация из workflow (Settings → Pages → Source = GitHub Actions):

```yaml
- uses: actions/upload-pages-artifact@v5     # упаковать dist в артефакт github-pages
  with:
    path: apps/04-05-supabase-lesson/admin/dist
- id: pages
  uses: actions/deploy-pages@v5              # опубликовать артефакт, вернуть адрес в outputs.page_url
```

Ветка `gh-pages` не нужна: это старый способ, когда собранный сайт коммитили в отдельную ветку. Сейчас сайт —
артефакт прогона, в истории git его нет.

## 3. Подпапка: `base` и `basepath`

Vite по умолчанию пишет в `index.html` пути от корня домена: `<script src="/assets/index.js">`. На Pages это
`https://alxtafari.github.io/assets/index.js` — чужое место, 404, белый экран.

Два места должны знать подпапку:

**Vite — пути к файлам.**

```ts
// admin/vite.config.ts
base: process.env.ADMIN_BASE_PATH || "/",
```

```yaml
# deploy-admin, env
ADMIN_BASE_PATH: /${{ github.event.repository.name }}/
```

Локально переменной нет, `base` = `/`, `pnpm dev` работает как раньше. Результат сборки в CI:

```html
<script type="module" crossorigin src="/BF-10-fullStack-Vibe/assets/index-C3QNiff3.js"></script>
```

**Роутер — пути страниц.** Без `basepath` TanStack Router увидит в адресе `/BF-10-fullStack-Vibe/bookings/1`,
не найдёт такого маршрута и покажет «не найдено».

```ts
// admin/src/main.tsx
const router = createRouter({ routeTree, basepath: import.meta.env.BASE_URL });
```

`import.meta.env.BASE_URL` — это `base` из конфига Vite. Одно значение на оба места, разъехаться они не могут.
Роутер отрезает `basepath` от адреса на входе и приклеивает его обратно к каждой ссылке.

### Баг, найденный по пути: `history.push` мимо `basepath`

После входа админка возвращает на страницу, с которой отправили на логин:

```ts
// было
router.history.push(safeRedirect(redirectTo));
// стало
await router.navigate({ href: safeRedirect(redirectTo) });
```

`redirectTo` — внутренний путь роутера, без подпапки (`/bookings/1`). `router.history` — это прямой доступ к
истории браузера, он про `basepath` ничего не знает. `history.push("/bookings/1")` увёл бы на
`https://alxtafari.github.io/bookings/1`: страница отрисовалась бы (роутер нашёл маршрут), но F5 дал бы 404
от GitHub. `router.navigate({ href })` прогоняет путь через `basepath` (проверено в исходниках
`@tanstack/router-core`, `rewriteBasepath`).

Правило: в коде админки ходить по страницам только через роутер (`navigate`, `<Link>`, `redirect`), не через
`history` и не через `window.location`.

## 4. SPA-fallback: `404.html`

Админка — SPA: один `index.html`, а страницы рисует JS по адресу. Адреса `/bookings/1` на диске нет.

| Запрос | Cloudflare Pages | GitHub Pages |
|---|---|---|
| `/` | `index.html`, 200 | `index.html`, 200 |
| `/bookings/1` (F5, ссылка из уведомления) | `index.html`, 200 — сам понимает SPA | файла нет → `404.html`, **статус 404** |

Решение — положить в сборку `404.html`, который является копией `index.html`:

```yaml
cp admin/dist/index.html admin/dist/404.html
```

Pages отдаёт его на любой несуществующий путь. Браузер загружает те же скрипты, роутер читает адрес и
рисует карточку заявки. Пользователь разницы не видит.

Что остаётся неправильным: **HTTP-статус 404** у страницы, которая на самом деле есть. Человеку всё равно, а
для поисковиков и мониторинга такая страница «не существует». Для закрытой админки это неважно. Smoke это
и проверяет: `/bookings/smoke` → 404 + наша разметка с `id="root"`.

## 5. CSP: что это и зачем

**Content Security Policy** — список, откуда браузеру разрешено грузить скрипты, стили, картинки и куда
ходить запросами. Всё, что не в списке, браузер блокирует.

Главная угроза для админки — XSS: гость пишет в бронь текст с `<script>`, менеджер открывает заявку. Первый
рубеж — React выводит тексты гостей только как текст (S05, S06). CSP — второй: даже если где-то текст
вставится как HTML, браузер не выполнит inline-скрипт и не отправит данные на чужой адрес.

### Наша политика

Собирается плагином `cspMeta` в `vite.config.ts`, адрес Supabase берётся из `VITE_SUPABASE_URL` той же сборки:

| Директива | Значение | Что ломается, если убрать или ошибиться |
|---|---|---|
| `default-src` | `'self'` | всё, что не указано ниже, — только с адреса админки |
| `script-src` | `'self'` | **без** `'unsafe-inline'` и `'unsafe-eval'`: inline `<script>` и `eval` заблокированы — ради этого CSP и делается |
| `style-src` | `'self' 'unsafe-inline'` | без `'unsafe-inline'` тосты без стилей: sonner вставляет `<style>` из JS (подтверждено в `node_modules/sonner`) |
| `connect-src` | `'self' https://<ref>.supabase.co wss://<ref>.supabase.co` | без `https://` — ни одного запроса к API; без `wss://` — нет Realtime, заявки без F5 не появляются |
| `img-src` | `'self' data: https:` | фото блюд по внешним ссылкам |
| `font-src` | `'self'` | шрифты только свои |
| `object-src` | `'none'` | `<object>`/`<embed>` — старый путь для выполнения кода |
| `base-uri` | `'self'` | внедрённый `<base href>` подменил бы адреса всех относительных ссылок |
| `form-action` | `'self'` | внедрённая форма не отправит данные на чужой сервер |

Адрес Supabase не захардкожен: сборка под другой проект получит свой `connect-src`. Без `VITE_SUPABASE_URL`
(job `checks`) тег не добавляется, сборка только проверяет код. `deploy-admin` отдельно проверяет, что CSP
под нужный проект в `dist/index.html` есть.

## 6. CSP тегом `<meta>` и чего он не умеет

Обычно CSP — **заголовок ответа** сервера: `Content-Security-Policy: …`. Pages свои заголовки задавать не даёт,
поэтому политика едет в HTML:

```html
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; …">
  <meta charset="UTF-8" />
```

Плагин ставит тег **первым** в `<head>` (`injectTo: "head-prepend"`): политика действует только на то, что
браузер встретил после неё. Скрипт выше тега загрузился бы без проверки. В собранном файле кавычки
экранированы (`&#39;self&#39;`) — это нормально, браузер читает атрибут уже раскодированным. Проверка в
workflow ищет именно экранированную строку.

**Что `<meta>` не умеет** (по спецификации CSP браузер это игнорирует):

- **`frame-ancestors`** — кому разрешено встраивать страницу во `<iframe>`. Нет защиты от clickjacking: чужой
  сайт может показать админку в невидимом фрейме и подсунуть менеджеру клик по кнопке «Подтвердить».
- **`report-uri` / `report-to`** — отправка отчётов о нарушениях на сервер. Нарушения видно только в консоли
  того, у кого они случились.
- **`sandbox`**.

Остальные заголовки безопасности тегом не задаются вовсе: `X-Frame-Options` (старый аналог `frame-ancestors`),
`X-Content-Type-Options: nosniff`, `Referrer-Policy`. С Cloudflare `_headers` они были бы.

Для учебной админки с одним менеджером риск clickjacking принят: атакующему нужно знать адрес, заманить
залогиненного менеджера на свою страницу и угадать раскладку интерфейса. Для настоящего продукта это
повод для хостинга с заголовками.

## 7. Как читать нарушения CSP

DevTools → Console. Нарушение выглядит так:

```
Refused to connect to 'https://other.supabase.co/rest/v1/…' because it violates the following
Content Security Policy directive: "connect-src 'self' https://xzbxalxqeehtcwleoudw.supabase.co …".
```

Читается по частям: **что** заблокировано (`connect to`, `load the script`, `apply inline style`), **какой
адрес**, **какая директива**. Дальше два вопроса: этот адрес должен быть разрешён (дописать в политику) или это
лишний запрос (убрать из кода)?

Признаки в интерфейсе:

| Симптом | Скорее всего |
|---|---|
| Белый экран, в Console 404 на `/assets/…` | сборка без `ADMIN_BASE_PATH`, не CSP |
| Белый экран, в Console `Refused to load the script` | CSP режет скрипт: проверить `script-src` и что тег стоит первым |
| Вход не работает, `Refused to connect` | `connect-src` не от того проекта: `VITE_SUPABASE_URL` ≠ проект |
| Заявки появляются только после F5 | заблокирован `wss://`: Network → WS, соединение `realtime` не в статусе 101 |
| Тосты без оформления | `style-src` без `'unsafe-inline'` |

Проверка после деплоя (шаг Е3 чек-листа): Elements → первый тег `<head>` — `<meta http-equiv=…>`, Console без
нарушений, Network → WS → `wss://<ref>.supabase.co/realtime/…` в статусе 101.

## 8. Шпаргалка

- Добавил внешний сервис, к которому ходит админка → дописать его в `connect-src` (или `img-src`) в `cspMeta`.
- Добавил библиотеку, которая вставляет `<style>` или `<script>` → проверить Console на нарушения до деплоя:
  `pnpm build` с `VITE_SUPABASE_URL` и `vite preview`.
- Навигация в коде → только через роутер, не через `history` и `window.location`.
- Нужны настоящие заголовки безопасности → хостинг с заголовками; на GitHub Pages их не будет.
