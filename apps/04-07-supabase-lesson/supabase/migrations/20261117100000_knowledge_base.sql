-- S10, сессия 1: база знаний ресторана (RAG).
--   1. pgvector.
--   2. Документы ресторана и поля индексации у документов и блюд.
--   3. Блюда подборок (связи документ ↔ блюдо).
--   4. Векторный индекс (чанки).
--   5. Триггеры версий индекса: правка источника → новая версия, снятие с публикации → чанки удалены.
--   6. RLS и RPC сохранения документа вместе с блюдами подборки.
-- Эмбеддинги в БД не считаются: триггеры только помечают источник «ожидает индексации», вектор пишет
-- Edge Function (сессия 2). Служебные RPC индексации и match_knowledge — сессии 2 и 3.

-- ---------------------------------------------------------------- 1. pgvector

-- Схема extensions, а не public: так рекомендует Supabase (тип и операторы не светятся в API).
-- Отсюда полные имена ниже: extensions.vector, extensions.vector_cosine_ops.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- 2. Документы и поля индексации

-- Поля индексации (одинаковые у документа и блюда):
--   index_revision   — версия индексируемого содержимого; растёт при каждой его правке (триггер ниже);
--   indexed_revision — версия, для которой записаны текущие чанки (последняя успешная индексация);
--   index_attempt    — id последней начатой попытки: поздний ответ старой попытки не перезапишет новую;
--   index_status     — pending (ждёт индексации) / ready / error; ready актуален при indexed_revision = index_revision;
--   indexed_at       — время последней успешной записи индекса, не время правки.
-- Состояние живёт в БД, а не в форме админки: после перезагрузки страницы видно «Ожидает» / «Ошибка».
create table knowledge_documents (
    id               uuid primary key default gen_random_uuid(),
    restaurant_id    uuid not null references restaurants (id) on delete cascade,
    -- Пределы — те же, что в форме админки. Название входит в каждый фрагмент (§4.7), поэтому короткое.
    title            text not null check (btrim(title) <> '' and char_length(title) <= 200),
    body             text not null check (btrim(body) <> '' and char_length(body) <= 20000),   -- markdown, ## — граница фрагмента
    type             text not null check (type in (
                         'history', 'team', 'concept', 'collection', 'drinks', 'event', 'service', 'season', 'other'
                     )),
    is_published     boolean not null default false,
    index_status     text not null default 'pending' check (index_status in ('pending', 'ready', 'error')),
    indexed_at       timestamptz,
    index_error      text,
    index_revision   bigint not null default 1 check (index_revision > 0),
    indexed_revision bigint,
    index_attempt    uuid,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),   -- дата правки содержимого (не меняется от индексации)
    -- Текст ошибки бывает только у статуса error: иначе админка покажет устаревшую ошибку рядом с «Готово».
    constraint knowledge_documents_error_status check (index_error is null or index_status = 'error'),
    -- Цель составных FK (id, restaurant_id) у связей и чанков: БД сама гарантирует «тот же ресторан».
    constraint knowledge_documents_id_restaurant_key unique (id, restaurant_id)
);

create index knowledge_documents_restaurant_idx on knowledge_documents (restaurant_id, type);

alter table menu_items
    add column index_status     text not null default 'pending' check (index_status in ('pending', 'ready', 'error')),
    add column indexed_at       timestamptz,
    add column index_error      text,
    add column index_revision   bigint not null default 1 check (index_revision > 0),
    add column indexed_revision bigint,
    add column index_attempt    uuid,
    add constraint menu_items_error_status check (index_error is null or index_status = 'error'),
    add constraint menu_items_id_restaurant_key unique (id, restaurant_id);

-- ---------------------------------------------------------------- 3. Блюда подборок

