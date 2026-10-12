-- Гостевой бот ресторана: схема БД (MVP-план §4).
-- RLS включён везде, политик нет: Edge Functions ходят через service role (обходит RLS).
-- Политики для менеджера (Supabase Auth) добавляются в S04.

create extension if not exists "pgcrypto";

-- Общий триггер: обновляет updated_at при любом UPDATE.
create function set_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ---------------------------------------------------------------- ресторан

create table restaurants (
    id            uuid primary key default gen_random_uuid(),
    name          text not null,
    description   text,
    address       text,
    phone         text,
    email         text,
    timezone      text not null default 'Europe/Moscow',
    -- Свободный текст для показа гостю («Пн–Вс 12:00–23:00»). Структурированные часы — когда понадобится валидация брони.
    working_hours text,
    -- Правила посещения (дети, животные, дресс-код и т.п.).
    visit_rules   text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table faq_entries (
    id            uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references restaurants (id) on delete cascade,
    question      text not null,
    answer        text not null,
    sort_order    int  not null default 0,
    is_published  boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index faq_entries_restaurant_idx on faq_entries (restaurant_id, sort_order);

-- ---------------------------------------------------------------- меню

create table menu_categories (
    id            uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references restaurants (id) on delete cascade,
    name          text not null,
    sort_order    int  not null default 0,
    created_at    timestamptz not null default now()
);

create index menu_categories_restaurant_idx on menu_categories (restaurant_id, sort_order);

-- Гостевая карточка блюда. Неизвестные значения — null, не ноль (КБЖУ на порцию).
create table menu_items (
    id                  uuid primary key default gen_random_uuid(),
    restaurant_id       uuid not null references restaurants (id) on delete cascade,
    category_id         uuid references menu_categories (id) on delete set null,
    external_id         text,                       -- связь с My-Rest в будущем
    name                text not null,
    description         text,
    price               numeric(10, 2) not null check (price >= 0),
    currency            text not null default 'RUB',
    photo_url           text,
    ingredients         text,                       -- опубликованный состав
    allergens           text[],                     -- указанные аллергены; null = не указано, '{}' = указано «нет»
    portion_grams       int check (portion_grams > 0),
    kcal_per_portion    numeric(7, 1) check (kcal_per_portion >= 0),
    protein_per_portion numeric(7, 1) check (protein_per_portion >= 0),
    fat_per_portion     numeric(7, 1) check (fat_per_portion >= 0),
    carbs_per_portion   numeric(7, 1) check (carbs_per_portion >= 0),
    is_published        boolean not null default false,   -- видимость в меню
    is_available        boolean not null default true,    -- текущая доступность (стоп-лист вручную)
    source              text not null default 'manual' check (source in ('manual', 'my_rest')),
    source_updated_at   timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index menu_items_category_idx on menu_items (restaurant_id, category_id);
-- Ключ для будущего импорта из My-Rest: restaurant_id + external_id.
create unique index menu_items_external_uidx on menu_items (restaurant_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------- диалоги

create table conversations (
    id               uuid primary key default gen_random_uuid(),
    restaurant_id    uuid not null references restaurants (id) on delete cascade,
    channel          text not null default 'telegram',
    external_user_id bigint not null,               -- id пользователя в канале (Telegram user id)
    chat_id          bigint not null,               -- куда отвечать
    display_name     text,
    -- Состояние пошагового сценария (бронь, обращение) — машина состояний в S03.
    state            jsonb not null default '{}'::jsonb,
    last_message_at  timestamptz,
    created_at       timestamptz not null default now(),
    unique (restaurant_id, channel, external_user_id)
);

create table messages (
    id              uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations (id) on delete cascade,
    direction       text not null check (direction in ('in', 'out')),
    text            text not null,
    created_at      timestamptz not null default now()
);

-- Курсорная пагинация чата (ADR-005): порядок (created_at desc, id desc) внутри диалога.
create index messages_cursor_idx on messages (conversation_id, created_at desc, id desc);

-- Идемпотентность входящих апдейтов (ADR-006): update_id Telegram уникален, повтор не обрабатываем.
create table processed_updates (
    update_id  bigint primary key,
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- заявки (заполняются в S03)

create table booking_requests (
    id              uuid primary key default gen_random_uuid(),
    restaurant_id   uuid not null references restaurants (id) on delete cascade,
    conversation_id uuid references conversations (id) on delete set null,
    guest_name      text not null,
    contact         text not null,
    booking_at      timestamptz not null,
    guests_count    int not null check (guests_count > 0),
    comment         text,
    status          text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
    -- Защита от дубля при повторной обработке одного и того же подтверждения гостя (ADR-006).
    idempotency_key text not null unique,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index booking_requests_status_idx on booking_requests (restaurant_id, status, created_at desc);

create table guest_requests (
    id              uuid primary key default gen_random_uuid(),
    restaurant_id   uuid not null references restaurants (id) on delete cascade,
    conversation_id uuid references conversations (id) on delete set null,
    kind            text not null check (kind in ('feedback', 'complaint', 'manager_request')),
    text            text not null,
    contact         text,                           -- нужен, если гость ждёт ответа
    status          text not null default 'new'
                    check (status in ('new', 'in_progress', 'resolved')),
    idempotency_key text not null unique,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index guest_requests_status_idx on guest_requests (restaurant_id, status, created_at desc);

-- ---------------------------------------------------------------- триггеры updated_at

create trigger restaurants_updated_at     before update on restaurants     for each row execute function set_updated_at();
create trigger faq_entries_updated_at     before update on faq_entries     for each row execute function set_updated_at();
create trigger menu_items_updated_at      before update on menu_items      for each row execute function set_updated_at();
create trigger booking_requests_updated_at before update on booking_requests for each row execute function set_updated_at();
create trigger guest_requests_updated_at  before update on guest_requests  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- RLS

alter table restaurants       enable row level security;
alter table faq_entries       enable row level security;
alter table menu_categories   enable row level security;
alter table menu_items        enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;
alter table processed_updates enable row level security;
alter table booking_requests  enable row level security;
alter table guest_requests    enable row level security;
