"use server";

import { revalidatePath } from "next/cache";
import { getHousehold } from "@/lib/household";

// Mark a meal as a favourite, or take the mark off.
export async function setFavourite(id: string, favourite: boolean): Promise<{ ok: boolean; error?: string }> {
  const { supabase, household } = await getHousehold();
  if (!household) return { ok: false, error: "No household" };
  const { error } = await supabase.from("meals").update({ is_favourite: favourite }).eq("household_id", household.id).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/favourites");
  revalidatePath("/history");
  revalidatePath("/meals");
  revalidatePath("/week");
  return { ok: true };
}
