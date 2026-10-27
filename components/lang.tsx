"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useTransition } from "react";
import { LANG_COOKIE, messages, type Lang } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang() {
  const lang = useContext(LangContext);
  return { lang, t: messages(lang) };
}

// UK and Spanish flags, drawn inline so they look the same on every phone.
function UkFlag() {
  return (
    <svg viewBox="0 0 60 30" className="h-3.5 w-7 rounded-[2px]" aria-hidden="true">
      <clipPath id="uk-s">
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id="uk-t">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath="url(#uk-s)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uk-t)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

function EsFlag() {
  return (
    <svg viewBox="0 0 60 40" className="h-3.5 w-[21px] rounded-[2px]" aria-hidden="true">
      <rect width="60" height="40" fill="#AA151B" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </svg>
  );
}

export function LangSwitch() {
  const { lang, t } = useLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pick = (l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };
  const flags: [Lang, React.ReactNode, string][] = [
    ["en", <UkFlag key="en" />, t.english],
    ["es", <EsFlag key="es" />, t.spanish],
  ];
  return (
    <div role="group" aria-label={t.language} className={cn("flex items-center gap-1", pending && "opacity-60")}>
      {flags.map(([l, flag, label]) => (
        <button
          key={l}
          onClick={() => pick(l)}
          aria-pressed={lang === l}
          aria-label={label}
          title={label}
          className={cn(
            "flex items-center rounded-md border p-1",
            lang === l ? "border-primary bg-primary/10" : "border-transparent opacity-60 hover:opacity-100",
          )}
        >
          {flag}
        </button>
      ))}
    </div>
  );
}
