import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { passcodeSettings } from "@/lib/auth/passcode";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";
import { dublinToday } from "@/lib/planner/week";
import { SHEET_HOUSEHOLD_ID, bearerMatches, runSync, sheetSyncSettings } from "@/lib/sheet-sync/run";

// Copies the family's "Weekly Menu" Google Sheet into the plan. Called every 15 minutes
// by .github/workflows/sheet-sync.yml. POST only, with "Authorization: Bearer <SHEET_SYNC_SECRET>".
//   ?dryRun=1  work out the changes and return them, saving nothing
//   ?force=1   read the sheet even if Drive says it has not changed
// A deployment without the sheet settings (the friend family's copy) answers 404 and does nothing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const flag = (v: string | null) => v === "1" || v === "true";

export async function POST(request: NextRequest) {
  const settings = sheetSyncSettings();
  if (!settings) return NextResponse.json({ enabled: false }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), settings.secret))
    return NextResponse.json({ ok: false, error: "Wrong or missing sync key." }, { status: 401 });

  const family = passcodeSettings();
  if (!isSupabaseConfigured || !family.email || !family.password)
    return NextResponse.json({ ok: false, error: "The app's database or family sign-in settings are missing." }, { status: 500 });

  // A fresh sign-in as the family, so the database's own rules limit it to their household.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: family.email, password: family.password });
  if (signInError) return NextResponse.json({ ok: false, error: `Could not sign in as the family: ${signInError.message}` }, { status: 500 });

  try {
    const { data: households, error } = await supabase.from("households").select("id");
    if (error) return NextResponse.json({ ok: false, error: `Could not read the household: ${error.message}` }, { status: 500 });
    // Only ever the family's own household.
    if (households?.length !== 1 || households[0].id !== SHEET_HOUSEHOLD_ID)
      return NextResponse.json({ ok: false, error: "This sign-in is not the expected household. Nothing was changed." }, { status: 403 });

    const params = request.nextUrl.searchParams;
    const result = await runSync({
      supabase,
      householdId: SHEET_HOUSEHOLD_ID,
      settings,
      today: dublinToday(),
      dryRun: flag(params.get("dryRun")),
      force: flag(params.get("force")),
    });
    return NextResponse.json({ enabled: true, ...result }, { status: result.ok ? 200 : 422 });
  } finally {
    // Ends only this run's session, not the family's sign-ins on their phones.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
