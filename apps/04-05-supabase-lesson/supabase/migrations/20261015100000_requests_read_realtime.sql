-- S05, часть 1: чтение заявок менеджером и Realtime.
-- Запись статусов (RPC), уведомление гостя — отдельной миграцией после проверки Realtime.

-- select для authenticated: только заявки своего ресторана. Эту же политику применяет Realtime:
-- postgres_changes доставляет подписчику только строки, которые он вправе читать.
-- insert/update/delete политик нет — клиент заявки не меняет (статус — через RPC, следующая миграция).
create policy booking_requests_select on booking_requests
    for select to authenticated
    using (is_manager_of(restaurant_id));

create policy guest_requests_select on guest_requests
    for select to authenticated
    using (is_manager_of(restaurant_id));

-- В payload UPDATE приходит new целиком — replica identity full не нужен.
alter publication supabase_realtime add table booking_requests, guest_requests;

-- Список «предстоящие по времени» (вкладки броней).
create index booking_requests_restaurant_booking_at_idx
    on booking_requests (restaurant_id, booking_at);
