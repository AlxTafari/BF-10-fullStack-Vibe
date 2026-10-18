-- S06d: анти-дубли в чате бота. Порядок выкатки: сначала эта миграция, потом деплой бота (старый бот колонку
-- не читает и не пишет — совместим).

-- Последнее навигационное сообщение бота в диалоге: { screen, message_id, at, faq_answer_id? }.
-- Одна запись на диалог, перезаписывается при каждом показе навигационного экрана — растущего состояния нет.
-- faq_answer_id — message_id последнего ответа FAQ с клавиатурой; живёт отдельно от screen/message_id, потому что
-- между ответами гость может открыть другой раздел, а предыдущий ответ всё равно должен потерять кнопки.
-- Колонка, а не поле state: state принадлежит сценариям (resetFlow/cancelFlow его сбрасывают), навигация не должна
-- пропадать вместе с брошенной бронью.
-- UPDATE, меняющий только last_nav, порождает Realtime-событие без смены last_message_at/превью/отметки — админка
-- такие события игнорирует (S06, инвариант 9). Список диалогов для админки last_nav не отдаёт.
alter table conversations add column last_nav jsonb;

-- Compare-and-swap по message_id: пишет экран и сообщение, только если сейчас там ровно p_expected
-- (null = «записи ещё нет»). Возвращает, обновилась ли строка. Один UPDATE с условием атомарен: из двух
-- параллельных апдейтов (двойной тап) true получит один. faq_answer_id сохраняется (merge), а не затирается.
create function set_last_nav(p_conversation_id uuid, p_expected bigint, p_screen text, p_message_id bigint)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    v_rows int;
begin
    update public.conversations
    set last_nav = coalesce(last_nav, '{}'::jsonb) || jsonb_build_object(
        'screen', p_screen, 'message_id', p_message_id, 'at', now())
    where id = p_conversation_id
      and (last_nav ->> 'message_id')::bigint is not distinct from p_expected;
    get diagnostics v_rows = row_count;
    return v_rows > 0;
end;
$$;

-- Compare-and-swap по faq_answer_id: записывает message_id нового ответа FAQ. swapped = false — параллельный апдейт
-- опередил; previous_id — прежний ответ, у которого надо снять клавиатуру (null, если его не было).
-- Прежнее значение читается под блокировкой строки (for update), чтобы CAS и чтение были одним шагом.
create function set_faq_answer(p_conversation_id uuid, p_expected bigint, p_new bigint)
returns table (swapped boolean, previous_id bigint)
language plpgsql security definer set search_path = ''
as $$
declare
    v_current bigint;
begin
    select (last_nav ->> 'faq_answer_id')::bigint into v_current
    from public.conversations where id = p_conversation_id for update;

    if not found or v_current is distinct from p_expected then
        return query select false, v_current;
        return;
    end if;

    update public.conversations
    set last_nav = jsonb_set(coalesce(last_nav, '{}'::jsonb), '{faq_answer_id}', to_jsonb(p_new))
    where id = p_conversation_id;
    return query select true, v_current;
end;
$$;

revoke execute on function set_last_nav(uuid, bigint, text, bigint) from public, anon, authenticated;
grant execute on function set_last_nav(uuid, bigint, text, bigint) to service_role;
revoke execute on function set_faq_answer(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function set_faq_answer(uuid, bigint, bigint) to service_role;
