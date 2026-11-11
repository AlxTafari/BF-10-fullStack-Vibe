// Реестр tools агента (S09): имя → схема для модели + вызов сервиса ядра (ADR-004: сервисы про AI не знают,
// адаптер — здесь). Все tools только читают; reply — финальный ответ, не данные. Создание брони и обращения —
// кнопкой гостя (сессия 3).
//
// Аргументы приходят от модели, а значит, косвенно от гостя: проверяем каждый, как ввод пользователя.
// Ответы tools — только гостевые данные; блюда в стоп-листе (is_available = false) агенту не отдаются вовсе
// (приёмка §5 п.4: не появляются ни в одном ответе AI). Неопубликованные отсекает уже репозиторий.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EU_ALLERGEN_CODES, isAllergenCode } from "../../domain/allergens.ts";
import { SUGGESTION_KINDS } from "../../domain/aiSuggestions.ts";
import { formatLocalDateTime } from "../../domain/zonedTime.ts";
import type { LlmToolCall, LlmToolSchema } from "../../llm/types.ts";
import { getFaqAnswer, listFaq } from "../faq.ts";
import { type DishSummary, filterMenuByAllergens, getDishDetails, listMenuCategories, searchMenu } from "../menu.ts";
import { getMyBooking, listMyRequests } from "../myRequests.ts";
import { getRestaurantInfo } from "../restaurantInfo.ts";

export interface ToolContext {
  client: SupabaseClient;
  conversationId: string;
  now: Date;
}

type ToolResult = Record<string, unknown>;

interface ToolDefinition {
  schema: LlmToolSchema;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * Финальный ответ агента: текст + кнопки одним вызовом (S09). Агент (agent.ts) заканчивает на нём ход,
 * сервисов он не вызывает. Кнопки — поле ответа, а не отдельный tool: модель не может пообещать кнопку
 * и забыть её выбрать, и ход стоит на один вызов модели меньше.
 */
export const REPLY = "reply";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Строка-аргумент: обрезанная, непустая, не длиннее max. Иначе undefined. */
function stringArg(args: Record<string, unknown>, key: string, max = 200): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function idArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = stringArg(args, key, 36);
  return value && UUID.test(value) ? value.toLowerCase() : undefined;
}

const invalid = (what: string): ToolResult => ({ error: "invalid_arguments", details: what });

/** Блюдо для модели: id нужен ей для getDishDetails и кнопки «Карточка блюда», гостю она его не показывает. */
const dishForModel = (d: DishSummary) => ({ id: d.id, name: d.name, price: d.price, currency: d.currency });
const availableOnly = (items: DishSummary[]) => items.filter((d) => d.isAvailable).map(dishForModel);

