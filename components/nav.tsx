"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/components/lang";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/week", key: "week" },
  { href: "/meals", key: "meals" },
  { href: "/history", key: "history" },
  { href: "/favourites", key: "favourites" },
  { href: "/gluten", key: "gluten" },
  { href: "/household", key: "household" },
] as const;

export function Nav() {
  const path = usePathname();
  const { t } = useLang();
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap",
            path.startsWith(l.href) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {t.nav[l.key]}
        </Link>
      ))}
    </nav>
  );
}
