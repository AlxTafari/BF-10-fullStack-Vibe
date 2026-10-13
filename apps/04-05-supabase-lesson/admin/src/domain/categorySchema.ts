import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Введите название").max(80, "Не длиннее 80 символов"),
});

export type CategoryValues = z.infer<typeof categorySchema>;
