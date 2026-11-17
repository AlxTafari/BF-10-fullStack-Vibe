-- S10, сессия 2: служебные RPC индексации базы знаний.
--   begin_knowledge_index  — выдать попытку и снимок индексируемых данных;
--   finish_knowledge_index — заменить чанки и поставить ready, если попытка всё ещё актуальна;
--   fail_knowledge_index   — записать ошибку, если попытка всё ещё актуальна.
-- Эмбеддинги считаются между begin и finish вне транзакции БД (сервис services/knowledge.ts).
-- Защита от поздних результатов: finish/fail проверяют под блокировкой строки, что источник существует,
-- опубликован, его index_revision не изменилась и index_attempt — тот же, что выдал begin. Иначе
-- 'superseded' и ничего не меняется: результат старой попытки не затирает новую.
-- Все три — только для service_role (Edge Function knowledge-index, скрипт index:seed).

-- p_source: 'document' | 'dish'. Ответ jsonb:
--   {status: 'not_found'}                        — источника нет;
--   {status: 'unpublished'}                      — не опубликован: не эмбеддим, остаётся pending без ошибки;
--   {status: 'started', attempt, revision, restaurant_id, ...снимок} — снимок для документа: title, body;
--                                                   для блюда: name, description, ingredients, category_name.
-- Начало попытки не трогает статус и чанки: повторная индексация неизменённого источника не убирает его из поиска.
create function begin_knowledge_index(p_source text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
    v_attempt uuid := gen_random_uuid();
    v_row     jsonb;
begin
    if p_source = 'document' then
        -- for update: снимок и выдача попытки — одно атомарное действие, параллельная правка ждёт.
        select jsonb_build_object(
                   'published', d.is_published, 'revision', d.index_revision, 'restaurant_id', d.restaurant_id,
                   'title', d.title, 'body', d.body)
        into v_row
        from public.knowledge_documents d where d.id = p_id
        for update;
        if v_row is null then return jsonb_build_object('status', 'not_found'); end if;
        if not (v_row->>'published')::boolean then return jsonb_build_object('status', 'unpublished'); end if;
        update public.knowledge_documents set index_attempt = v_attempt where id = p_id;
    elsif p_source = 'dish' then
        -- Название категории входит в текст эмбеддинга блюда (dishEmbeddingText). for update of m — блокируем
        -- только блюдо: категорию его триггер инвалидации всё равно заденет через update menu_items.
        select jsonb_build_object(
                   'published', m.is_published, 'revision', m.index_revision, 'restaurant_id', m.restaurant_id,
                   'name', m.name, 'description', m.description, 'ingredients', m.ingredients,
                   'category_name', c.name)
        into v_row
        from public.menu_items m
        left join public.menu_categories c on c.id = m.category_id
        where m.id = p_id
        for update of m;
        if v_row is null then return jsonb_build_object('status', 'not_found'); end if;
        if not (v_row->>'published')::boolean then return jsonb_build_object('status', 'unpublished'); end if;
        update public.menu_items set index_attempt = v_attempt where id = p_id;
    else
        raise exception 'invalid_source';
    end if;

    return (v_row - 'published') || jsonb_build_object('status', 'started', 'attempt', v_attempt);
end;
$$;

-- Попытка ещё актуальна? Блокирует строку источника до конца транзакции вызывающей RPC:
-- правка, снятие с публикации и удаление ждут, пока finish/fail не закончат.
-- Возвращает restaurant_id источника или null (источника нет / не опубликован / версия или попытка сменились).
create function knowledge_index_lock_current(p_source text, p_id uuid, p_attempt uuid, p_revision bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
begin
    if p_source = 'document' then
        select restaurant_id into v_restaurant_id
        from public.knowledge_documents
        where id = p_id and is_published and index_revision = p_revision and index_attempt = p_attempt
        for update;
    elsif p_source = 'dish' then
        select restaurant_id into v_restaurant_id
        from public.menu_items
        where id = p_id and is_published and index_revision = p_revision and index_attempt = p_attempt
        for update;
    else
        raise exception 'invalid_source';
    end if;
    return v_restaurant_id;
end;
$$;

-- p_chunks: [{content: text, embedding: [768 чисел]}, …] в порядке фрагментов (chunk_index = позиция).
-- Старые чанки заменяются новыми одной транзакцией вместе с ready: поиск видит либо старый набор, либо новый.
-- Ответ: 'ready' | 'superseded'.
create function finish_knowledge_index(
    p_source   text,
    p_id       uuid,
    p_attempt  uuid,
    p_revision bigint,
    p_chunks   jsonb
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
begin
    if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) = 0 then
        raise exception 'invalid_chunks';
    end if;

    v_restaurant_id := public.knowledge_index_lock_current(p_source, p_id, p_attempt, p_revision);
    if v_restaurant_id is null then
        return 'superseded';
    end if;

    if p_source = 'document' then
        delete from public.knowledge_chunks where document_id = p_id;
    else
        delete from public.knowledge_chunks where menu_item_id = p_id;
    end if;

    -- jsonb-массив чисел в тексте ('[0.1, -0.2, …]') — ровно тот формат, который читает pgvector.
    -- Не та размерность — ошибка типа vector(768), транзакция откатится целиком.
    insert into public.knowledge_chunks (restaurant_id, document_id, menu_item_id, chunk_index, content, embedding)
    select v_restaurant_id,
           case when p_source = 'document' then p_id end,
           case when p_source = 'dish' then p_id end,
           (c.ord - 1)::int,
           c.value->>'content',
           (c.value->'embedding')::text::extensions.vector
    from jsonb_array_elements(p_chunks) with ordinality c(value, ord);

    if p_source = 'document' then
        update public.knowledge_documents
        set index_status = 'ready', indexed_revision = p_revision, indexed_at = now(), index_error = null
        where id = p_id;
    else
        update public.menu_items
        set index_status = 'ready', indexed_revision = p_revision, indexed_at = now(), index_error = null
        where id = p_id;
    end if;
    return 'ready';
end;
$$;

-- Ошибка попытки. Старые чанки не трогаем: поиск (сессия 3) берёт их только при indexed_revision = index_revision.
-- p_error — уже безопасный текст (сервис не передаёт ключи и ответ провайдера); обрезаем на всякий случай.
-- Ответ: 'error' | 'superseded'.
create function fail_knowledge_index(
    p_source   text,
    p_id       uuid,
    p_attempt  uuid,
    p_revision bigint,
    p_error    text
) returns text
language plpgsql security definer set search_path = ''
as $$
begin
    if public.knowledge_index_lock_current(p_source, p_id, p_attempt, p_revision) is null then
        return 'superseded';
    end if;

    if p_source = 'document' then
        update public.knowledge_documents
        set index_status = 'error', index_error = left(coalesce(p_error, 'unknown'), 500)
        where id = p_id;
    else
        update public.menu_items
        set index_status = 'error', index_error = left(coalesce(p_error, 'unknown'), 500)
        where id = p_id;
    end if;
    return 'error';
end;
$$;

-- Только service role: менеджер не может сам выставить ready или подменить чанки (S10 §2, RLS).
revoke execute on function begin_knowledge_index(text, uuid)                                from public, anon, authenticated;
revoke execute on function knowledge_index_lock_current(text, uuid, uuid, bigint)           from public, anon, authenticated;
revoke execute on function finish_knowledge_index(text, uuid, uuid, bigint, jsonb)          from public, anon, authenticated;
revoke execute on function fail_knowledge_index(text, uuid, uuid, bigint, text)             from public, anon, authenticated;
grant execute on function begin_knowledge_index(text, uuid)                       to service_role;
grant execute on function finish_knowledge_index(text, uuid, uuid, bigint, jsonb) to service_role;
grant execute on function fail_knowledge_index(text, uuid, uuid, bigint, text)    to service_role;
