-- S07: отдельный лимит частоты на нажатия кнопок.
-- До этого в rate_limits было одно окно на гостя (текст вне сценария, S06c). Кнопки считаем в своём окне
-- (bucket = 'button'): иначе листание меню съедало бы лимит на сообщения, и наоборот.
-- purge_old_data() чистит rate_limits по window_start и бакетов не касается — правка не нужна.

alter table rate_limits add column bucket text not null default 'text'
    check (bucket in ('text', 'button'));
alter table rate_limits drop constraint rate_limits_pkey;
alter table rate_limits add primary key (external_user_id, bucket);

-- Сигнатура меняется (новый параметр) — старую функцию удаляем, иначе остались бы две перегрузки.
-- p_bucket с умолчанием 'text': уже задеплоенный бот зовёт RPC без него и продолжает работать до своего деплоя.
drop function check_rate_limit(bigint, int, int);

create function check_rate_limit(p_external_user_id bigint, p_max int, p_window_seconds int, p_bucket text default 'text')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
    v_hits   int;
    v_warned boolean;
    v_decision text;
begin
    -- Один SQL-оператор (upsert) → атомарно: два параллельных апдейта (двойной тап) не обходят лимит.
    insert into public.rate_limits as r (external_user_id, bucket, window_start, hits)
    values (p_external_user_id, p_bucket, now(), 1)
    on conflict (external_user_id, bucket) do update set
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
    where external_user_id = p_external_user_id and bucket = p_bucket and not warned
    returning 'warn' into v_decision;
    return coalesce(v_decision, 'drop');
end;
$$;

revoke execute on function check_rate_limit(bigint, int, int, text) from public, anon, authenticated;
grant execute on function check_rate_limit(bigint, int, int, text) to service_role;
