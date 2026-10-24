import { Basket } from "@/components/basket";

export function SetupNeeded() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold">Family Meal Planner</h1>
      <Basket className="w-full max-w-xs" />
      <p className="text-muted-foreground">
        Almost ready. The database is not connected yet: add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to the Vercel project and redeploy.
      </p>
    </main>
  );
}
