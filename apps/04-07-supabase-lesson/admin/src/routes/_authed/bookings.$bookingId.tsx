import { createFileRoute } from "@tanstack/react-router";

// Сам маршрут ничего не рисует: список и боковая панель в родительском /bookings; адрес даёт ссылку на карточку.
export const Route = createFileRoute("/_authed/bookings/$bookingId")({ component: () => null });
