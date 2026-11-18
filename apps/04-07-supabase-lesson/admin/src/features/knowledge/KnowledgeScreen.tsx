import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useGetMeQuery } from "@/api/authApi";
import {
  type KnowledgeDocumentRow,
  useDeleteKnowledgeDocumentMutation,
  useGetKnowledgeDocumentsQuery,
} from "@/api/knowledgeApi";
import { useGetMenuItemsQuery } from "@/api/menuApi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL, type SourceRef, documentTypeLabel, isDocumentType } from "@/domain/knowledge";
import { LoadError } from "@/features/common/LoadError";
import { IndexStatus } from "./IndexStatus";
import { ReindexAll } from "./ReindexAll";
import { useIndexSource } from "./useIndexSource";

const ALL = "all";

const formatDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

/** Раздел «База знаний»: документы ресторана для поиска AI-помощника (S10). */
export function KnowledgeScreen() {
  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const { type } = useSearch({ from: "/_authed/knowledge/" });
  const navigate = useNavigate({ from: "/knowledge/" });
  const { data: documents, error, isLoading, refetch } = useGetKnowledgeDocumentsQuery(restaurantId ?? skipToken);
  // Блюда — только чтобы назвать их в итогах «Переиндексировать всё».
  const { data: items } = useGetMenuItemsQuery(restaurantId ?? skipToken);
  const [deleteDocument, { isLoading: deleting }] = useDeleteKnowledgeDocumentMutation();
  const { index, isIndexing } = useIndexSource();
  const [toDelete, setToDelete] = useState<KnowledgeDocumentRow | null>(null);

  const visible = documents?.filter((d) => !type || d.type === type) ?? [];

  function nameOf(ref: SourceRef): string {
    const found =
      ref.source === "document"
        ? documents?.find((d) => d.id === ref.id)?.title
        : items?.find((i) => i.id === ref.id)?.name;
    return found ?? ref.id;
  }

  async function handleDelete() {
    if (!toDelete) return;
    const result = await deleteDocument(toDelete.id);
    if (result.error) {
      toast.error(`Не удалось удалить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Документ удалён");
    setToDelete(null);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">База знаний</h1>
        {restaurantId && <ReindexAll restaurantId={restaurantId} nameOf={nameOf} />}
        <Button asChild>
          <Link to="/knowledge/$documentId" params={{ documentId: "new" }}>
            Новый документ
          </Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Документы, по которым AI-помощник отвечает гостям: история, команда, подборки блюд, события, сервис. Бот
        находит только опубликованные документы со статусом «Готово».
      </p>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Тип:</span>
        <Select
          value={type ?? ALL}
          onValueChange={(v) => void navigate({ search: { type: isDocumentType(v) ? v : undefined }, replace: true })}
        >
          <SelectTrigger className="w-48" aria-label="Фильтр по типу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все типы</SelectItem>
            {DOCUMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {DOCUMENT_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {documents && <span className="text-sm text-muted-foreground">{visible.length} шт.</span>}
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {error && <LoadError error={error} onRetry={refetch} />}
      {documents && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {documents.length === 0 ? "Пока нет документов — добавьте первый." : "Документов этого типа нет."}
        </p>
      )}

      {visible.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead className="w-36">Тип</TableHead>
              <TableHead className="w-28">Опубликован</TableHead>
              <TableHead className="w-56">Индекс</TableHead>
              <TableHead className="w-36">Изменён</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium">
                  <Link to="/knowledge/$documentId" params={{ documentId: doc.id }} className="hover:underline">
                    {doc.title}
                  </Link>
                </TableCell>
                <TableCell>{documentTypeLabel(doc.type)}</TableCell>
                <TableCell>{doc.is_published ? "Да" : "Нет"}</TableCell>
                <TableCell>
                  <IndexStatus
                    row={doc}
                    indexing={isIndexing(doc.id)}
                    onRetry={() => void index({ source: "document", id: doc.id }, "Индекс не обновлён")}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(doc.updated_at)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => setToDelete(doc)}>
                    Удалить
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{toDelete?.title}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Документ удалится насовсем вместе с индексом — бот сразу перестанет по нему отвечать. Если он может
              понадобиться позже, лучше снимите его с публикации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
