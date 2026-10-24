import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The signed-in user and the household their email belongs to (RLS decides).
export const getHousehold = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: households } = await supabase.from("households").select("id, name").limit(1);
  return { supabase, user, household: households?.[0] ?? null };
});
