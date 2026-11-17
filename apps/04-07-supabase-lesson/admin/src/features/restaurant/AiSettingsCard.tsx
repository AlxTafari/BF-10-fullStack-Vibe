import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useGetAiSettingsQuery, useUpdateAiSettingsMutation } from "@/api/restaurantApi";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  type AiSettingsFormValues,
  type AiSettingsRecord,
  DAILY_TURN_LIMIT_RANGE,
  HISTORY_WINDOW_RANGE,
  aiSettingsSchema,
  toAiFormValues,
  toAiSettingsUpdate,
} from "@/domain/aiSettingsSchema";
import { LoadError } from "@/features/common/LoadError";

/**
 * Блок «AI-помощник» (S09 §4.15): отдельная карточка со своим сохранением — другая таблица, и правка ресторана
 * не должна заодно отправлять настройки AI (и наоборот). Модель, тон и инструкции сюда сознательно не выносятся.
 */
export function AiSettingsCard({ restaurantId }: { restaurantId: string }) {
  const { data, error, isLoading, refetch } = useGetAiSettingsQuery(restaurantId);
  return (
    <section className="max-w-2xl space-y-4 rounded-md border p-4">
      <div>
        <h2 className="text-base font-semibold">AI-помощник</h2>
        <p className="text-sm text-muted-foreground">Отвечает гостям в боте на свободный текст. Кнопки работают всегда.</p>
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <LoadError error={error} onRetry={refetch} />}
      {/* key: после сохранения в другой вкладке и refetch форма пересоздаётся с новыми значениями. */}
      {data && <AiSettingsForm key={JSON.stringify(data)} restaurantId={restaurantId} settings={data} />}
    </section>
  );
}

function AiSettingsForm({ restaurantId, settings }: { restaurantId: string; settings: AiSettingsRecord }) {
  const [update, { isLoading }] = useUpdateAiSettingsMutation();
  const form = useForm<AiSettingsFormValues>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: toAiFormValues(settings),
  });

  async function onSubmit(values: AiSettingsFormValues) {
    const result = await update({ restaurantId, patch: toAiSettingsUpdate(values) });
    if (result.error) {
      toast.error(`Не удалось сохранить: ${result.error.message}`);
      return;
    }
    form.reset(toAiFormValues(result.data));
    toast.success("Настройки AI сохранены");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="ai_enabled"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel>AI-помощник включён</FormLabel>
              </div>
              <FormDescription>Выключен — бот ищет блюдо по свободному тексту, как раньше; меню и бронь кнопками работают.</FormDescription>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="history_window"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Окно истории</FormLabel>
              <FormControl>
                <Input inputMode="numeric" className="w-32" {...field} />
              </FormControl>
              <FormDescription>
                Сколько последних сообщений переписки видит помощник ({HISTORY_WINDOW_RANGE.min}–{HISTORY_WINDOW_RANGE.max}). Больше —
                лучше помнит разговор, но каждый ответ дороже.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="daily_turn_limit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Лимит ответов в сутки на гостя</FormLabel>
              <FormControl>
                <Input inputMode="numeric" className="w-32" {...field} />
              </FormControl>
              <FormDescription>
                {DAILY_TURN_LIMIT_RANGE.min}–{DAILY_TURN_LIMIT_RANGE.max}. Исчерпан — гость получает «сейчас удобнее кнопками» и меню до
                следующих суток (по часовому поясу ресторана). Защита от спама и лишних расходов.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isLoading || !form.formState.isDirty}>
          {isLoading ? "Сохраняем…" : "Сохранить"}
        </Button>
      </form>
    </Form>
  );
}
