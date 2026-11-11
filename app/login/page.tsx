import { Basket } from "@/components/basket";
import { SetupNeeded } from "@/components/setup-needed";
import { isSupabaseConfigured } from "@/lib/env";
import { getMessages } from "@/lib/i18n/server";
import { LangSwitch } from "@/components/lang";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (!isSupabaseConfigured) return <SetupNeeded />;
  // Already in? Go straight to the plan.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/week");
  const { t } = await getMessages();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <LangSwitch />
      <h1 className="text-3xl font-bold">{t.appName}</h1>
      <Basket className="w-full max-w-xs" />
      <LoginForm />
    </main>
  );
}
