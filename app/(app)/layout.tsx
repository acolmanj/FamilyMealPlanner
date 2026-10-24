import { Nav } from "@/components/nav";
import { SetupNeeded } from "@/components/setup-needed";
import { isSupabaseConfigured } from "@/lib/env";
import { getHousehold } from "@/lib/household";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <SetupNeeded />;
  const { user, household } = await getHousehold();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background/95 px-4 pt-3 pb-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">Family Meal Planner</span>
          <form action="/auth/signout" method="post">
            <button className="text-xs text-muted-foreground underline" title={user.email}>
              Sign out
            </button>
          </form>
        </div>
        {household && <Nav />}
      </header>
      <main className="flex-1 p-4">
        {household ? (
          children
        ) : (
          <div className="rounded-lg border bg-card p-4 text-sm">
            <p className="font-medium">You are signed in as {user.email}, but this email is not in a household yet.</p>
            <p className="mt-2 text-muted-foreground">
              Ask someone already in the household to add it on the Household page, then reload.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
