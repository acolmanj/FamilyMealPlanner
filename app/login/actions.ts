"use server";

import { redirect } from "next/navigation";
import { passcodeMatches, passcodeSettings } from "@/lib/auth/passcode";
import { createClient } from "@/lib/supabase/server";

export type PasscodeState = { error: "" | "wrong" | "notSetUp" | "failed" };

const WRONG_GUESS_DELAY_MS = 1500;

// Runs on the server only. If the passcode is right, the server signs this
// browser in to the shared family account (its email and password are server
// settings too). Supabase then keeps the browser signed in with a long-lived
// cookie, and the database's own access rules keep working as before.
export async function enterPasscode(_prev: PasscodeState, formData: FormData): Promise<PasscodeState> {
  const settings = passcodeSettings();
  if (!settings.ready) return { error: "notSetUp" };

  const attempt = String(formData.get("passcode") ?? "");
  if (!passcodeMatches(attempt, settings.passcode)) {
    // Slow down anyone trying lots of guesses.
    await new Promise((resolve) => setTimeout(resolve, WRONG_GUESS_DELAY_MS));
    return { error: "wrong" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: settings.email, password: settings.password });
  if (error) {
    console.error("Family account sign-in failed:", error.message);
    return { error: "failed" };
  }
  redirect("/week");
}
