import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { type BookingsSearch, bookingsSearchSchema } from "@/domain/requestLists";
import { BookingsScreen } from "@/features/requests/BookingsScreen";

// Фильтры списка — в URL (?tab=pending&when=upcoming&size=20); неверное значение → значение по умолчанию.
// Тип параметра с SearchSchemaInput: при навигации поля поиска необязательны (недостающие заполнит схема).
// Layout без <Outlet>: карточку открытой брони BookingsScreen читает из параметров дочернего маршрута.
export const Route = createFileRoute("/_authed/bookings")({
  validateSearch: (search: Partial<BookingsSearch> & SearchSchemaInput): BookingsSearch => bookingsSearchSchema.parse(search),
  component: BookingsScreen,
});
