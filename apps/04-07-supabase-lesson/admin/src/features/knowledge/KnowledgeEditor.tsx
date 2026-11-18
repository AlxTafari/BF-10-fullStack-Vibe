import { zodResolver } from "@hookform/resolvers/zod";
import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useGetMeQuery } from "@/api/authApi";
import {
  type KnowledgeDocumentFull,
  useGetKnowledgeDocumentQuery,
  useLazyGetKnowledgeDocumentQuery,
  useSaveKnowledgeDocumentMutation,
} from "@/api/knowledgeApi";
import { type MenuCategory, type MenuItem, useGetCategoriesQuery, useGetMenuItemsQuery } from "@/api/menuApi";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  BODY_MAX,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  type DocumentValues,
  EMPTY_DOCUMENT,
  TITLE_MAX,
  documentSchema,
  isDocumentType,
  needsIndex,
} from "@/domain/knowledge";
import { LoadError } from "@/features/common/LoadError";
import { DishPicker } from "./DishPicker";
import { IndexStatus } from "./IndexStatus";
import { useIndexSource } from "./useIndexSource";

const NEW = "new";
const SAVED_NOT_INDEXED = "Документ сохранён, индекс не обновлён";

/** /knowledge/$documentId: правка документа; documentId = "new" — новый. */
export function KnowledgeEditor() {
  const { documentId } = useParams({ from: "/_authed/knowledge/$documentId" });
  const isNew = documentId === NEW;
  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const doc = useGetKnowledgeDocumentQuery(isNew ? skipToken : documentId);
  const items = useGetMenuItemsQuery(restaurantId ?? skipToken);
  const categories = useGetCategoriesQuery(restaurantId ?? skipToken);
  // Хук здесь, а не в форме: после создания адрес меняется на /knowledge/<id>, форма пересоздаётся,
  // а «Индексируется» должно пережить это пересоздание.
  const indexer = useIndexSource();

  const error = doc.error ?? items.error ?? categories.error;
  const loading = (!isNew && !doc.data) || !items.data || !categories.data;

  function retry() {
    if (!isNew) doc.refetch();
    items.refetch();
    categories.refetch();
  }

  return (
    <section className="max-w-3xl space-y-4">
      <Link to="/knowledge" className="text-sm text-muted-foreground hover:underline">
        ← База знаний
      </Link>
      {error ? (
        <LoadError error={error} onRetry={retry} />
      ) : loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        // key: форма читает defaultValues один раз — новый документ / другой документ = новая форма.
        <DocumentForm
          key={documentId}
          documentId={isNew ? null : documentId}
          full={doc.data ?? null}
          items={items.data as MenuItem[]}
          categories={categories.data as MenuCategory[]}
          indexer={indexer}
        />
      )}
    </section>
  );
}

interface FormProps {
  documentId: string | null;
  full: KnowledgeDocumentFull | null;
  items: MenuItem[];
  categories: MenuCategory[];
  indexer: ReturnType<typeof useIndexSource>;
}

function toValues(full: KnowledgeDocumentFull | null): DocumentValues {
  if (!full) return EMPTY_DOCUMENT;
  const { document } = full;
  return {
    title: document.title,
    body: document.body,
    // Тип из БД всегда из списка (check); на случай нового типа раньше админки — «Другое», а не падение формы.
    type: isDocumentType(document.type) ? document.type : "other",
    is_published: document.is_published,
    dishIds: full.dishIds,
  };
}

function DocumentForm({ documentId, full, items, categories, indexer }: FormProps) {
  const navigate = useNavigate();
  const [save, { isLoading: saving }] = useSaveKnowledgeDocumentMutation();
  const [loadDocument] = useLazyGetKnowledgeDocumentQuery();
  const form = useForm<DocumentValues>({ resolver: zodResolver(documentSchema), defaultValues: toValues(full) });
  const type = useWatch({ control: form.control, name: "type" });
  const title = useWatch({ control: form.control, name: "title" });
  const body = useWatch({ control: form.control, name: "body" });
  const indexing = documentId !== null && indexer.isIndexing(documentId);

  const runIndex = (id: string) => indexer.index({ source: "document", id }, SAVED_NOT_INDEXED);

  async function onSubmit(values: DocumentValues) {
    const result = await save({ id: documentId, values });
    if (result.error) {
      // Форма остаётся как есть, ввод не теряется.
      toast.error(`Не удалось сохранить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    const id = result.data;
    toast.success("Сохранено");
    form.reset(values);
    if (documentId === null) void navigate({ to: "/knowledge/$documentId", params: { documentId: id }, replace: true });

    // Нужна ли индексация — по перечитанной строке, а не по догадке, какие поля поменялись: версию источника
    // ведёт триггер БД. Неопубликованный и актуальный (сохранили без изменений) Gemini не вызывают.
    const fresh = await loadDocument(id).unwrap().catch(() => null);
    if (fresh && needsIndex(fresh.document)) await runIndex(id);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold">{documentId ? "Документ" : "Новый документ"}</h1>
          {full && (
            <IndexStatus
              row={full.document}
              indexing={indexing}
              onRetry={() => void runIndex(full.document.id)}
              showError
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                Входит в каждый фрагмент индекса — коротко и по сути. {title.length} / {TITLE_MAX}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Тип</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-60">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {DOCUMENT_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {full?.document.type === "collection" && type !== "collection" && full.dishIds.length > 0 && (
                <FormDescription className="text-amber-600 dark:text-amber-400">
                  После сохранения выбранные блюда отвяжутся: состав бывает только у подборки.
                </FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {type === "collection" && (
          <FormField
            control={form.control}
            name="dishIds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Блюда подборки</FormLabel>
                <DishPicker items={items} categories={categories} value={field.value} onChange={field.onChange} />
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Текст</FormLabel>
              <FormControl>
                <Textarea rows={18} className="font-mono text-sm" {...field} />
              </FormControl>
              <FormDescription>
                Markdown. Разделы с заголовком «## …» индексируются отдельными фрагментами. {body.length.toLocaleString("ru-RU")} /{" "}
                {BODY_MAX.toLocaleString("ru-RU")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="is_published"
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>Опубликован</FormLabel>
              <FormDescription>— бот отвечает по документу после индексации</FormDescription>
            </FormItem>
          )}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={saving || indexing}>
            {saving ? "Сохраняем…" : indexing ? "Индексируется…" : "Сохранить"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/knowledge">Отмена</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
