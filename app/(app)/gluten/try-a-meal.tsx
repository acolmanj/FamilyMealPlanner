"use client";

import { useState } from "react";
import { GlutenBadge } from "@/components/gluten-badge";
import { VerdictDetails } from "@/components/verdict-details";
import { Input } from "@/components/ui/input";
import { screenMeal } from "@/lib/gluten/gate";
import { useLang } from "@/components/lang";

export function TryAMeal() {
  const { t } = useLang();
  const [text, setText] = useState("");
  const verdict = text.trim() ? screenMeal({ name: text }) : null;
  return (
    <div className="flex flex-col gap-3">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.gluten.tryPlaceholder}
        aria-label={t.gluten.tryLabel}
      />
      {verdict && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <GlutenBadge status={verdict.status} className="self-start" />
          <VerdictDetails verdict={verdict} />
        </div>
      )}
    </div>
  );
}
