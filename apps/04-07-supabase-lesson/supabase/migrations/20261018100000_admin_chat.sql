-- S06: чат гостей в админке — чтение диалогов и сообщений, «последнее сообщение», общие непрочитанные,
-- курсорная выборка (RPC), Realtime.
-- Порядок выкатки: сначала эта миграция, потом деплой бота (колонка kind с default 'text' совместима со старым ботом).

-- ---------------------------------------------------------------- тип сообщения

-- Бот пишет нажатия кнопок как «[кнопка] <callback_data>». Отличать их по префиксу текста ненадёжно:
-- любой будущий текст с таким началом стал бы «нажатием». Тип хранится явно; тексты не переписываем.
alter table messages
    add column kind text not null default 'text' check (kind in ('text', 'button'));

update messages set kind = 'button' where direction = 'in' and text like '[кнопка] %';

-- ---------------------------------------------------------------- последнее сообщение и отметка прочтения

alter table conversations
    add column last_message_preview   text,
    add column last_message_direction text check (last_message_direction in ('in', 'out')),
    -- Общая для всех менеджеров ресторана отметка «прочитано до». Пишется только RPC mark_conversation_read.
    add column manager_last_read_at   timestamptz;

-- Заполняем уже существующие диалоги: время — по самому свежему сообщению (раньше его ставил бот из JS и
-- мог разойтись с created_at), превью — по самому свежему ТЕКСТОВОМУ.
update conversations c
set last_message_at        = coalesce((select max(m.created_at) from messages m where m.conversation_id = c.id), c.last_message_at),
    last_message_preview   = (select left(m.text, 120) from messages m
                              where m.conversation_id = c.id and m.kind = 'text'
                              order by m.created_at desc, m.id desc limit 1),
    last_message_direction = (select m.direction from messages m
                              where m.conversation_id = c.id and m.kind = 'text'
                              order by m.created_at desc, m.id desc limit 1);

-- История на момент миграции считается прочитанной, иначе после выкатки у всех диалогов вылезут «непрочитанные».
update conversations set manager_last_read_at = last_message_at;

-- Под список диалогов: порядок (last_message_at desc, id desc) внутри ресторана.
create index conversations_list_idx on conversations (restaurant_id, last_message_at desc, id desc);

-- Вставка сообщения и обновление диалога — одна атомарная операция. Раньше бот делал два запроса,
-- и сбой между ними оставлял диалог со старым last_message_at.
-- Метки created_at у двух одновременных сообщений могут прийти в обратном порядке коммита (now() — начало
-- транзакции), поэтому ничего не откатываем назад:
--   • last_message_at только растёт (greatest);
--   • превью и направление ставит только текстовое сообщение, и только если нет более позднего текстового
--     (проверка по messages_cursor_idx).
-- Нажатие кнопки двигает диалог вверх списка, но не подменяет превью строкой «[кнопка] menu:booking».
create function messages_after_insert() returns trigger
language plpgsql set search_path = ''
as $$
begin
    if new.kind = 'text' and not exists (
        select 1 from public.messages m
        where m.conversation_id = new.conversation_id
          and m.kind = 'text'
          and (m.created_at, m.id) > (new.created_at, new.id)
    ) then
        update public.conversations
        set last_message_at        = greatest(last_message_at, new.created_at),
            last_message_preview   = left(new.text, 120),
            last_message_direction = new.direction
        where id = new.conversation_id;
    else
        update public.conversations
        set last_message_at = greatest(last_message_at, new.created_at)
        where id = new.conversation_id;
    end if;
    return new;
end;
$$;

create trigger messages_after_insert
    after insert on messages
    for each row execute function messages_after_insert();

revoke execute on function messages_after_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------- политики: только select

-- Запись, изменение и удаление — ни для кого из клиентов (журнал неизменяем; пишет бот через service role).
create policy conversations_select on conversations
    for select to authenticated
    using (is_manager_of(restaurant_id));

-- У messages нет restaurant_id: доступ выводится через диалог (подзапрос по первичному ключу).
-- Эту же политику применяет Realtime.
create policy messages_select on messages
    for select to authenticated
    using (exists (
        select 1 from conversations c
        where c.id = messages.conversation_id and is_manager_of(c.restaurant_id)
    ));

alter publication supabase_realtime add table conversations, messages;

-- ---------------------------------------------------------------- RPC: курсорная выборка (ADR-005)

-- Почему RPC, а не PostgREST-фильтр .or('created_at.lt.X,and(created_at.eq.X,id.lt.Y)'):
-- фильтр собирается строкой в URL, где «+» в «+00:00» без экранирования читается как пробел,
-- а RPC принимает timestamptz в теле JSON и сохраняет микросекунды.
-- security invoker: RLS применяется как к прямому запросу — чужой диалог вернёт пусто.

