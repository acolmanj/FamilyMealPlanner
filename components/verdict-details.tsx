"use client";

import { GlutenBadge } from "@/components/gluten-badge";
import { useLang } from "@/components/lang";
import { localiseVerdict } from "@/lib/gluten/es";
import type { Verdict } from "@/lib/gluten/gate";

// The findings behind a verdict, worst first, plus the swap to write next to the meal.
export function VerdictDetails({ verdict: raw }: { verdict: Verdict }) {
  const { lang, t } = useLang();
  const verdict = localiseVerdict(raw, lang);
  const problems = verdict.findings.filter((f) => f.status !== "safe");
  return (
    <div className="flex flex-col gap-1 text-sm">
      {verdict.confirmed && verdict.screened !== "safe" && (
        <p className="text-muted-foreground">{t.gluten.confirmedNote(t.status[verdict.screened!])}</p>
      )}
      {verdict.swaps.length > 0 && (
        <p>
          <span className="font-semibold">{t.gluten.swap}</span>
          {verdict.swaps.join(". ")}.
        </p>
      )}
      {problems.map((f) => (
        <p key={f.rule} className="flex items-start gap-2 text-muted-foreground">
          <GlutenBadge status={f.status} className="mt-0.5 px-1.5 text-[10px]" />
          <span>
            <strong className="text-foreground">{f.term}</strong>: {f.note}.
          </span>
        </p>
      ))}
      {problems.length === 0 && !verdict.confirmed && (
        <p className="text-muted-foreground">{t.gluten.onlyNatural(verdict.findings.map((f) => f.term).join(", "))}</p>
      )}
    </div>
  );
}