-- Состав подборки — только здесь, а не в тексте документа (§4.5): цены, стоп-лист и снятие блюда
-- с публикации видны при следующем поиске без переиндексации.
-- restaurant_id — сверх спеки: составные FK не дают привязать блюдо чужого ресторана даже service role,
-- и RLS-политика проверяет одну колонку без подзапроса.
create table knowledge_document_dishes (
    document_id   uuid not null,
    menu_item_id  uuid not null,
    restaurant_id uuid not null,
    sort_order    int  not null default 0,
    primary key (document_id, menu_item_id),
    foreign key (document_id, restaurant_id) references knowledge_documents (id, restaurant_id) on delete cascade,
    foreign key (menu_item_id, restaurant_id) references menu_items (id, restaurant_id) on delete cascade
);

-- Для каскада при удалении блюда (PK начинается с document_id и тут не помогает).
create index knowledge_document_dishes_item_idx on knowledge_document_dishes (menu_item_id);

-- Связи только у подборки. security definer: проверка должна видеть документ независимо от RLS
-- вызывающего (чужой документ всё равно отсечёт политика). for share — смена типа документа
-- параллельной транзакцией ждёт конца этой, а не проскакивает между проверкой и вставкой.
create function knowledge_document_dishes_check_type() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    perform 1 from public.knowledge_documents
    where id = new.document_id and type = 'collection'
    for share;
    if not found then
        raise exception 'dishes_only_for_collection' using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger knowledge_document_dishes_check_type
    before insert or update on knowledge_document_dishes
    for each row execute function knowledge_document_dishes_check_type();

-- ---------------------------------------------------------------- 4. Чанки (векторный индекс)

-- Источник — ровно один: документ или блюдо. Составной FK с restaurant_id: ресторан чанка совпадает
-- с рестораном источника. При NULL в document_id/menu_item_id FK не проверяется (MATCH SIMPLE) —
-- поэтому одна таблица держит оба вида источников.
create table knowledge_chunks (
    id            uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references restaurants (id) on delete cascade,
    document_id   uuid,
    menu_item_id  uuid,
    chunk_index   int  not null check (chunk_index >= 0),
    content       text not null check (btrim(content) <> ''),   -- ровно тот текст, что ушёл в эмбеддинг
    embedding     extensions.vector(768) not null,               -- gemini-embedding-001, outputDimensionality 768
    created_at    timestamptz not null default now(),
    constraint knowledge_chunks_one_source check (num_nonnulls(document_id, menu_item_id) = 1),
    foreign key (document_id, restaurant_id) references knowledge_documents (id, restaurant_id) on delete cascade,
    foreign key (menu_item_id, restaurant_id) references menu_items (id, restaurant_id) on delete cascade
);

-- Уникальность номера фрагмента внутри источника; заодно индексы для каскадного удаления.
create unique index knowledge_chunks_document_uidx on knowledge_chunks (document_id, chunk_index)
    where document_id is not null;
create unique index knowledge_chunks_item_uidx on knowledge_chunks (menu_item_id, chunk_index)
    where menu_item_id is not null;
create index knowledge_chunks_restaurant_idx on knowledge_chunks (restaurant_id);
-- HNSW: приближённый поиск ближайших соседей; vector_cosine_ops — под оператор <=> (косинусное расстояние).
create index knowledge_chunks_embedding_idx on knowledge_chunks
    using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------- 5. Триггеры версий индекса

-- Кто может трогать служебные поля индексации. Триггерная функция без security definer выполняется
-- от роли вызывающего: запрос клиента через PostgREST — anon/authenticated. Служебные RPC
-- (security definer, владелец postgres), seed и service role сюда не попадают.
-- Клиентскую правку служебных полей молча откатываем, а не падаем: форма админки может прислать
-- строку целиком со старым статусом, пока индексатор его уже обновил.

-- Документ: индексируемое — название, текст, тип; публикация тоже даёт новую версию, чтобы поздний
-- результат попытки, начатой до снятия с публикации, не вернул удалённые чанки.
create function knowledge_documents_before_write() returns trigger
language plpgsql set search_path = ''
as $$
begin
    if current_user in ('anon', 'authenticated') then
        if tg_op = 'INSERT' then
            new.index_status := 'pending';
            new.indexed_at := null;
            new.index_error := null;
            new.index_revision := 1;
            new.indexed_revision := null;
            new.index_attempt := null;
        else
            new.index_status := old.index_status;
            new.indexed_at := old.indexed_at;
            new.index_error := old.index_error;
            new.index_revision := old.index_revision;
            new.indexed_revision := old.indexed_revision;
            new.index_attempt := old.index_attempt;
        end if;
    end if;

    if tg_op = 'UPDATE'
       and (new.title, new.body, new.type, new.is_published)
           is distinct from (old.title, old.body, old.type, old.is_published) then
        new.index_revision := old.index_revision + 1;
        new.index_status := 'pending';
        new.index_error := null;
        new.index_attempt := null;   -- начатая попытка устарела
        new.updated_at := now();
    end if;
    return new;
