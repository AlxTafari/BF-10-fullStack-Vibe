# Монорепо учебных проектов

[![CI](https://github.com/AlxTafari/BF-10-fullStack-Vibe/actions/workflows/ci.yml/badge.svg)](https://github.com/AlxTafari/BF-10-fullStack-Vibe/actions/workflows/ci.yml)
[![Guest bot](https://github.com/AlxTafari/BF-10-fullStack-Vibe/actions/workflows/guest-bot.yml/badge.svg)](https://github.com/AlxTafari/BF-10-fullStack-Vibe/actions/workflows/guest-bot.yml)

## Проекты

| Папка | Описание | Бот | Стек |
|---|---|---|---|
| [01-currency-bot](apps/01-currency-bot/) | Находит валюту в тексте сообщения и отвечает курсом, кросс-курсом или конвертацией суммы | [@whatsupcurrencybot](https://t.me/whatsupcurrencybot) | Node, TypeScript, Fastify |
| [02-supabase-lesson](apps/02-supabase-lesson/) | Знакомство с Supabase Edge Functions: функция `hello` | — | Supabase, Deno |
| [03-supabase-lesson](apps/03-supabase-lesson/) | Текстовая игра «Странная деревня»: персонаж, локации, хроника вестей с реакциями | [@pg_village_bot](https://t.me/pg_village_bot) | Supabase, Edge Functions |
| [04-07-supabase-lesson](apps/04-07-supabase-lesson/) | Гостевой бот ресторана (меню, бронь, обращения, AI-ассистент) + [админка](apps/04-07-supabase-lesson/admin/) для менеджера: заявки, чат с гостями | [@myrest_guest_bot](https://t.me/myrest_guest_bot) | Supabase, Edge Functions, Vite, React |

## Требования

- Node ≥ 20
- pnpm
- [Supabase CLI](https://supabase.com/docs/guides/cli) и Docker: для проектов 02–07

## Быстрый старт

```bash
pnpm install
```

Переменные окружения: в каждом проекте лежит `.env.example`, его нужно скопировать в `.env` (у админки в `.env.local`) и заполнить.

| Проект | Запуск |
|---|---|
| 01 | `pnpm dev:bot` |
| 02 | `pnpm start:supabase`, потом `pnpm serve:supabase` |
| 03 | `pnpm start:village`, потом `pnpm serve:village` |
| 04-07 | `pnpm start:rest`, потом `pnpm serve:rest` |
| админка | `pnpm dev:admin`: http://localhost:5173 |

Все скрипты лежат в корневом `package.json`, суффикс указывает на проект: `:bot`, `:supabase`, `:village`, `:rest`, `:admin`.

## Структура

```
apps/
  01-currency-bot/
  02-supabase-lesson/
  03-supabase-lesson/
  04-07-supabase-lesson/
    admin/          # отдельный пакет workspace
    docs/           # документация проекта, начинать с docs/STATE.md
.github/workflows/  # CI: ci.yml для 01, guest-bot.yml для 04-07
```
