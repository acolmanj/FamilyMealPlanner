"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/components/lang";
import { cn } from "@/lib/utils";

// iPhone-style tab bar along the bottom of the screen. Household lives in the header.
const LINKS = [
  { href: "/week", key: "week", icon: "M4 6h16M4 12h16M4 18h16M8 3v4M16 3v4" },
  { href: "/meals", key: "meals", icon: "M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9" },
  { href: "/history", key: "history", icon: "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" },
  { href: "/favourites", key: "favourites", icon: "M12 17.3l-5.6 3 1.1-6.3L3 9.6l6.3-.9L12 3l2.7 5.7 6.3.9-4.5 4.4 1.1 6.3z" },
  { href: "/gluten", key: "gluten", icon: "M12 21V9M12 9c0-3 2-5 4-6-.3 3-1.6 5-4 6zm0 0C12 6 10 4 8 3c.3 3 1.6 5 4 6zm0 5c0-2.5 2-4 4-5-.3 2.5-1.6 4.3-4 5zm0 0c0-2.5-2-4-4-5 .3 2.5 1.6 4.3 4 5z" },
] as const;

export function Nav() {
  const path = usePathname();
  const { t } = useLang();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto grid max-w-3xl grid-cols-5">
        {LINKS.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={l.icon} />
              </svg>
              <span className="truncate">{t.nav[l.key]}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
