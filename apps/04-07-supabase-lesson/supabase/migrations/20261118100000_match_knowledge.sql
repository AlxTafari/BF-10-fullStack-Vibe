-- S10, сессия 3: векторный поиск по базе знаний для tool searchKnowledge.
-- Вызывает только бот (service role). Правила (S10 §2, сессия 3; §4.8):
--   1. фильтр: ресторан, опубликованный источник, чанки актуальной версии (indexed_revision = index_revision);
--   2. лучший фрагмент каждого источника — документ из нескольких фрагментов не занимает весь лимит;
--   3. порог, сортировка по сходству (равные — по source, id, chunk_index), лимит разных источников.
-- Те же правила повторяет проверка в памяти (domain/knowledgeSearch.ts, pnpm eval:rag).
-- Текущие данные читаются из таблиц в момент поиска, а не из чанков: у блюда — название, цена, валюта ресторана,
-- стоп-лист; у подборки — опубликованные блюда из связей. Поэтому правка цены, стоп-листа и состава подборки видна
-- сразу, без Gemini.

-- Ответ — строка на источник:
--   source       — 'document' | 'dish';
--   id           — id документа или блюда;
--   score        — косинусное сходство лучшего фрагмента (1 — совпадение);
--   chunk_index  — номер лучшего фрагмента;
--   title, doc_type, content — у документа: название, тип, текст лучшего фрагмента;
--   name, price, currency, available — у блюда: текущие поля из menu_items и restaurants;
--   dishes       — у подборки: [{id, name, price, currency, available}] в порядке sort_order, id; у остальных '[]'.
create function match_knowledge(
    p_restaurant_id uuid,
    p_embedding     extensions.vector(768),
    p_threshold     double precision,
    p_limit         int
) returns table (
    source      text,
    id          uuid,
    score       double precision,
    chunk_index int,
    title       text,
    doc_type    text,
    content     text,
    name        text,
    price       numeric,
    currency    text,
    available   boolean,
    dishes      jsonb
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
    -- Защита от неверного вызова: лимит — маленькое число, порог — в диапазоне косинуса.
    if p_limit is null or p_limit < 1 or p_limit > 20 then
        raise exception 'invalid_limit';
    end if;
    if p_threshold is null or p_threshold < -1 or p_threshold > 1 then
        raise exception 'invalid_threshold';
    end if;

    -- Точный перебор чанков ресторана, а не HNSW: индекс ищет ближайших до фильтров и после отсечения
    -- неактуальных/чужих мог бы вернуть меньше лимита. У ресторана сотни чанков — перебор дешёвый.
    return query
    with candidates as (
        select c.document_id,
               c.menu_item_id,
               case when c.document_id is not null then 'document' else 'dish' end as src,
               coalesce(c.document_id, c.menu_item_id) as src_id,
               c.chunk_index as idx,
               c.content as chunk_text,
               -- <=> — косинусное расстояние; сходство = 1 − расстояние.
               1 - (c.embedding operator(extensions.<=>) p_embedding) as sim
        from public.knowledge_chunks c
        left join public.knowledge_documents d on d.id = c.document_id
        left join public.menu_items m on m.id = c.menu_item_id
        where c.restaurant_id = p_restaurant_id
          and (
              (d.id is not null and d.is_published and d.indexed_revision = d.index_revision)
              or (m.id is not null and m.is_published and m.indexed_revision = m.index_revision)
          )
    ),
    -- Лучший фрагмент источника; при равном сходстве — фрагмент с меньшим номером.
    best as (
        select distinct on (cand.src, cand.src_id) cand.*
        from candidates cand
        order by cand.src, cand.src_id, cand.sim desc, cand.idx
    ),
    ranked as (
        select b.*
        from best b
        where b.sim >= p_threshold
        order by b.sim desc, b.src, b.src_id, b.idx
        limit p_limit
    )
    select t.src,
           t.src_id,
           t.sim,
           t.idx,
           d.title,
           d.type,
           case when t.src = 'document' then t.chunk_text end,
           m.name,
           m.price,
           case when t.src = 'dish' then r.currency end,
           m.is_available,
           case when d.type = 'collection' then coalesce((
               select jsonb_agg(
                          jsonb_build_object(
                              'id', dm.id, 'name', dm.name, 'price', dm.price,
                              'currency', r.currency, 'available', dm.is_available)
                          order by l.sort_order, dm.id)
               from public.knowledge_document_dishes l
               join public.menu_items dm on dm.id = l.menu_item_id
               -- Опубликованность блюда — из menu_items в момент поиска; его собственный вектор (возможно,
               -- устаревший) на состав подборки не влияет. Тот же ресторан гарантирует составной FK связи.
               where l.document_id = t.document_id and dm.is_published
           ), '[]'::jsonb) else '[]'::jsonb end
    from ranked t
    join public.restaurants r on r.id = p_restaurant_id
    left join public.knowledge_documents d on d.id = t.document_id
    left join public.menu_items m on m.id = t.menu_item_id
    order by t.sim desc, t.src, t.src_id, t.idx;
end;
$$;

-- Только бот (service role): менеджеру поиск не нужен, а anon не должен перебирать базу знаний.
revoke execute on function match_knowledge(uuid, extensions.vector, double precision, int) from public, anon, authenticated;
grant execute on function match_knowledge(uuid, extensions.vector, double precision, int) to service_role;