-- Сообщения диалога, новые → старые. Курсор — пара (created_at, id) последней полученной строки.
-- Сравнение пары при одинаковом направлении сортировки обоих столбцов идёт прямо по messages_cursor_idx.
create function get_messages_page(
    p_conversation_id   uuid,
    p_before_created_at timestamptz,
    p_before_id         uuid,
    p_limit             int
) returns setof messages
language sql stable security invoker set search_path = ''
as $$
    select m.*
    from public.messages m
    where m.conversation_id = p_conversation_id
      and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
    order by m.created_at desc, m.id desc
    limit least(greatest(p_limit, 1), 101);
$$;

-- Диалоги, свежие сверху. Узкий набор колонок: state, chat_id, external_user_id в список не отдаются.
-- Диалоги без сообщений не показываются.
-- unread_count — входящие текстовые после manager_last_read_at (null = всё входящее), с потолком 100:
-- точное большое число менеджеру не нужно, а подзапрос остаётся ограниченным.
create function list_conversations_page(
    p_before_at timestamptz,
    p_before_id uuid,
    p_limit     int
) returns table (
    id                     uuid,
    display_name           text,
    channel                text,
    created_at             timestamptz,
    last_message_at        timestamptz,
    last_message_preview   text,
    last_message_direction text,
    manager_last_read_at   timestamptz,
    unread_count           int
)
language sql stable security invoker set search_path = ''
as $$
    select c.id, c.display_name, c.channel, c.created_at,
           c.last_message_at, c.last_message_preview, c.last_message_direction,
           c.manager_last_read_at, u.n
    from public.conversations c
    cross join lateral (
        select count(*)::int as n from (
            select 1 from public.messages m
            where m.conversation_id = c.id
              and m.direction = 'in'
              and m.kind = 'text'
              and (c.manager_last_read_at is null or m.created_at > c.manager_last_read_at)
            limit 100
        ) t
    ) u
    where c.last_message_at is not null
      and (p_before_at is null or (c.last_message_at, c.id) < (p_before_at, p_before_id))
    order by c.last_message_at desc, c.id desc
    limit least(greatest(p_limit, 1), 101);
$$;

-- Сколько диалогов с непрочитанным — для бейджа в навигации и заголовка вкладки.
create function count_unread_conversations() returns int
language sql stable security invoker set search_path = ''
as $$
    select count(*)::int
    from public.conversations c
    where exists (
        select 1 from public.messages m
        where m.conversation_id = c.id
          and m.direction = 'in'
          and m.kind = 'text'
          and (c.manager_last_read_at is null or m.created_at > c.manager_last_read_at)
    );
$$;

-- ---------------------------------------------------------------- RPC: отметка прочтения

-- Единственная запись клиента в conversations. Прямой update политикой закрыт.
-- p_up_to — created_at самого нового сообщения, которое менеджер реально видел (не now()): иначе прочитанным
-- станет сообщение, пришедшее между отрисовкой и вызовом. Отметка только растёт (запоздалый вызов из
-- старой вкладки её не откатит) и не уходит за last_message_at (нельзя «прочитать» будущее).
-- Чужой и несуществующий диалог неотличимы (not_found) — id диалогов не проверить перебором.
create function mark_conversation_read(p_conversation_id uuid, p_up_to timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
begin
    if p_up_to is null then
        raise exception 'invalid_up_to';
    end if;

    select restaurant_id into v_restaurant_id from public.conversations where id = p_conversation_id;
    if not found or not public.is_manager_of(v_restaurant_id) then
        raise exception 'not_found';
    end if;

    update public.conversations
    set manager_last_read_at = greatest(
        coalesce(manager_last_read_at, '-infinity'::timestamptz),
        least(p_up_to, coalesce(last_message_at, p_up_to))
    )
    where id = p_conversation_id
      and manager_last_read_at is distinct from greatest(
        coalesce(manager_last_read_at, '-infinity'::timestamptz),
        least(p_up_to, coalesce(last_message_at, p_up_to))
      );  -- нет изменения — нет UPDATE и лишнего события Realtime
end;
$$;

-- Функции в public по умолчанию доступны всем (в Supabase — ещё и anon явным грантом): оставляем authenticated.
revoke execute on function get_messages_page(uuid, timestamptz, uuid, int) from public, anon;
revoke execute on function list_conversations_page(timestamptz, uuid, int) from public, anon;
revoke execute on function count_unread_conversations() from public, anon;
revoke execute on function mark_conversation_read(uuid, timestamptz) from public, anon;
grant execute on function get_messages_page(uuid, timestamptz, uuid, int) to authenticated;
grant execute on function list_conversations_page(timestamptz, uuid, int) to authenticated;
grant execute on function count_unread_conversations() to authenticated;
grant execute on function mark_conversation_read(uuid, timestamptz) to authenticated;