end;
$$;

create trigger knowledge_documents_before_write
    before insert or update on knowledge_documents
    for each row execute function knowledge_documents_before_write();

-- После правки: снятие с публикации удаляет чанки сразу, в той же транзакции и без Gemini — документ
-- пропадает из поиска даже при недоступном индексаторе. Смена типа с подборки удаляет связи с блюдами.
-- security definer: у authenticated нет доступа к knowledge_chunks.
create function knowledge_documents_after_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if old.is_published and not new.is_published then
        delete from public.knowledge_chunks where document_id = new.id;
    end if;
    if old.type = 'collection' and new.type <> 'collection' then
        delete from public.knowledge_document_dishes where document_id = new.id;
    end if;
    return null;
end;
$$;

create trigger knowledge_documents_after_update
    after update on knowledge_documents
    for each row execute function knowledge_documents_after_update();

-- Блюдо: индексируемое — название, описание, состав, категория (её название входит в текст эмбеддинга)
-- и публикация. Цена, аллергены, стоп-лист, порядок и КБЖУ версию не меняют: их читают из таблицы
-- при поиске. Удаление категории (FK on delete set null) меняет category_id — блюдо инвалидируется здесь же.
create function menu_items_index_before_write() returns trigger
language plpgsql set search_path = ''
as $$
begin
    if current_user in ('anon', 'authenticated') then
        if tg_op = 'INSERT' then
            new.index_status := 'pending';
            new.indexed_at := null;
            new.index_error := null;
            new.index_revision := 1;
            new.indexed_revision := null;
            new.index_attempt := null;
        else
            new.index_status := old.index_status;
            new.indexed_at := old.indexed_at;
            new.index_error := old.index_error;
            new.index_revision := old.index_revision;
            new.indexed_revision := old.indexed_revision;
            new.index_attempt := old.index_attempt;
        end if;
    end if;

    if tg_op = 'UPDATE'
       and (new.name, new.description, new.ingredients, new.category_id, new.is_published)
           is distinct from (old.name, old.description, old.ingredients, old.category_id, old.is_published) then
        new.index_revision := old.index_revision + 1;
        new.index_status := 'pending';
        new.index_error := null;
        new.index_attempt := null;
    end if;
    return new;
end;
$$;

create trigger menu_items_index_before_write
    before insert or update on menu_items
    for each row execute function menu_items_index_before_write();

create function menu_items_index_after_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if old.is_published and not new.is_published then
        delete from public.knowledge_chunks where menu_item_id = new.id;
    end if;
    return null;
end;
$$;

create trigger menu_items_index_after_update
    after update on menu_items
    for each row execute function menu_items_index_after_update();

-- Переименование категории меняет текст эмбеддинга всех её блюд — инвалидируем их в той же транзакции.
-- security definer: update идёт от владельца, поэтому триггер блюда не откатывает служебные поля.
create function menu_categories_invalidate_items() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    update public.menu_items
    set index_revision = index_revision + 1,
        index_status = 'pending',
        index_error = null,
        index_attempt = null
    where category_id = new.id;
    return null;
end;
$$;

create trigger menu_categories_invalidate_items
    after update of name on menu_categories
    for each row when (old.name is distinct from new.name)
    execute function menu_categories_invalidate_items();

