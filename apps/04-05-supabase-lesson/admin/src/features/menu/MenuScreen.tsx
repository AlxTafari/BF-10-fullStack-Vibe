import { skipToken } from "@reduxjs/toolkit/query";
import { useParams } from "@tanstack/react-router";
import { useGetMeQuery } from "@/api/authApi";
import { useGetCategoriesQuery, useGetMenuItemsQuery } from "@/api/menuApi";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import { Skeleton } from "@/components/ui/skeleton";
import { NO_CATEGORY } from "@/domain/dishSchema";
import { LoadError } from "@/features/common/LoadError";
import { CategoriesPanel } from "./CategoriesPanel";
import { ItemsPanel } from "./ItemsPanel";

export function MenuScreen() {
  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const arg = restaurantId ?? skipToken;
  const categories = useGetCategoriesQuery(arg);
  const items = useGetMenuItemsQuery(arg);
  // Валюта — свойство ресторана; у блюда своей валюты нет.
  const restaurant = useGetRestaurantQuery(arg);
  // Выбранная категория — параметр дочернего маршрута /menu/$categoryId (strict: false — мы в родителе).
  const { categoryId } = useParams({ strict: false }) as { categoryId?: string };

  const error = categories.error ?? items.error ?? restaurant.error;
  const loading = categories.isLoading || items.isLoading || restaurant.isLoading;

  function retry() {
    categories.refetch();
    items.refetch();
    restaurant.refetch();
  }

  if (error) return <LoadError message={error.message ?? "Неизвестная ошибка"} onRetry={retry} />;
  if (loading || !categories.data || !items.data || !restaurant.data || !restaurantId) {
    return <Skeleton className="h-64 w-full" />;
  }

  // Нет параметра (или категория удалена) → первая категория, а если их нет — «Без категории».
  const known = new Set<string>([NO_CATEGORY, ...categories.data.map((c) => c.id)]);
  const selectedId =
    categoryId && known.has(categoryId) ? categoryId : (categories.data[0]?.id ?? NO_CATEGORY);
  const selected = categories.data.find((c) => c.id === selectedId);
  const visibleItems = items.data.filter((i) => i.category_id === (selected ? selected.id : null));

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Меню</h1>
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <CategoriesPanel
          restaurantId={restaurantId}
          categories={categories.data}
          items={items.data}
          selectedId={selectedId}
        />
        <ItemsPanel
          restaurantId={restaurantId}
          currency={restaurant.data.currency}
          categories={categories.data}
          items={visibleItems}
          title={selected?.name ?? "Без категории"}
          selectedId={selectedId}
        />
      </div>
    </section>
  );
}
