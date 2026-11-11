-- S06b: менеджер подключается к диалогу.
--   1. conversations.handoff_until — ручной режим: пока метка в будущем, бот не отвечает на свободный текст гостя.
--   2. RPC подключения, продления (перед ответом) и отключения. Вызывает Edge Function manager-chat под JWT менеджера.
--   3. list_conversations_page отдаёт handoff_until (бейдж «Менеджер» в списке).
-- Реплика менеджера — обычная строка messages с meta = {"manager": true, "managerId": …}; схему messages не трогаем.

-- ---------------------------------------------------------------- 1. Ручной режим

-- Ручной режим = handoff_until > now(). Тайм-аут ленивый: фоновой задачи нет, истёкшая метка просто перестаёт
-- действовать. null — режима нет. Пишут только RPC ниже (прямой update клиенту закрыт политикой, бот не пишет).
alter table conversations add column handoff_until timestamptz;

-- ---------------------------------------------------------------- 2. RPC

-- Подключение. В одной транзакции: проверка членства, продление метки и сброс незаконченного сценария
-- (иначе ответ гостя менеджеру бот принял бы за шаг «имя»). was_active — режим уже шёл (вторая вкладка,
-- двойной клик): функция тогда не шлёт гостю повторное «подключился менеджер».
-- Чужой и несуществующий диалог неотличимы (not_found), как в mark_conversation_read.
create function begin_manager_handoff(p_conversation_id uuid)
returns table (chat_id bigint, was_active boolean, handoff_until timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
    v_until         timestamptz;
begin
    select c.restaurant_id, c.handoff_until into v_restaurant_id, v_until
    from public.conversations c where c.id = p_conversation_id
    for update;
    if not found or not public.is_manager_of(v_restaurant_id) then
        raise exception 'not_found';
    end if;

    return query
    update public.conversations c
    set handoff_until = now() + interval '30 minutes',
        state = '{}'::jsonb
    where c.id = p_conversation_id
    returning c.chat_id, coalesce(v_until > now(), false), c.handoff_until;
end;
$$;

-- Перед ответом менеджера. Проверка «режим идёт» и продление — один UPDATE с условием: истёкший режим ответ
-- не «воскрешает» (менеджер держал вкладку открытой дольше тайм-аута — пусть подключится снова, гость получит
-- уведомление). Сценарий здесь не сбрасывается: гость мог сам нажать «Забронировать» во время ручного режима.
create function extend_manager_handoff(p_conversation_id uuid)
returns table (chat_id bigint, handoff_until timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
begin
    select c.restaurant_id into v_restaurant_id from public.conversations c where c.id = p_conversation_id;
    if not found or not public.is_manager_of(v_restaurant_id) then
        raise exception 'not_found';
    end if;

    return query
    update public.conversations c
    set handoff_until = now() + interval '30 minutes'
    where c.id = p_conversation_id and c.handoff_until > now()
    returning c.chat_id, c.handoff_until;

    if not found then
        raise exception 'handoff_inactive';
    end if;
end;
$$;

-- Отключение. was_active = false (режим уже истёк или не включался) — функция гостю ничего не пишет.
-- Без режима — no-op без UPDATE: нет лишнего события Realtime. restaurant_id — функции выбрать текст
-- уведомления («снова отвечает AI-помощник» или «через меню бота»).
create function end_manager_handoff(p_conversation_id uuid)
returns table (chat_id bigint, restaurant_id uuid, was_active boolean)
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
    v_chat_id       bigint;
    v_until         timestamptz;
begin
    select c.restaurant_id, c.chat_id, c.handoff_until into v_restaurant_id, v_chat_id, v_until
    from public.conversations c where c.id = p_conversation_id
    for update;
    if not found or not public.is_manager_of(v_restaurant_id) then
        raise exception 'not_found';
    end if;

    if v_until is not null then
        update public.conversations c set handoff_until = null where c.id = p_conversation_id;
    end if;

    return query select v_chat_id, v_restaurant_id, coalesce(v_until > now(), false);
end;
$$;

revoke execute on function begin_manager_handoff(uuid) from public, anon;
revoke execute on function extend_manager_handoff(uuid) from public, anon;
revoke execute on function end_manager_handoff(uuid) from public, anon;
grant execute on function begin_manager_handoff(uuid) to authenticated;
grant execute on function extend_manager_handoff(uuid) to authenticated;
grant execute on function end_manager_handoff(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. Ручной режим в списке диалогов

-- Тип результата меняется — только drop + create. Тело — как в 20261111110000_ai_admin.sql, handoff_until в конце.
drop function list_conversations_page(timestamptz, uuid, int);

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
    unread_count           int,
    flagged_at             timestamptz,
    flag_reason            text,
    handoff_until          timestamptz
)
language sql stable security invoker set search_path = ''
as $$
    select c.id, c.display_name, c.channel, c.created_at,
           c.last_message_at, c.last_message_preview, c.last_message_direction,
           c.manager_last_read_at, u.n, c.flagged_at, c.flag_reason, c.handoff_until
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

revoke execute on function list_conversations_page(timestamptz, uuid, int) from public, anon;
grant execute on function list_conversations_page(timestamptz, uuid, int) to authenticated;
