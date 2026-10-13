import { skipToken } from "@reduxjs/toolkit/query";
import { useGetMeQuery } from "@/api/authApi";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/features/common/LoadError";
import { RestaurantForm } from "./RestaurantForm";

export function RestaurantScreen() {
  // getMe уже загружен в AuthedLayout — здесь берём из кэша.
  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const { data, error, isLoading, refetch } = useGetRestaurantQuery(restaurantId ?? skipToken);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Ресторан</h1>
      {isLoading && <Skeleton className="h-96 w-full max-w-2xl" />}
      {error && <LoadError message={error.message ?? "Неизвестная ошибка"} onRetry={refetch} />}
      {data && restaurantId && <RestaurantForm restaurantId={restaurantId} restaurant={data} />}
    </section>
  );
}
