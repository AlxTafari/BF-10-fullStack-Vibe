-- S04, шаг 1 из 2 (расширение): валюта — свойство ресторана.
-- menu_items.currency пока остаётся, чтобы бот не падал до деплоя новой версии;
-- удаляется отдельной миграцией ПОСЛЕ деплоя бота.
alter table restaurants
    add column currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$');

-- Существующим ресторанам — самая частая валюта их блюд; нет блюд — остаётся 'EUR'.
update restaurants r
set currency = c.currency
from (
    select distinct on (restaurant_id) restaurant_id, currency
    from menu_items
    group by restaurant_id, currency
    order by restaurant_id, count(*) desc, currency
) c
where c.restaurant_id = r.id;
