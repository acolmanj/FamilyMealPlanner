"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/components/lang";
import { enterPasscode, type PasscodeState } from "./actions";

const initial: PasscodeState = { error: "" };

export function LoginForm() {
  const { t } = useLang();
  const [state, action, busy] = useActionState(enterPasscode, initial);

  return (
    <form action={action} className="flex w-full flex-col gap-3 text-left">
      <label htmlFor="passcode" className="text-sm font-medium">
        {t.login.passcode}
      </label>
      <Input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        autoFocus
      />
      <Button type="submit" disabled={busy}>
        {busy ? t.login.checking : t.login.enter}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {t.login[state.error]}
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">{t.login.remember}</p>
    </form>
  );
}
