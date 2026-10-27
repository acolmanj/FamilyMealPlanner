import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getHousehold } from "@/lib/household";
import { getMessages } from "@/lib/i18n/server";

async function addMember(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return;
  const { supabase, household } = await getHousehold();
  if (!household) return;
  await supabase.from("household_members").upsert({ household_id: household.id, email });
  revalidatePath("/household");
}

async function removeMember(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const { supabase, household, user } = await getHousehold();
  if (!household || email === user.email?.toLowerCase()) return;
  await supabase.from("household_members").delete().eq("household_id", household.id).eq("email", email);
  revalidatePath("/household");
}

export default async function HouseholdPage() {
  const { supabase, household, user } = await getHousehold();
  if (!household) return null;
  const { t } = await getMessages();
  const { data: members } = await supabase
    .from("household_members")
    .select("email")
    .eq("household_id", household.id)
    .order("email");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{t.household.title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t.household.who}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2 text-sm">
            {(members ?? []).map((m) => (
              <li key={m.email} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
                <span className="truncate">{m.email}</span>
                {m.email === user.email?.toLowerCase() ? (
                  <span className="text-xs text-muted-foreground">{t.household.you}</span>
                ) : (
                  <form action={removeMember}>
                    <input type="hidden" name="email" value={m.email} />
                    <button className="text-xs text-destructive underline">{t.household.remove}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <form action={addMember} className="flex gap-2">
            <Input name="email" type="email" required placeholder="partner@example.com" />
            <Button type="submit">{t.household.add}</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            {t.household.help}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
