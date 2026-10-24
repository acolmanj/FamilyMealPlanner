import { Basket } from "@/components/basket";
import { SetupNeeded } from "@/components/setup-needed";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isSupabaseConfigured) return <SetupNeeded />;
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold">Family Meal Planner</h1>
      <Basket className="w-full max-w-xs" />
      {error && (
        <p className="w-full rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          That sign-in link did not work. It may have expired or been used already. Ask for a new one below.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
