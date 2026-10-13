import { z } from "zod";

/** Форма входа. Пароль не trim'им — пробелы в нём значимы. */
export const loginSchema = z.object({
  email: z.string().trim().min(1, "Введите email").email("Некорректный email"),
  password: z.string().min(1, "Введите пароль"),
});

export type LoginValues = z.infer<typeof loginSchema>;
