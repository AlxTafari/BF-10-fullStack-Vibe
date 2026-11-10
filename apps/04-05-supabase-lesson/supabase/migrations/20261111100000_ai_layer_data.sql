-- S09, сессия 1: данные под AI-слой.
-- Настройки AI ресторана, служебная пометка сообщений, пометка угрозы у диалога, справочник аллергенов ЕС.
-- Порядок выкатки: сначала миграция, потом деплой бота. Новые колонки nullable / с default — старый бот
-- их не замечает. Исключение — check на аллергены: старая админка с вводом текстом получит ошибку на
-- сохранении блюда с аллергеном-словом, поэтому админку деплоить вместе с миграцией.

-- ---------------------------------------------------------------- настройки AI ресторана

-- Отдельная таблица 1:1, а не колонки в restaurants: настройки AI растут (S10 добавит свои) и не смешиваются
-- с карточкой ресторана. Не jsonb: диапазоны проверяет БД через check, неверное значение из админки
-- отклоняется на сервере, а не только в форме.
create table restaurant_ai_settings (
    restaurant_id    uuid primary key references restaurants (id) on delete cascade,
    -- AI-first: включён по умолчанию; выключен → бот работает на кнопках, как до S09.
    ai_enabled       boolean not null default true,
    -- Сколько последних сообщений диалога видит агент. Меньше 4 — агент теряет нить на первом же
    -- уточнении; больше 30 — дороже каждый вызов, а черновик брони хранится отдельно от истории.
    history_window   int not null default 12 check (history_window between 4 and 30),
    -- Ходов агента на гостя в сутки (часовой пояс ресторана). Поверх антиспама S06c; контроль расходов.
    daily_turn_limit int not null default 50 check (daily_turn_limit between 5 and 500)
);
alter table restaurant_ai_settings enable row level security;

-- Строка настроек появляется вместе с рестораном: сервису не нужно разбирать «строки нет».
-- (Сервис всё равно держит значения по умолчанию в домене — на случай ручного удаления строки.)
create function restaurants_after_insert_ai_settings() returns trigger
language plpgsql set search_path = ''
as $$
begin
    insert into public.restaurant_ai_settings (restaurant_id) values (new.id)
    on conflict (restaurant_id) do nothing;
    return new;
end;
$$;

create trigger restaurants_after_insert_ai_settings
    after insert on restaurants
    for each row execute function restaurants_after_insert_ai_settings();

revoke execute on function restaurants_after_insert_ai_settings() from public, anon, authenticated;

-- Существующие рестораны.
insert into restaurant_ai_settings (restaurant_id)
select id from restaurants
on conflict (restaurant_id) do nothing;

-- Менеджер читает и правит настройки своего ресторана. insert/delete нет: строку создаёт триггер,
-- удаляется она каскадом вместе с рестораном. with check — нельзя переписать строку на чужой ресторан.
create policy restaurant_ai_settings_select on restaurant_ai_settings
    for select to authenticated
    using (is_manager_of(restaurant_id));

create policy restaurant_ai_settings_update on restaurant_ai_settings
    for update to authenticated
    using (is_manager_of(restaurant_id))
    with check (is_manager_of(restaurant_id));

-- ---------------------------------------------------------------- служебная пометка сообщения

-- Исходящее от AI: {"ai": true, "model": "…", "tools": [...]}; входящее голосовое: {"voice": true, "duration": 12}.
-- null — обычное сообщение. Не новые значения kind: kind = 'text' управляет превью диалога (триггер S06),
-- а AI-ответ и распознанное голосовое — тоже текст и должны попадать в превью.
-- Форма содержимого проверяется в коде (тип MessageMeta); БД гарантирует только «объект или null».
alter table messages
    add column meta jsonb check (meta is null or jsonb_typeof(meta) = 'object');

-- ---------------------------------------------------------------- пометка угрозы у диалога

-- Ставит бот (tool flagThreat агента), снимает менеджер кнопкой «Разобрано» (RPC — сессия 5).
-- Время и причина ставятся и снимаются вместе.
alter table conversations
    add column flagged_at  timestamptz,
    add column flag_reason text,
    add constraint conversations_flag_pair check ((flagged_at is null) = (flag_reason is null));

