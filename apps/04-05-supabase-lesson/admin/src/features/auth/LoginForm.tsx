import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useSignInMutation } from "@/api/authApi";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { type LoginValues, loginSchema } from "@/domain/loginSchema";
import { safeRedirect } from "@/domain/safeRedirect";

export function LoginForm({ redirectTo }: { redirectTo: string | undefined }) {
  const router = useRouter();
  const [signIn, { isLoading, error }] = useSignInMutation();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    const result = await signIn(values);
    if (result.error) return;
    // redirect приходит из URL — валидируем ещё раз перед переходом.
    router.history.push(safeRedirect(redirectTo));
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="username" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Пароль</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {"message" in error ? error.message : "Не удалось войти"}
          </p>
        )}
        {/* Кнопка блокируется на время запроса: двойной клик не отправит вход дважды. */}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Входим…" : "Войти"}
        </Button>
      </form>
    </Form>
  );
}
