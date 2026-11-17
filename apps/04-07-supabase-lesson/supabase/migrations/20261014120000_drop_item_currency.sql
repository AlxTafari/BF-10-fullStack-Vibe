-- S04, шаг 2 из 2 (сжатие): валюта живёт в restaurants.currency.
-- Накатывать ТОЛЬКО после деплоя бота, который не читает menu_items.currency.
alter table menu_items drop column currency;
