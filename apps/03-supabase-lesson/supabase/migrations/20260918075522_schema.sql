-- Странная деревня: схема БД (camps, users, news, news_reactions, messages)

create extension if not exists "pgcrypto";

create table camps (
    id   uuid primary key default gen_random_uuid(),
    name text not null
);

create table users (
    id               uuid primary key default gen_random_uuid(),
    tg_id            bigint not null unique,
    name             text,
    camp_id          uuid references camps (id),
    role             text not null default 'user',
    last_message_at  timestamptz
);

create table news (
    id         uuid primary key default gen_random_uuid(),
    author_id  uuid references users (id),
    camp_id    uuid references camps (id),
    text       text not null,
    created_at timestamptz not null default now()
);

create table news_reactions (
    user_id    uuid not null references users (id),
    news_id    uuid not null references news (id),
    reaction_type text not null,
    created_at timestamptz not null default now(),
    unique (user_id, news_id)
);

create table messages (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references users (id),
    direction  text not null check (direction in ('in', 'out')),
    text       text not null,
    created_at timestamptz not null default now()
);

create index news_camp_id_idx on news (camp_id);
create index news_reactions_news_id_idx on news_reactions (news_id);
create index messages_user_id_idx on messages (user_id);
create index users_last_message_at_idx on users (last_message_at desc);

-- Edge Functions ходят через service role (обходит RLS). Политики на будущее,
-- если появится прямой доступ с клиента — по умолчанию доступ для anon/authenticated закрыт.
alter table camps enable row level security;
alter table users enable row level security;
alter table news enable row level security;
alter table news_reactions enable row level security;
alter table messages enable row level security;
