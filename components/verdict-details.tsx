import type { Verdict } from "@/lib/gluten/gate";
import { GlutenBadge } from "@/components/gluten-badge";

// The findings behind a verdict, worst first, plus the swap to write next to the meal.
export function VerdictDetails({ verdict }: { verdict: Verdict }) {
  const problems = verdict.findings.filter((f) => f.status !== "safe");
  return (
    <div className="flex flex-col gap-1 text-sm">
      {verdict.swaps.length > 0 && (
        <p>
          <span className="font-semibold">GF swap: </span>
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
      {problems.length === 0 && (
        <p className="text-muted-foreground">
          Only naturally gluten-free foods recognised ({verdict.findings.map((f) => f.term).join(", ")}).
        </p>
      )}
    </div>
  );
}