-- Триггерные функции не должны вызываться как RPC: PostgREST отдаёт функции схемы public.
revoke execute on function knowledge_document_dishes_check_type() from public, anon, authenticated;
revoke execute on function knowledge_documents_before_write()     from public, anon, authenticated;
revoke execute on function knowledge_documents_after_update()     from public, anon, authenticated;
revoke execute on function menu_items_index_before_write()        from public, anon, authenticated;
revoke execute on function menu_items_index_after_update()        from public, anon, authenticated;
revoke execute on function menu_categories_invalidate_items()     from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. RLS и RPC

alter table knowledge_documents       enable row level security;
alter table knowledge_document_dishes enable row level security;
alter table knowledge_chunks          enable row level security;

-- По образцу faq_entries: with check не даёт перенести запись в чужой ресторан.
create policy knowledge_documents_all on knowledge_documents
    for all to authenticated
    using (is_manager_of(restaurant_id))
    with check (is_manager_of(restaurant_id));

-- Блюдо того же ресторана гарантируют составные FK, своё членство — политика.
create policy knowledge_document_dishes_all on knowledge_document_dishes
    for all to authenticated
    using (is_manager_of(restaurant_id))
    with check (is_manager_of(restaurant_id));

-- knowledge_chunks: политик нет — пишут Edge Function и бот через service role. Права на таблицу
-- забираем дополнительно: закрыто, даже если однажды кто-то добавит политику по ошибке.
revoke all on knowledge_chunks from anon, authenticated;

-- Сохранение документа и состава подборки одной транзакцией: без RPC две мутации из клиента могут
-- разойтись (документ сохранён, связи — нет). security invoker: работают обычные RLS-политики,
-- явные проверки дают понятные коды ошибок для админки.
--   p_id      — null для нового документа;
--   p_dish_ids — блюда подборки в нужном порядке (позиция → sort_order); для других типов пустой.
-- Набор связей заменяется целиком. Возвращает id документа.
create function save_knowledge_document(
    p_id           uuid,
    p_title        text,
    p_body         text,
    p_type         text,
    p_is_published boolean,
    p_dish_ids     uuid[]
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
    v_restaurant_id uuid;
    v_id            uuid;
    v_dish_ids      uuid[] := coalesce(p_dish_ids, '{}');
begin
    -- Один пользователь — один ресторан (PK restaurant_managers); ресторан берём из членства, не от клиента.
    select restaurant_id into v_restaurant_id
    from public.restaurant_managers where user_id = (select auth.uid());
    if not found then
        raise exception 'not_found';
    end if;

    if p_type is distinct from 'collection' and cardinality(v_dish_ids) > 0 then
        raise exception 'dishes_only_for_collection';
    end if;
    if cardinality(v_dish_ids) <> (select count(distinct d) from unnest(v_dish_ids) d) then
        raise exception 'duplicate_dishes';
    end if;
    -- Чужое и несуществующее блюдо неотличимы. Под RLS чужие блюда и так невидимы.
    if exists (
        select 1 from unnest(v_dish_ids) d(id)
        where not exists (
            select 1 from public.menu_items m where m.id = d.id and m.restaurant_id = v_restaurant_id
        )
    ) then
        raise exception 'invalid_dishes';
    end if;

    if p_id is null then
        insert into public.knowledge_documents (restaurant_id, title, body, type, is_published)
        values (v_restaurant_id, btrim(p_title), p_body, p_type, p_is_published)
        returning id into v_id;
    else
        update public.knowledge_documents
        set title = btrim(p_title), body = p_body, type = p_type, is_published = p_is_published
        where id = p_id and restaurant_id = v_restaurant_id
        returning id into v_id;
        if v_id is null then
            raise exception 'not_found';
        end if;
    end if;

    delete from public.knowledge_document_dishes where document_id = v_id;
    insert into public.knowledge_document_dishes (document_id, menu_item_id, restaurant_id, sort_order)
    select v_id, d.id, v_restaurant_id, (d.ord - 1)::int
    from unnest(v_dish_ids) with ordinality d(id, ord);

    return v_id;
end;
$$;

revoke execute on function save_knowledge_document(uuid, text, text, text, boolean, uuid[]) from public, anon;
grant execute on function save_knowledge_document(uuid, text, text, text, boolean, uuid[]) to authenticated;
