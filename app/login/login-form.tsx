"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/components/lang";

type Mode = "password" | "link";
type State = "idle" | "busy" | "sent" | "error";

// Password sign-in is the default because it sends no email, so it never hits
// Supabase's hourly email limit. The email link stays as a fallback for the
// first sign-in (before a password is set) or a forgotten password.
export function LoginForm() {
  const { t } = useLang();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  function fail(msg: string) {
    setState("error");
    setMessage(msg);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const supabase = createClient();

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return fail(error.status === 400 ? t.login.wrongPassword : error.message);
      router.replace("/week");
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) return fail(error.status === 429 ? t.login.tooMany : error.message);
    setState("sent");
  }

  function switchMode() {
    setMode(mode === "password" ? "link" : "password");
    setState("idle");
    setMessage("");
  }

  if (state === "sent") {
    return (
      <p className="w-full rounded-md bg-secondary p-4 text-sm">
        {t.login.checkEmail} <strong>{email}</strong>
      </p>
    );
  }

  const busy = state === "busy";
  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3 text-left">
      <label htmlFor="email" className="text-sm font-medium">
        {t.login.yourEmail}
      </label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
      />
      {mode === "password" && (
        <>
          <label htmlFor="password" className="text-sm font-medium">
            {t.login.password}
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      )}
      <Button type="submit" disabled={busy}>
        {mode === "password" ? (busy ? t.login.signingIn : t.login.signIn) : busy ? t.login.sending : t.login.send}
      </Button>
      {state === "error" && <p className="text-sm text-destructive">{message}</p>}
      <button type="button" onClick={switchMode} className="text-center text-sm text-primary underline">
        {mode === "password" ? t.login.useLink : t.login.usePassword}
      </button>
    </form>
  );
}
