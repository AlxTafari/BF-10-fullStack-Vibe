-- Самопроверка ретеншна S06c на dev-БД. НЕ входит в seed.sql. Запуск: pnpm db:check:retention.
-- Всё идёт внутри одного DO-блока и в конце откатывается исключением: данные dev-БД остаются прежними
-- (в том числе то, что purge_old_data() заодно «удалил» бы из реальных старых строк). Результат — текст исключения:
--   «OK: …»   — все проверки прошли;   «FAIL: …» — первая провалившаяся проверка.
-- Границы сроков проверяются на минуты: 6 д 23 ч остаётся, 7 д 1 мин уходит; 89 д 23 ч остаётся, 90 д 1 мин уходит.
do $$
declare
    v_rest uuid;
    a uuid; b uuid; c uuid;           -- A: без заявок, B: с бронью, C: свежий, с границами
    v_booking uuid;
    n int;
    r record;
begin
    select id into v_rest from public.restaurants order by created_at limit 1;
    if v_rest is null then raise exception 'FAIL: в dev-БД нет ресторана — запусти seed'; end if;

    insert into public.conversations (restaurant_id, channel, external_user_id, chat_id, display_name)
    values (v_rest, 'telegram', -2001, -2001, 'ret A') returning id into a;
    insert into public.conversations (restaurant_id, channel, external_user_id, chat_id, display_name)
    values (v_rest, 'telegram', -2002, -2002, 'ret B') returning id into b;
    insert into public.conversations (restaurant_id, channel, external_user_id, chat_id, display_name)
    values (v_rest, 'telegram', -2003, -2003, 'ret C') returning id into c;

    -- A: всё старше сроков → сообщения уйдут, диалог без заявок тоже.
    insert into public.messages (conversation_id, direction, kind, text, created_at) values
        (a, 'in',  'text',   'A старый текст', now() - interval '100 days'),
        (a, 'in',  'search', 'A старый поиск', now() - interval '100 days');

    -- B: то же, но к диалогу привязана бронь → диалог остаётся, conversation_id брони не null.
    insert into public.messages (conversation_id, direction, kind, text, created_at) values
        (b, 'in', 'text', 'B старый текст', now() - interval '100 days');
    insert into public.booking_requests (restaurant_id, conversation_id, guest_name, contact, booking_at, guests_count, idempotency_key)
    values (v_rest, b, 'ret', 'ret', now() + interval '1 day', 2, 'ret-check-' || gen_random_uuid())
    returning id into v_booking;

    -- C: границы сроков.
    insert into public.messages (conversation_id, direction, kind, text, created_at) values
        (c, 'in', 'button', 'C кнопка 6д23ч (остаётся)',  now() - interval '6 days 23 hours'),
        (c, 'in', 'button', 'C кнопка 7д1м (уходит)',     now() - interval '7 days 1 minute'),
        (c, 'in', 'search', 'C поиск 8д (уходит)',        now() - interval '8 days'),
        (c, 'in', 'text',   'C текст 89д23ч (остаётся)',  now() - interval '89 days 23 hours'),
        (c, 'in', 'text',   'C текст 90д1м (уходит)',     now() - interval '90 days 1 minute');

    -- Служебные таблицы.
    insert into public.processed_updates (update_id, created_at) values (-3001, now() - interval '8 days'), (-3002, now() - interval '6 days');
    insert into public.rate_limits (external_user_id, window_start, hits) values (-4001, now() - interval '2 days', 3), (-4002, now(), 1);

    perform public.purge_old_data();

    -- A: диалог и сообщения удалены.
    if exists (select 1 from public.conversations where id = a) then raise exception 'FAIL: диалог A (без заявок) не удалён'; end if;
    -- B: диалог жив, сообщений нет, бронь связана, превью стёрто.
    if not exists (select 1 from public.conversations where id = b) then raise exception 'FAIL: диалог B с заявкой удалён'; end if;
    select count(*) into n from public.messages where conversation_id = b;
    if n <> 0 then raise exception 'FAIL: старые сообщения B не удалены (%)', n; end if;
    if (select conversation_id from public.booking_requests where id = v_booking) is distinct from b then
        raise exception 'FAIL: связка бронь → диалог потеряна';
    end if;
    if (select last_message_preview from public.conversations where id = b) is not null then
        raise exception 'FAIL: превью B не стёрто вместе с текстом';
    end if;
    -- C: остались ровно два сообщения-«остаётся».
    select count(*) into n from public.messages where conversation_id = c;
    if n <> 2 then raise exception 'FAIL: у C осталось % сообщений, ожидалось 2', n; end if;
    for r in select text from public.messages where conversation_id = c loop
        if r.text not like '%(остаётся)' then raise exception 'FAIL: удалилось не то: осталось «%»', r.text; end if;
    end loop;
    -- Служебные.
    if exists (select 1 from public.processed_updates where update_id = -3001) then raise exception 'FAIL: processed_updates старше 7 д не удалён'; end if;
    if not exists (select 1 from public.processed_updates where update_id = -3002) then raise exception 'FAIL: processed_updates младше 7 д удалён'; end if;
    if exists (select 1 from public.rate_limits where external_user_id = -4001) then raise exception 'FAIL: rate_limits старше суток не удалён'; end if;
    if not exists (select 1 from public.rate_limits where external_user_id = -4002) then raise exception 'FAIL: свежий rate_limits удалён'; end if;

    -- Идемпотентность: второй запуск ничего не меняет у наших строк.
    perform public.purge_old_data();
    select count(*) into n from public.messages where conversation_id = c;
    if n <> 2 then raise exception 'FAIL: повторный запуск изменил C (%)', n; end if;
    if not exists (select 1 from public.conversations where id = b) then raise exception 'FAIL: повторный запуск удалил B'; end if;

    raise exception 'OK: ретеншн прошёл все проверки (откат транзакции — данные dev-БД не тронуты)';
end;
$$;
