import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeEditor } from "@/features/knowledge/KnowledgeEditor";

// documentId — uuid документа или "new" для нового.
export const Route = createFileRoute("/_authed/knowledge/$documentId")({ component: KnowledgeEditor });
