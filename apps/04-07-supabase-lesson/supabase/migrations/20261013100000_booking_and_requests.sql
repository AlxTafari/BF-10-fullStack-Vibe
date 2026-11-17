-- S03: бронь и обращения. Уведомление менеджеру и структурные часы работы.

-- Куда слать уведомления о заявках. null = уведомления выключены.
-- Менеджер должен сам нажать /start у бота, иначе Telegram не даст боту написать первым.
alter table restaurants add column manager_chat_id bigint;

-- Структурные часы работы для проверки брони (свободный текст working_hours остаётся для показа гостю).
-- Ключ — ISO-день недели ("1" = понедельник … "7" = воскресенье), значение — {"open": "13:00", "close": "24:00"}.
-- Нет ключа = выходной. Колонка null = часы неизвестны, бронь по часам не ограничиваем.
alter table restaurants add column opening_hours jsonb;

-- null после создания заявки; ставится после успешной отправки уведомления менеджеру.
-- Сбой уведомления не теряет заявку и виден в БД.
alter table booking_requests add column manager_notified_at timestamptz;
alter table guest_requests   add column manager_notified_at timestamptz;
