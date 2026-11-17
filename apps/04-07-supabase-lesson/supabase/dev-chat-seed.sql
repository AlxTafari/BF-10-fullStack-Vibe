-- Dev-seed для S06: длинный диалог для проверки курсорной пагинации чата. НЕ входит в seed.sql.
-- Запуск: pnpm db:seed:chat-demo. Откат: pnpm db:clean:chat-demo. Идемпотентно (диалог пересоздаётся).
--
-- ~250 сообщений с ЯВНЫМИ created_at, сгруппированными по 5 с одинаковой меткой: в одной вставке now() у всех
-- строк одно и то же, а нужны разные «ничьи» — чтобы граница страницы (30 строк) попадала то на середину
-- группы, то на её край. Метка с микросекундами (JS-Date их режет). Тексты пронумерованы №1…№250:
-- обход страниц должен дать последовательность без пропусков и повторов.
-- manager_last_read_at остаётся null: диалог «не открывали», непрочитанных больше потолка (99+).
-- external_user_id отрицательный — заведомо не реальный Telegram id.

delete from conversations where channel = 'telegram' and external_user_id = -1001;

with r as (select id from restaurants order by created_at limit 1),
c as (
    insert into conversations (restaurant_id, channel, external_user_id, chat_id, display_name)
    select r.id, 'telegram', -1001, -1001, 'Демо: длинный диалог' from r
    returning id
)
insert into messages (conversation_id, direction, kind, text, created_at)
select
    c.id,
    case when n % 2 = 1 then 'in' else 'out' end,
    case when n % 2 = 1 and n % 7 = 0 then 'button' else 'text' end,
    case
        when n % 2 = 1 and n % 7 = 0 then '[кнопка] menu:booking'
        when n = 250 then '№250 <b>x</b><script>alert(1)</script>'
        when n % 25 = 0 then '№' || n || ' ' || repeat('очень_длинное_слово_без_пробелов_', 6) || 'https://example.com/не-ссылка'
        when n % 31 = 0 then '№' || n || E' первая строка\nвторая строка\n\nчетвёртая после пустой'
        when n % 13 = 0 then '№' || n || ' 🍷🥗 эмодзи и кириллица'
        else '№' || n || case when n % 2 = 1 then ' вопрос гостя' else ' ответ бота' end
    end,
    -- 50 групп по 5 сообщений; минута между группами; общая дробная часть секунд = 123456 мкс.
    date_trunc('second', now()) - interval '10 days' + interval '123456 microseconds'
        + ((n - 1) / 5) * interval '1 minute'
from c, generate_series(1, 250) as n;
