import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useUpdateRestaurantMutation } from "@/api/restaurantApi";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CURRENCIES,
  type RestaurantFormValues,
  type RestaurantRecord,
  restaurantSchema,
  toFormValues,
  toRestaurantUpdate,
} from "@/domain/restaurantSchema";
import { OpeningHoursEditor } from "./OpeningHoursEditor";

// Список поясов для подсказок в поле. Валидность проверяет схема (Intl), а не этот список.
const TIMEZONES = Intl.supportedValuesOf("timeZone");

interface Props {
  restaurantId: string;
  restaurant: RestaurantRecord;
}

export function RestaurantForm({ restaurantId, restaurant }: Props) {
  const [updateRestaurant, { isLoading }] = useUpdateRestaurantMutation();
  const form = useForm<RestaurantFormValues>({
    resolver: zodResolver(restaurantSchema),
    // defaultValues читаются один раз при монтировании: фоновый refetch не затирает правки менеджера.
    defaultValues: toFormValues(restaurant),
  });

  // Валюта ресторана могла быть заведена руками и не входить в наш список — показываем и её.
  const currencies = CURRENCIES.includes(restaurant.currency as (typeof CURRENCIES)[number])
    ? CURRENCIES
    : [restaurant.currency, ...CURRENCIES];

  async function onSubmit(values: RestaurantFormValues) {
    const result = await updateRestaurant({ restaurantId, patch: toRestaurantUpdate(values) });
    if (result.error) {
      // Данные формы не сбрасываем: менеджер не должен терять ввод из-за сбоя сети.
      toast.error(`Не удалось сохранить: ${result.error.message}`);
      return;
    }
    // Новая «базовая линия» формы — то, что реально лежит в БД: кнопка снова неактивна до следующей правки.
    form.reset(toFormValues(result.data));
    toast.success("Сохранено");
  }

  const { isDirty } = form.formState;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-2xl space-y-6" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Описание</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Адрес</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Телефон</FormLabel>
                <FormControl>
                  <Input type="tel" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="working_hours"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Часы работы (текст для гостей)</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Показывается гостю в карточке «О ресторане» как есть.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Часовой пояс</FormLabel>
                <FormControl>
                  {/* Input + datalist: поиск по подстроке «из коробки», без отдельной зависимости. */}
                  <Input list="timezones" autoComplete="off" {...field} />
                </FormControl>
                <datalist id="timezones">
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
                <FormDescription>
                  Меняйте редко: брони хранятся в UTC и не пересчитываются, смена пояса сдвинет все будущие брони по
                  местному времени.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Валюта меню</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {currencies.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Цены блюд не пересчитываются — меняется только обозначение валюты.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="hours"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Часы работы для брони</FormLabel>
              <OpeningHoursEditor value={field.value} onChange={field.onChange} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="manager_chat_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telegram chat id менеджера</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="Пусто — уведомления выключены" {...field} />
              </FormControl>
              <FormDescription>
                Сюда бот присылает новые заявки. Менеджер должен сам написать боту /start, иначе Telegram не даст
                боту написать первым. Как узнать id — в README проекта.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Недоступна, пока форма не изменена; невалидную форму handleSubmit не отправит и покажет ошибки. */}
        <Button type="submit" disabled={!isDirty || isLoading}>
          {isLoading ? "Сохраняем…" : "Сохранить"}
        </Button>
      </form>
    </Form>
  );
}
