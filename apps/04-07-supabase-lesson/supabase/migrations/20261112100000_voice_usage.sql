-- S09, сессия 4: голосовые гостя. Распознавание — отдельная группа в статистике AI рядом с ответами агента.
-- Схема messages не меняется: голосовое пишется в meta.voice (fileId, длительность, расход распознавания).

-- Расход по дням (в зоне ресторана), источнику и модели за [p_from, p_to). Было — по дням и моделям (сессия 5);
-- добавлен source, поэтому тип результата другой: только drop + create.
--   source = 'agent' — ходы агента и запасные ответы (meta.ai / meta.aiFallback), как раньше:
--     turns — ходы агента; ms_total — их суммарное время (среднее = ms_total / turns);
--     fallback_* — запасные ответы по причинам; их токены тоже в суммах (оплачены, если модель успела ответить);
--     model — '' у запасного ответа без модели (ключа нет, лимит — до вызова модели не дошло).
--   source = 'voice' — распознавание голосовых (meta.voice), и автоматическое для агента, и по кнопке менеджера:
--     voice_transcribed — распознано (есть transcribedBy), voice_failed — модель вызвана, но текста нет
--     (речь не разобрать, сбой модели); ms_total — суммарное время распознавания; turns и fallback_* = 0.
--     Голосовые без вызова модели (ручной режим, отказы, файл не скачан) в статистику не попадают: в них нет model.
--     Распознавание по кнопке относится ко дню самого голосового, а не дню нажатия: так проще, расход тот же.
-- Деньги здесь не считаются: админка считает стоимость при показе по таблице цен с датами действия.
-- security invoker: RLS messages / conversations — менеджер видит только свой ресторан.
-- Окно ограничено 400 днями: защита от случайного «за всё время» по большой таблице.
drop function ai_usage_daily(timestamptz, timestamptz);

create function ai_usage_daily(p_from timestamptz, p_to timestamptz)
returns table (
    day               date,
    source            text,
    model             text,
    turns             int,
    calls             int,
    input_tokens      bigint,
    output_tokens     bigint,
    thought_tokens    bigint,
    ms_total          bigint,
    fallback_error    int,
    fallback_timeout  int,
    fallback_quota    int,
    fallback_limit    int,
    voice_transcribed int,
    voice_failed      int
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
    if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
        raise exception 'invalid_range';
    end if;

    -- Колонки CTE названы не day/source/model: в plpgsql это имена выходных параметров, совпадение дало бы
    -- «column reference is ambiguous».
    return query
    with usage as (
        select (m.created_at at time zone r.timezone)::date as d,
               'agent'::text as src,
               coalesce(m.meta->>'model', '') as mdl,
               m.meta as u
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        join public.restaurants r on r.id = c.restaurant_id
        where m.meta is not null
          and m.created_at >= p_from and m.created_at < p_to
          and (m.meta ? 'ai' or m.meta ? 'aiFallback')
        union all
        select (m.created_at at time zone r.timezone)::date,
               'voice'::text,
               m.meta->'voice'->>'model',
               m.meta->'voice'
        from public.messages m
        join public.conversations c on c.id = m.conversation_id
        join public.restaurants r on r.id = c.restaurant_id
        where m.meta is not null
          and m.created_at >= p_from and m.created_at < p_to
          and m.meta->'voice' ? 'model'
    )
    select x.d,
           x.src,
           x.mdl,
           (count(*) filter (where x.u->>'ai' = 'true'))::int,
           coalesce(sum((x.u->>'calls')::int), 0)::int,
           coalesce(sum((x.u->>'inputTokens')::bigint), 0)::bigint,
           coalesce(sum((x.u->>'outputTokens')::bigint), 0)::bigint,
           coalesce(sum((x.u->>'thoughtTokens')::bigint), 0)::bigint,
           coalesce(sum((x.u->>'ms')::bigint) filter (where x.u->>'ai' = 'true' or x.src = 'voice'), 0)::bigint,
           (count(*) filter (where x.u->>'aiFallback' = 'error'))::int,
           (count(*) filter (where x.u->>'aiFallback' = 'timeout'))::int,
           (count(*) filter (where x.u->>'aiFallback' = 'quota'))::int,
           (count(*) filter (where x.u->>'aiFallback' = 'limit'))::int,
           (count(*) filter (where x.src = 'voice' and x.u ? 'transcribedBy'))::int,
           (count(*) filter (where x.src = 'voice' and x.u ? 'transcribeError'))::int
    from usage x
    group by 1, 2, 3
    order by 1, 2, 3;
end;
$$;

revoke execute on function ai_usage_daily(timestamptz, timestamptz) from public, anon;
grant execute on function ai_usage_daily(timestamptz, timestamptz) to authenticated;
