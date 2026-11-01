"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/components/lang";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm() {
  const { t } = useLang();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setState("error");
      setMessage(t.household.passwordTooShort);
      return;
    }
    setState("busy");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("saved");
      setPassword("");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t.household.passwordHelp}</p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="new-password"
          aria-label={t.household.newPassword}
          placeholder={t.household.newPassword}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={state === "busy"}>
          {state === "busy" ? t.household.saving : t.household.savePassword}
        </Button>
      </div>
      {state === "saved" && <p className="text-sm text-primary">{t.household.passwordSaved}</p>}
      {state === "error" && <p className="text-sm text-destructive">{message}</p>}
    </form>
  );
}
