import { Basket } from "@/components/basket";
import { SetupNeeded } from "@/components/setup-needed";
import { isSupabaseConfigured } from "@/lib/env";
import { getMessages } from "@/lib/i18n/server";
import { LangSwitch } from "@/components/lang";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isSupabaseConfigured) return <SetupNeeded />;
  const { error } = await searchParams;
  const { t } = await getMessages();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <LangSwitch />
      <h1 className="text-3xl font-bold">{t.appName}</h1>
      <Basket className="w-full max-w-xs" />
      {error && (
        <p className="w-full rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {t.login.linkFailed}
        </p>
      )}
      <LoginForm />
    </main>
  );
}
