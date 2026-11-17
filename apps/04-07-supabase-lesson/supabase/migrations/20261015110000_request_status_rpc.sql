-- S05, часть 2: смена статусов заявок (RPC) и уведомление гостя о решении по брони.
-- У authenticated нет update на заявки (см. часть 1): статус меняется только этими функциями.

-- ---------------------------------------------------------------- уведомление гостя

-- Когда гость получил сообщение о решении. null = не получал: либо сообщение ещё в пути, либо отправка не удалась.
-- RPC сбрасывает в null при каждой смене статуса, notify-guest ставит после отправки.
alter table booking_requests add column guest_notified_at timestamptz;

create extension if not exists pg_net with schema extensions;

-- Триггер шлёт запрос в Edge Function notify-guest, но ТОЛЬКО если статус меняет менеджер через RPC:
-- RPC на время своего update ставит флаг транзакции app.notify_guest = '1'. Бот (отмена гостем) меняет статус
-- прямым update без флага — гость сам себе уведомление не получает. Каскадные отмены в RPC выполняются вне флага.
-- URL функции и секрет лежат в Vault (в миграции их быть не должно), см. README админки.
-- net.http_post ставит запрос в очередь и уходит после COMMIT: откат транзакции = уведомления нет.
-- Любой сбой здесь (нет секретов, нет pg_net) не должен откатить решение менеджера — только предупреждение.
create function notify_guest_on_booking_decision() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    v_url    text;
    v_secret text;
begin
    if coalesce(current_setting('app.notify_guest', true), '') <> '1' then
        return new;
    end if;
    if new.conversation_id is null then
        return new; -- некому писать
    end if;

    begin
        select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_guest_url';
        select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_guest_secret';
        if v_url is null or v_secret is null then
            raise warning 'notify-guest: секреты notify_guest_url / notify_guest_secret не заданы в Vault';
            return new;
        end if;

        perform net.http_post(
            url     := v_url,
            body    := jsonb_build_object('booking_id', new.id, 'status', new.status),
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret)
        );
    exception when others then
        raise warning 'notify-guest: не удалось поставить запрос в очередь: %', sqlerrm;
    end;
    return new;
end;
$$;

create trigger booking_requests_notify_guest
    after update of status on booking_requests
    for each row
    when (old.status is distinct from new.status)
    execute function notify_guest_on_booking_decision();

-- ---------------------------------------------------------------- RPC: бронь

-- Ошибки — исключения с фиксированным текстом (клиент выбирает сообщение по error.message):
-- not_found, not_manager, status_conflict, transition_not_allowed, booking_in_past, original_not_active.
create function set_booking_status(p_id uuid, p_from text, p_to text) returns booking_requests
language plpgsql security definer set search_path = ''
as $$
declare
    v_replaces_id uuid;
    v_row         public.booking_requests;
    v_original    public.booking_requests;
begin
    -- Порядок блокировок всегда «исходная бронь → её изменение»: иначе подтверждение изменения
    -- и закрытие исходной брони, идущие одновременно, взяли бы строки в разном порядке (взаимная блокировка).
    -- replaces_id не меняется после создания, поэтому читать его без блокировки безопасно.
    select replaces_id into v_replaces_id from public.booking_requests where id = p_id;
    if not found then
        raise exception 'not_found';
    end if;
    if v_replaces_id is not null then
        perform 1 from public.booking_requests where id = v_replaces_id for update;
    end if;

    select * into v_row from public.booking_requests where id = p_id for update;

    if not public.is_manager_of(v_row.restaurant_id) then
        raise exception 'not_manager';
    end if;
    -- Оптимистичная блокировка: решение принимается по состоянию, которое менеджер видел на экране.
    if v_row.status <> p_from then
        raise exception 'status_conflict';
    end if;
    if not (
        (p_from = 'pending'   and p_to in ('confirmed', 'declined', 'cancelled')) or
        (p_from = 'confirmed' and p_to = 'cancelled')
    ) then
        raise exception 'transition_not_allowed';
    end if;
    if p_to = 'confirmed' and v_row.booking_at < now() then
        raise exception 'booking_in_past';
    end if;

    -- Каскад 1: подтверждение запроса на изменение отменяет исходную бронь (обе записи или ни одной).
    if p_to = 'confirmed' and v_replaces_id is not null then
        select * into v_original from public.booking_requests where id = v_replaces_id;
        if not found or v_original.status not in ('pending', 'confirmed') then
            raise exception 'original_not_active';
        end if;
        update public.booking_requests set status = 'cancelled' where id = v_replaces_id;
    end if;

    -- Каскад 2: у закрытой брони не остаётся «висящего» запроса на изменение (как при отмене гостем в боте).
    if p_to in ('declined', 'cancelled') then
        update public.booking_requests set status = 'cancelled'
            where replaces_id = p_id and status = 'pending';
    end if;

    -- Флаг — только вокруг основного update: каскады выше гостя не уведомляют (одно сообщение на решение).
    perform set_config('app.notify_guest', '1', true);
    update public.booking_requests
        set status = p_to, guest_notified_at = null
        where id = p_id
        returning * into v_row;
    perform set_config('app.notify_guest', '', true);

    return v_row;
end;
$$;

-- ---------------------------------------------------------------- RPC: обращения

-- Матрица свободная: любой переход между разными статусами (включая «переоткрыть»). Гость не уведомляется.
create function set_guest_request_status(p_id uuid, p_from text, p_to text) returns guest_requests
language plpgsql security definer set search_path = ''
as $$
declare
    v_row public.guest_requests;
begin
    select * into v_row from public.guest_requests where id = p_id for update;
    if not found then
        raise exception 'not_found';
    end if;
    if not public.is_manager_of(v_row.restaurant_id) then
        raise exception 'not_manager';
    end if;
    if v_row.status <> p_from then
        raise exception 'status_conflict';
    end if;
    if p_to not in ('new', 'in_progress', 'resolved') or p_to = p_from then
        raise exception 'transition_not_allowed';
    end if;

    update public.guest_requests set status = p_to where id = p_id returning * into v_row;
    return v_row;
end;
$$;

-- Функции в public по умолчанию доступны всем (в Supabase — ещё и anon явным грантом): оставляем только authenticated.
-- Триггерная функция клиентам не нужна вовсе.
revoke execute on function set_booking_status(uuid, text, text) from public, anon;
revoke execute on function set_guest_request_status(uuid, text, text) from public, anon;
revoke execute on function notify_guest_on_booking_decision() from public, anon, authenticated;
grant execute on function set_booking_status(uuid, text, text) to authenticated;
grant execute on function set_guest_request_status(uuid, text, text) to authenticated;
