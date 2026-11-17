-- S09, сессия 5: админка AI-слоя.
--   1. «Разобрано» — снятие пометки угрозы с диалога (ставит бот, tool flagThreat).
--   2. Пометка угрозы в списке диалогов (list_conversations_page отдаёт flagged_at / flag_reason).
--   3. Статистика AI: расход ходов агента из messages.meta по дням и моделям.

-- ---------------------------------------------------------------- 1. «Разобрано»

-- Вторая запись клиента в conversations (первая — mark_conversation_read); прямой update политикой закрыт.
-- Снимает пару flagged_at / flag_reason целиком (check conversations_flag_pair). Не помечен — no-op без UPDATE:
-- нет лишнего события Realtime, а повторное нажатие из второй вкладки не ошибка.
-- Чужой и несуществующий диалог неотличимы (not_found), как в mark_conversation_read.
create function resolve_conversation_flag(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
    v_restaurant_id uuid;
begin
    select restaurant_id into v_restaurant_id from public.conversations where id = p_conversation_id;
    if not found or not public.is_manager_of(v_restaurant_id) then
        raise exception 'not_found';
    end if;

    update public.conversations
    set flagged_at = null, flag_reason = null
    where id = p_conversation_id and flagged_at is not null;
end;
$$;

revoke execute on function resolve_conversation_flag(uuid) from public, anon;
grant execute on function resolve_conversation_flag(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. Пометка в списке диалогов

-- Тип результата меняется — create or replace не подходит, только drop + create. Тело — как в S06
-- (20261018100000_admin_chat.sql), добавлены две колонки в конец.
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
    flag_reason            text
)
language sql stable security invoker set search_path = ''
as $$
    select c.id, c.display_name, c.channel, c.created_at,
           c.last_message_at, c.last_message_preview, c.last_message_direction,
           c.manager_last_read_at, u.n, c.flagged_at, c.flag_reason
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

-- ---------------------------------------------------------------- 3. Статистика AI

-- Выборка «сообщения с meta за период» по всем диалогам: messages_cursor_idx начинается с conversation_id и тут
-- не помогает. Частичный индекс маленький: meta есть только у ответов агента и запасных ответов.
create index messages_meta_created_idx on messages (created_at) where meta is not null;

-- Расход по дням (в зоне ресторана) и моделям за [p_from, p_to). Агрегирует БД: в админку приходит до
-- «дней × моделей» строк, а не тысячи сообщений. Деньги здесь не считаются: цены меняются, админка считает
-- стоимость при показе по таблице цен с датами действия — для этого и разбивка по дню и модели.
--   turns — ходы агента (meta.ai); ms_total — их суммарное время (среднее = ms_total / turns);
--   fallback_* — запасные ответы по причинам (meta.aiFallback); их токены тоже в суммах: оплачены, если модель
--   успела ответить хоть раз (таймаут на третьем раунде);
--   model — '' у запасного ответа без модели (ключа нет — до вызова модели не дошло).
-- security invoker: RLS messages / conversations — менеджер видит только свой ресторан.
-- Окно ограничено 400 днями: защита от случайного «за всё время» по большой таблице.
create function ai_usage_daily(p_from timestamptz, p_to timestamptz)
returns table (
    day              date,
    model            text,
    turns            int,
    calls            int,
    input_tokens     bigint,
    output_tokens    bigint,
    thought_tokens   bigint,
    ms_total         bigint,
    fallback_error   int,
    fallback_timeout int,
    fallback_quota   int,
    fallback_limit   int
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
    if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
        raise exception 'invalid_range';
    end if;

    return query
    select (m.created_at at time zone r.timezone)::date as day,
           coalesce(m.meta->>'model', '') as model,
           (count(*) filter (where m.meta->>'ai' = 'true'))::int,
           coalesce(sum((m.meta->>'calls')::int), 0)::int,
           coalesce(sum((m.meta->>'inputTokens')::bigint), 0)::bigint,
           coalesce(sum((m.meta->>'outputTokens')::bigint), 0)::bigint,
           coalesce(sum((m.meta->>'thoughtTokens')::bigint), 0)::bigint,
           coalesce(sum((m.meta->>'ms')::bigint) filter (where m.meta->>'ai' = 'true'), 0)::bigint,
           (count(*) filter (where m.meta->>'aiFallback' = 'error'))::int,
           (count(*) filter (where m.meta->>'aiFallback' = 'timeout'))::int,
           (count(*) filter (where m.meta->>'aiFallback' = 'quota'))::int,
           (count(*) filter (where m.meta->>'aiFallback' = 'limit'))::int
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.restaurants r on r.id = c.restaurant_id
    where m.meta is not null
      and m.created_at >= p_from and m.created_at < p_to
      and (m.meta ? 'ai' or m.meta ? 'aiFallback')
    group by 1, 2
    order by 1, 2;
end;
$$;

revoke execute on function ai_usage_daily(timestamptz, timestamptz) from public, anon;
grant execute on function ai_usage_daily(timestamptz, timestamptz) to authenticated;
