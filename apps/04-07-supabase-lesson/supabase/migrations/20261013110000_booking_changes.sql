-- S03 (дополнение «Мои заявки»): изменение брони = новая заявка со ссылкой на исходную.
alter table booking_requests
    add column replaces_id uuid references booking_requests (id) on delete set null;

-- У брони не больше одного ожидающего изменения. Инвариант держит БД: два параллельных запроса не создадут двойник.
create unique index booking_requests_one_pending_change_uidx
    on booking_requests (replaces_id)
    where replaces_id is not null and status = 'pending';
