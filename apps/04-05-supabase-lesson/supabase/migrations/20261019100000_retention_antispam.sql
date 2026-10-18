-- S06c: ретеншн сообщений и антиспам бота.
-- Порядок выкатки: сначала эта миграция, потом деплой бота (старый бот значение 'search' не пишет и таблицу
-- rate_limits не трогает — совместим).

-- ---------------------------------------------------------------- тип сообщения «поиск»
-- Свободный текст гостя, ушедший в поиск блюда, и ответ бота на него. Триггер messages_after_insert (S06) и
-- «непрочитанные» смотрят только на kind = 'text' → поиск не подменяет превью и не считается непрочитанным.
-- Исторические поиски остаются 'text': задним числом их не отличить от обычного текста.
alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check check (kind in ('text', 'button', 'search'));

-- Очистка идёт по created_at без conversation_id — индекс messages_cursor_idx (conversation_id первым) не подходит.
create index messages_created_at_idx on messages (created_at);

-- ---------------------------------------------------------------- антиспам: счётчик на гостя
-- Edge Function не хранит состояние между запросами, поэтому счётчик живёт в БД. Ключ — external_user_id
-- (Telegram id), а не conversation_id: у нового гостя диалога ещё может не быть.
-- Окно фиксированное: одна строка на гостя, один upsert. Цена — на стыке окон возможны до 2×лимит сообщений подряд.
create table rate_limits (
    external_user_id bigint primary key,
    window_start     timestamptz not null,
    hits             int not null,
    -- Предупреждение «слишком часто» уже отправлено в этом окне: дальше бот молчит.
    warned           boolean not null default false
);
-- RLS включён, политик нет: читает и пишет только service_role (бот) и security definer функции.
alter table rate_limits enable row level security;

-- Решение по одному входящему сообщению: 'allowed' | 'warn' | 'drop'.
-- Один SQL-оператор (upsert) → атомарно: два параллельных апдейта (двойной тап) не обходят лимит.
-- Лимит и окно приходят параметрами из кода бота (domain/antispam.ts) — магических чисел в SQL нет.
create function check_rate_limit(p_external_user_id bigint, p_max int, p_window_seconds int)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
    v_hits   int;
    v_warned boolean;
    v_decision text;
begin
    insert into public.rate_limits as r (external_user_id, window_start, hits)
    values (p_external_user_id, now(), 1)
    on conflict (external_user_id) do update set
        -- окно истекло → новое окно с нуля (счётчик и флаг предупреждения сбрасываются)
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                            then now() else r.window_start end,
        hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                            then 1 else r.hits + 1 end,
        warned       = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                            then false else r.warned end
    returning r.hits, r.warned into v_hits, v_warned;

    if v_hits <= p_max then
        return 'allowed';
    end if;
    if v_warned then
        return 'drop';
    end if;

    -- Первое превышение в окне: помечаем предупреждение отправленным. Условие `not warned` делает пометку
    -- атомарной: если два апдейта одновременно увидели warned = false, предупреждение получит только один.
    update public.rate_limits set warned = true
    where external_user_id = p_external_user_id and not warned
    returning 'warn' into v_decision;
    return coalesce(v_decision, 'drop');
end;
$$;

revoke execute on function check_rate_limit(bigint, int, int) from public, anon, authenticated;
grant execute on function check_rate_limit(bigint, int, int) to service_role;

-- ---------------------------------------------------------------- ретеншн
-- Лестница сроков (константы здесь, одна правка — один сдвиг):
--   messages kind in (button, search) — 7 дней;  messages kind = text — 90 дней;
--   processed_updates — 7 дней;  rate_limits — 1 день;
--   conversations — 90 дней без активности, ЕСЛИ нет сообщений и нет заявок.
-- Заявки (booking_requests, guest_requests) не удаляются никогда. Диалог, к которому привязана заявка, тоже:
-- иначе conversation_id заявки (on delete set null) стал бы null и связка «заявка → диалог» пропала бы.
--
-- Удаление пачками: одним огромным delete держались бы блокировки и раздувался WAL. За запуск — не больше
-- v_max_batches пачек; остаток доберёт следующий запуск. Возвращает счётчики (текст сообщений в журнал не пишем).
create function purge_old_data()
returns table (
    purged_noise         int,
    purged_text          int,
    purged_updates       int,
    purged_rate_limits   int,
    cleared_previews     int,
    purged_conversations int
)
language plpgsql security definer set search_path = ''
as $$
declare
    v_batch       constant int := 5000;
    v_max_batches constant int := 100;
    v_noise_cutoff constant timestamptz := now() - interval '7 days';
    v_text_cutoff  constant timestamptz := now() - interval '90 days';
    v_n int;
    i   int;
begin
    purged_noise := 0; purged_text := 0; purged_updates := 0; purged_rate_limits := 0;
    cleared_previews := 0; purged_conversations := 0;

    -- Нажатия кнопок и поиск.
    for i in 1..v_max_batches loop
        delete from public.messages where ctid in (
            select ctid from public.messages
            where kind in ('button', 'search') and created_at < v_noise_cutoff
            limit v_batch);
        get diagnostics v_n = row_count;
        purged_noise := purged_noise + v_n;
        exit when v_n < v_batch;
    end loop;

    -- Обычный текст.
    for i in 1..v_max_batches loop
        delete from public.messages where ctid in (
            select ctid from public.messages
            where kind = 'text' and created_at < v_text_cutoff
            limit v_batch);
        get diagnostics v_n = row_count;
        purged_text := purged_text + v_n;
        exit when v_n < v_batch;
    end loop;

    -- Превью — копия текста сообщения (до 120 символов): если диалог молчит дольше срока текста, его последнее
    -- текстовое сообщение уже удалено, и превью надо стереть вместе с ним (иначе текст гостя живёт в conversations).
    update public.conversations
    set last_message_preview = null, last_message_direction = null
    where last_message_preview is not null and last_message_at < v_text_cutoff;
    get diagnostics cleared_previews = row_count;

    -- Служебные таблицы.
    delete from public.processed_updates where created_at < now() - interval '7 days';
    get diagnostics purged_updates = row_count;
    delete from public.rate_limits where window_start < now() - interval '1 day';
    get diagnostics purged_rate_limits = row_count;

    -- Опустевшие диалоги без заявок.
    delete from public.conversations c
    where coalesce(c.last_message_at, c.created_at) < v_text_cutoff
      and not exists (select 1 from public.messages m where m.conversation_id = c.id)
      and not exists (select 1 from public.booking_requests b where b.conversation_id = c.id)
      and not exists (select 1 from public.guest_requests g where g.conversation_id = c.id);
    get diagnostics purged_conversations = row_count;

    return next;
end;
$$;

-- Запускает только владелец и pg_cron: клиентам (anon/authenticated) и service_role очистка не нужна.
revoke execute on function purge_old_data() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- расписание
-- pg_cron: раз в сутки в 03:17 UTC (не на круглой минуте — меньше совпадений с чужими заданиями).
-- Если расширение недоступно на тарифе — запасной путь описан в спеке S06c (вопрос 1).
create extension if not exists pg_cron;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'purge-old-data') then
        perform cron.unschedule('purge-old-data');
    end if;
    perform cron.schedule('purge-old-data', '17 3 * * *', 'select public.purge_old_data()');
end;
$$;