const TOOLS: ToolDefinition[] = [
  {
    schema: {
      name: "getRestaurantInfo",
      description: "Restaurant name, description, address, phone and opening hours.",
      parameters: { type: "object", properties: {} },
    },
    async run(ctx) {
      const info = await getRestaurantInfo(ctx.client);
      return info ? { ...info } : { error: "not_found" };
    },
  },
  {
    schema: {
      name: "listFaq",
      description: "List of frequently asked questions (parking, kids, pets, payment, etc.). Use getFaqAnswer for the answer.",
      parameters: { type: "object", properties: {} },
    },
    async run(ctx) {
      return { questions: await listFaq(ctx.client) };
    },
  },
  {
    schema: {
      name: "getFaqAnswer",
      description: "Answer to one FAQ question by its id from listFaq.",
      parameters: {
        type: "object",
        properties: { faqId: { type: "string", description: "id from listFaq" } },
        required: ["faqId"],
      },
    },
    async run(ctx, args) {
      const faqId = idArg(args, "faqId");
      if (!faqId) return invalid("faqId must be an id from listFaq");
      const answer = await getFaqAnswer(ctx.client, { faqId });
      return answer ? { ...answer } : { error: "not_found" };
    },
  },
  {
    schema: {
      name: "listMenuCategories",
      description: "Menu categories (e.g. soups, hot dishes, desserts). Use searchMenu with categoryId to list a category.",
      parameters: { type: "object", properties: {} },
    },
    async run(ctx) {
      return { categories: await listMenuCategories(ctx.client) };
    },
  },
  {
    schema: {
      name: "searchMenu",
      description:
        "Dishes available now: by a word from the dish name (query, in the menu's language) and/or by category. " +
        "For broad questions (\"what hot dishes do you have\") use categoryId from listMenuCategories.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "word or part of the dish name, at least 2 letters" },
          categoryId: { type: "string", description: "id from listMenuCategories" },
        },
      },
    },
    async run(ctx, args) {
      const query = stringArg(args, "query", 100);
      const categoryId = idArg(args, "categoryId");
      if (!query && !categoryId) return invalid("pass query or categoryId");
      const result = await searchMenu(ctx.client, { query, categoryId });
      if (!result.ok) return invalid("query is too short or empty");
      return { dishes: availableOnly(result.items), hasMore: result.hasMore };
    },
  },
  {
    schema: {
      name: "getDishDetails",
      description:
        "Full dish card: description, ingredients, allergens, portion, nutrition per portion. " +
        'allergens: list of EU allergen codes; [] means the restaurant stated "no allergens"; null means NOT specified.',
      parameters: {
        type: "object",
        properties: { dishId: { type: "string", description: "id from searchMenu or filterMenuByAllergens" } },
        required: ["dishId"],
      },
    },
    async run(ctx, args) {
      const dishId = idArg(args, "dishId");
      if (!dishId) return invalid("dishId must be an id from searchMenu");
      const dish = await getDishDetails(ctx.client, { dishId });
      // Стоп-лист для AI — как отсутствующее блюдо (см. шапку файла).
      if (!dish || !dish.card.is_available) return { error: "not_found" };
      const { is_available: _available, ...card } = dish.card;
      return { id: dishId, ...card, category: dish.categoryName };
    },
  },
  {
    schema: {
      name: "filterMenuByAllergens",
      description:
        "Splits available dishes by the guest's allergens: free (allergens specified, none of the given), " +
        "contains (has at least one), notSpecified (allergens unknown: never call these safe). " +
        "Map the guest's words to codes: nuts = tree nuts, peanuts separately, cereals_gluten = gluten, milk = lactose/dairy.",
      parameters: {
        type: "object",
        properties: {
          allergens: {
            type: "array",
            description: "EU allergen codes to avoid",
            items: { type: "string", enum: [...EU_ALLERGEN_CODES] },
          },
          categoryId: { type: "string", description: "optional: only this category, id from listMenuCategories" },
        },
        required: ["allergens"],
      },
    },
    async run(ctx, args) {
      const raw = Array.isArray(args.allergens) ? args.allergens : [];
      const allergens = [...new Set(raw.filter((c): c is string => typeof c === "string").filter(isAllergenCode))];
      if (allergens.length === 0) return invalid("allergens must be a non-empty list of EU allergen codes");
      const categoryId = idArg(args, "categoryId");
      const result = await filterMenuByAllergens(ctx.client, { allergens, categoryId });
      return {
        free: availableOnly(result.free),
        contains: availableOnly(result.contains),
        notSpecified: availableOnly(result.unknown),
        truncated: result.truncated,
      };
    },
  },
  {
    schema: {
      name: "listMyRequests",
      description: "The guest's own table bookings (with status) and messages to the manager.",
      parameters: { type: "object", properties: {} },
    },
    async run(ctx) {
      const list = await listMyRequests(ctx.client, ctx.conversationId);
      return {
        bookings: list.bookings.map((b) => ({
          id: b.id,
          status: b.status,
          // Время брони — в зоне ресторана, как гость его и называл; UTC модель путает.
          at: formatLocalDateTime(new Date(b.booking_at), list.timeZone),
          guests: b.guests_count,
          isChangeRequest: b.replaces_id !== null,
        })),
        requests: list.requests.map((r) => ({ kind: r.kind, text: r.text, status: r.status })),
      };
    },
  },
  {
    schema: {
      name: "getMyBooking",
      description: "Details of one of the guest's bookings by id from listMyRequests: status, whether it can still be changed or cancelled.",
      parameters: {
        type: "object",
        properties: { bookingId: { type: "string", description: "id from listMyRequests" } },
        required: ["bookingId"],
      },
    },
    async run(ctx, args) {
      const bookingId = idArg(args, "bookingId");
      if (!bookingId) return invalid("bookingId must be an id from listMyRequests");
      // Чужая заявка — null по построению: сервис ищет только в диалоге этого гостя.
      const details = await getMyBooking(ctx.client, ctx.conversationId, bookingId, ctx.now);
      if (!details) return { error: "not_found" };
      const b = details.booking;
      return {
        status: b.status,
        at: formatLocalDateTime(new Date(b.booking_at), details.timeZone),
        guests: b.guests_count,
        comment: b.comment,
        hasPendingChange: details.pendingChange !== null,
        canCancel: details.canCancel,
        canChange: details.canChange,
      };
    },
  },
  {
    schema: {
      name: REPLY,
      description:
        "Your final answer to the guest: the text and up to 3 buttons under it. Every turn ends with exactly one reply call, " +
        "made alone, after you have the tool results you need. actions: dish needs dishId of a dish you mentioned; " +
        "booking = book a table, menu = open the menu, my_requests = guest's bookings, manager = write to the manager, " +
        "main_menu = main menu. Pass an empty list if no button fits.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "answer to the guest, plain text, in the guest's language" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: [...SUGGESTION_KINDS] },
                dishId: { type: "string", description: "only for kind = dish" },
              },
              required: ["kind"],
            },
          },
        },
        required: ["text", "actions"],
      },
    },
    // reply разбирает агент (agent.ts): это конец хода, а не запрос данных. Сюда он попадает, только если
    // пришёл вместе с другими tools — тогда он отклоняется, модель повторит его после результатов.
    run() {
      return Promise.resolve({ error: "reply_ignored", details: "call reply alone, after you have seen the tool results" });
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.schema.name, t]));

export const TOOL_SCHEMAS: LlmToolSchema[] = TOOLS.map((t) => t.schema);

/**
 * Выполняет вызов модели. Не бросает: неизвестный tool, негодные аргументы и сбой сервиса — это результат
 * для модели ({ error }), она скажет «нет данных» или попробует иначе. Текст ошибки сервиса модели не уходит.
 */
export async function runTool(ctx: ToolContext, call: LlmToolCall): Promise<ToolResult> {
  const tool = BY_NAME.get(call.name);
  if (!tool) return { error: "unknown_tool" };
  try {
    return await tool.run(ctx, call.args ?? {});
  } catch (error) {
    console.error(`tool ${call.name} failed:`, error instanceof Error ? error.name : "unknown");
    return { error: "unavailable" };
  }
}
