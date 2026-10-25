"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/history", label: "Past weeks" },
  { href: "/favourites", label: "Favourites" },
  { href: "/gluten", label: "Gluten" },
  { href: "/household", label: "Household" },
];

export function Nav() {
  const path = usePathname();
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
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
