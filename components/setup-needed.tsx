import { Basket } from "@/components/basket";
import { getMessages } from "@/lib/i18n/server";

export async function SetupNeeded() {
  const { t } = await getMessages();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold">{t.appName}</h1>
      <Basket className="w-full max-w-xs" />
      <p className="text-muted-foreground">
        {t.setupNeeded} <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
      </p>
    </main>
  );
}
