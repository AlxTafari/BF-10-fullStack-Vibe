import { z } from "zod";

/** Форма записи FAQ. sort_order в форме нет — порядок меняется перетаскиванием. */
export const faqSchema = z.object({
  question: z.string().trim().min(1, "Введите вопрос").max(300, "Не длиннее 300 символов"),
  answer: z.string().trim().min(1, "Введите ответ").max(2000, "Не длиннее 2000 символов"),
  is_published: z.boolean(),
});

export type FaqValues = z.infer<typeof faqSchema>;

export const EMPTY_FAQ: FaqValues = { question: "", answer: "", is_published: true };
