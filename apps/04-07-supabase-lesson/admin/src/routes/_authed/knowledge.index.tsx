import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { type KnowledgeSearch, knowledgeSearchSchema } from "@/domain/knowledge";
import { KnowledgeScreen } from "@/features/knowledge/KnowledgeScreen";

// Список и редактор — соседние страницы (index + $documentId), а не родитель с <Outlet>.
export const Route = createFileRoute("/_authed/knowledge/")({
  validateSearch: (search: Partial<KnowledgeSearch> & SearchSchemaInput): KnowledgeSearch =>
    knowledgeSearchSchema.parse(search),
  component: KnowledgeScreen,
});
