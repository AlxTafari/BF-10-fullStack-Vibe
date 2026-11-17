-- S04: менеджер ресторана (Supabase Auth) и первые RLS-политики.
-- Принцип наименьших прав: только справочники. Заявки и чат — S05/S06.
-- Бот ходит под service role и RLS не замечает.

-- Членство явное: пользователь auth.users ≠ менеджер ресторана.
-- user_id — PK: один пользователь — один ресторан (для нескольких — сменить PK на пару).
create table restaurant_managers (
    user_id       uuid primary key references auth.users (id) on delete cascade,
    restaurant_id uuid not null references restaurants (id) on delete cascade,
    created_at    timestamptz not null default now()
);
alter table restaurant_managers enable row level security;

-- security definer: restaurant_managers сама под RLS, под правами вызывающего политика
-- на другой таблице упёрлась бы в её политику. search_path = '' — защита от подмены схемы.
-- (select auth.uid()) — считается один раз на запрос, а не на каждую строку.
create function is_manager_of(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.restaurant_managers
        where user_id = (select auth.uid()) and restaurant_id = p_restaurant_id
    );
$$;

-- Для anon политик нет — доступа нет.
-- Писать в restaurant_managers из клиента нельзя никому (членство выдаёт владелец проекта).
create policy managers_select_own on restaurant_managers
    for select to authenticated
    using (user_id = (select auth.uid()));

-- insert/delete ресторана нет: ресторан заводит владелец проекта.
create policy restaurants_select on restaurants
    for select to authenticated
    using (is_manager_of(id));

create policy restaurants_update on restaurants
    for update to authenticated
    using (is_manager_of(id))
    with check (is_manager_of(id));

-- with check на insert/update: иначе можно перенести запись в чужой ресторан сменой restaurant_id.
create policy faq_entries_all on faq_entries
    for all to authenticated
    using (is_manager_of(restaurant_id))
    with check (is_manager_of(restaurant_id));

create policy menu_categories_all on menu_categories
    for all to authenticated
    using (is_manager_of(restaurant_id))
    with check (is_manager_of(restaurant_id));

create policy menu_items_all on menu_items
    for all to authenticated
    using (is_manager_of(restaurant_id))
    with check (is_manager_of(restaurant_id));