-- ---------------------------------------------------------------- аллергены: справочник ЕС

-- 14 аллергенов Регламента ЕС 1169/2011 (приложение II). Коды — латиницей: стабильны при смене языка
-- подписей, а агент и фильтр работают с кодом, а не со словом («глютен» и «пшеница» — один код).
-- Список совпадает с _shared/domain/allergens.ts и admin/src/domain/allergens.ts.
create function eu_allergen_codes() returns text[]
language sql immutable set search_path = ''
as $$
    select array[
        'cereals_gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
        'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'
    ]::text[];
$$;

-- Перенос свободного текста к кодам. Синонимы — в нижнем регистре, сравнение по lower(trim(слово)).
create temporary table allergen_synonyms (word text primary key, code text not null) on commit drop;
insert into allergen_synonyms (word, code) values
    ('глютен', 'cereals_gluten'), ('пшеница', 'cereals_gluten'), ('злаки', 'cereals_gluten'),
    ('рожь', 'cereals_gluten'), ('ячмень', 'cereals_gluten'), ('овёс', 'cereals_gluten'), ('овес', 'cereals_gluten'),
    ('ракообразные', 'crustaceans'), ('креветки', 'crustaceans'), ('крабы', 'crustaceans'), ('раки', 'crustaceans'),
    ('яйца', 'eggs'), ('яйцо', 'eggs'),
    ('рыба', 'fish'),
    ('арахис', 'peanuts'),
    ('соя', 'soybeans'),
    ('молоко', 'milk'), ('лактоза', 'milk'), ('молочные продукты', 'milk'),
    ('орехи', 'nuts'), ('орех', 'nuts'), ('миндаль', 'nuts'), ('фундук', 'nuts'), ('грецкий орех', 'nuts'),
    ('фисташки', 'nuts'), ('кешью', 'nuts'), ('пекан', 'nuts'),
    ('сельдерей', 'celery'),
    ('горчица', 'mustard'),
    ('кунжут', 'sesame'),
    ('сульфиты', 'sulphites'), ('диоксид серы', 'sulphites'),
    ('люпин', 'lupin'),
    ('моллюски', 'molluscs'), ('мидии', 'molluscs'), ('устрицы', 'molluscs'), ('кальмар', 'molluscs'),
    ('осьминог', 'molluscs');

-- Несопоставимое слово блюдо безопасным НЕ делает: всё значение становится null («состав не указан»),
-- блюдо выводится в notice — менеджер проставит аллергены в админке. Отбросить одно слово и оставить
-- остальные нельзя: неизвестный аллерген молча исчез бы из карточки.
do $$
declare
    r record;
begin
    for r in
        select mi.id, mi.name, mi.allergens
        from menu_items mi
        where mi.allergens is not null
          and exists (
              select 1 from unnest(mi.allergens) a
              where lower(trim(a)) not in (select word from allergen_synonyms)
                and lower(trim(a)) <> all (eu_allergen_codes())
          )
    loop
        raise notice 'allergens: блюдо % (%) — несопоставимые значения %, аллергены сброшены в «не указано»',
            r.name, r.id, r.allergens;
        update menu_items set allergens = null where id = r.id;
    end loop;
end;
$$;

-- Остальное — к кодам: синоним → код, уже код → как есть; без дублей, в порядке справочника.
-- '{}' («аллергенов нет») остаётся '{}': array_agg по пустому набору дал бы null, отсюда coalesce.
update menu_items mi
set allergens = coalesce((
    select array_agg(c.code order by array_position(eu_allergen_codes(), c.code))
    from (
        select distinct coalesce(s.code, lower(trim(a))) as code
        from unnest(mi.allergens) a
        left join allergen_synonyms s on s.word = lower(trim(a))
    ) c
), '{}')
where mi.allergens is not null;

-- Дальше в колонку попадают только коды справочника (запись из админки, seed, будущий импорт).
-- <@ — «каждый элемент слева есть в массиве справа»; null (не указано) проходит.
alter table menu_items
    add constraint menu_items_allergens_eu check (allergens <@ eu_allergen_codes());

comment on column menu_items.allergens is
    'Коды аллергенов ЕС (eu_allergen_codes()). null — не указано, ''{}'' — указано «нет».';
