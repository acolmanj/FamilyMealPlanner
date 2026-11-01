import Link from "next/link";
import { LangSwitch } from "@/components/lang";
import { Nav } from "@/components/nav";
import { SetupNeeded } from "@/components/setup-needed";
import { isSupabaseConfigured } from "@/lib/env";
import { getHousehold } from "@/lib/household";
import { getMessages } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <SetupNeeded />;
  const [{ user, household }, { t }] = await Promise.all([getHousehold(), getMessages()]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-background/80 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 backdrop-blur-xl backdrop-saturate-150">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[17px] font-semibold tracking-tight">{t.appName}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <LangSwitch />
            {household && (
              <Link href="/household" aria-label={t.nav.household} title={t.nav.household} className="rounded-full p-1.5 text-primary hover:bg-muted">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" />
                </svg>
              </Link>
            )}
            <form action="/auth/signout" method="post">
              <button className="rounded-full px-2 py-1 text-[13px] font-medium whitespace-nowrap text-primary hover:bg-muted" title={user.email}>
                {t.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* Room at the bottom for the tab bar. */}
      <main className="flex-1 px-3 pt-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-4">
        {household ? (
          children
        ) : (
          <div className="rounded-2xl bg-card p-4 text-sm shadow-card">
            <p className="font-medium">{t.notInHousehold(user.email ?? "")}</p>
            <p className="mt-2 text-muted-foreground">{t.askToAdd}</p>
          </div>
        )}
      </main>
      {household && <Nav />}
    </div>
  );
}
