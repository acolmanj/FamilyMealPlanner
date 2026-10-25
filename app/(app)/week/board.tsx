"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { GlutenBadge } from "@/components/gluten-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_LABEL, normalise, type Status } from "@/lib/gluten/gate";
import {
  DAYS,
  DAY_LABEL,
  LIMITS,
  SLOTS,
  SLOT_LABEL,
  addDays,
  cellKey,
  checkWeek,
  suggestAlternatives,
  type Cell,
  type Day,
  type PlanMeal,
  type Slot,
  type Use,
  type Warning,
} from "@/lib/planner/rules";
import type { Tags } from "@/lib/planner/tags";
import { cn } from "@/lib/utils";
import { addNewMeal, clearCell, moveCell, saveMealTags, setCellMeal, setLocked, setReason, type TagEdit } from "./actions";

export type BoardMeal = { id: string; name: string; pinned: boolean; tags: Tags; gluten: Status };
export type BoardCell = { day: Day; slot: Slot; mealId: string | null; text: string | null; locked: boolean };

type Change =
  | { type: "set"; day: Day; slot: Slot; mealId: string; text: string }
  | { type: "move"; from: Cell; to: { day: Day; slot: Slot } }
  | { type: "lock"; day: Day; slot: Slot; locked: boolean }
  | { type: "clear"; day: Day; slot: Slot };

const REASONS = ["too much pasta", "not in the mood", "no time", "guests", "other"];
const STARCHES = ["pasta", "potatoes", "rice", "noodles", "bread", "none"];

function applyChange(cells: BoardCell[], ch: Change): BoardCell[] {
  const same = (c: BoardCell, d: Day, s: Slot) => c.day === d && c.slot === s;
  switch (ch.type) {
    case "set":
      return [
        ...cells.filter((c) => !same(c, ch.day, ch.slot)),
        { day: ch.day, slot: ch.slot, mealId: ch.mealId, text: ch.text, locked: true },
      ];
    case "clear":
      return cells.filter((c) => !same(c, ch.day, ch.slot));
    case "lock":
      return cells.map((c) => (same(c, ch.day, ch.slot) ? { ...c, locked: ch.locked } : c));
    case "move": {
      const a = cells.find((c) => same(c, ch.from.day, ch.from.slot));
      const b = cells.find((c) => same(c, ch.to.day, ch.to.slot));
      if (!a) return cells;
      const rest = cells.filter((c) => c !== a && c !== b);
      return [
        ...rest,
        { ...a, day: ch.to.day, slot: ch.to.slot, locked: true },
        ...(b ? [{ ...b, day: ch.from.day, slot: ch.from.slot, locked: true }] : []),
      ];
    }
  }
}

export function WeekBoard({
  week,
  cells,
  meals,
  history,
}: {
  week: string;
  cells: BoardCell[];
  meals: BoardMeal[];
  history: Use[];
}) {
  const [shown, change] = useOptimistic(cells, applyChange);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<{ day: Day; slot: Slot } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mealMap = useMemo(() => new Map<string, PlanMeal>(meals.map((m) => [m.id, m])), [meals]);
  const ruleCells: Cell[] = shown.map((c) => ({ day: c.day, slot: c.slot, mealId: c.mealId && mealMap.has(c.mealId) ? c.mealId : null }));
  const { counts, warnings } = checkWeek({ weekStart: week, cells: ruleCells, meals: mealMap, history });
  const warningsFor = (key: string) => warnings.filter((w) => w.cells.includes(key));

  function run(ch: Change, action: () => Promise<{ ok: boolean; error?: string; adjustmentId?: string }>, after?: (id?: string) => void) {
    setError(null);
    startTransition(async () => {
      change(ch);
      const r = await action();
      if (!r.ok) setError(r.error ?? "That did not save");
      else after?.(r.adjustmentId);
    });
  }

  const openCell = open ? shown.find((c) => c.day === open.day && c.slot === open.slot) ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      <CountsBar counts={counts} />
      <WarningList warnings={warnings} />
      {error && !open && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-[2.75rem_repeat(3,minmax(0,1fr))] gap-1.5 text-xs" aria-busy={pending}>
        <span />
        {SLOTS.map((s) => (
          <span key={s} className="px-1 font-semibold text-muted-foreground uppercase">
            {SLOT_LABEL[s]}
          </span>
        ))}
        {DAYS.map((day, i) => (
          <DayRow
            key={day}
            day={day}
            date={addDays(week, i)}
            cells={shown}
            meals={mealMap}
            warningsFor={warningsFor}
            onOpen={(slot) => {
              setError(null);
              setOpen({ day, slot });
            }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Tap a cell to fill, swap, move, lock or remove it. Only gluten blocks; the other rules warn. Meal facts (fish,
        pasta, effort) are guessed from the name until you fix them in a cell.
      </p>

      {open && (
        <CellSheet
          key={cellKey(open)}
          week={week}
          day={open.day}
          slot={open.slot}
          cell={openCell}
          cells={shown}
          ruleCells={ruleCells}
          meals={meals}
          mealMap={mealMap}
          history={history}
          warnings={warningsFor(cellKey(open))}
          error={error}
          pending={pending}
          run={run}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function DayRow({
  day,
  date,
  cells,
  meals,
  warningsFor,
  onOpen,
}: {
  day: Day;
  date: string;
  cells: BoardCell[];
  meals: Map<string, PlanMeal>;
  warningsFor: (key: string) => Warning[];
  onOpen: (slot: Slot) => void;
}) {
  return (
    <>
      <span className="flex flex-col justify-center leading-tight">
        <span className="font-semibold">{DAY_LABEL[day]}</span>
        <span className="text-muted-foreground">{Number(date.slice(8))}</span>
      </span>
      {SLOTS.map((slot) => {
        const c = cells.find((x) => x.day === day && x.slot === slot);
        const m = c?.mealId ? meals.get(c.mealId) : undefined;
        const ws = warningsFor(cellKey({ day, slot }));
        const worst = ws.some((w) => w.level === "block") ? "block" : ws.some((w) => w.level === "hard") ? "hard" : ws.length ? "soft" : null;
        return (
          <button
            key={slot}
            onClick={() => onOpen(slot)}
            className={cn(
              "flex min-h-16 flex-col items-start gap-0.5 rounded-md border bg-card p-1.5 text-left",
              !c && "border-dashed bg-transparent text-muted-foreground",
              worst === "block" && "border-destructive bg-destructive/10",
              worst === "hard" && "border-warning",
            )}
            aria-label={`${DAY_LABEL[day]} ${slot}: ${c?.text ?? m?.name ?? "empty"}`}
          >
            {c ? (
              <>
                <span className="line-clamp-3 font-medium break-words">{c.text ?? m?.name}</span>
                <span className="mt-auto flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  {c.locked && <span title="Locked">🔒</span>}
                  {m && <span>{tagLine(m.tags)}</span>}
                  {!m && <span className="text-warning">not in library</span>}
                  {worst && (
                    <span className={cn("font-semibold", worst === "block" ? "text-destructive" : worst === "hard" ? "text-warning" : "")}>
                      ⚠ {ws.length}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span className="m-auto text-base">+</span>
            )}
          </button>
        );
      })}
    </>
  );
}

function tagLine(t: Tags) {
  return [t.protein, t.isPasta ? "pasta" : t.starch, t.isProcessed ? "processed" : null].filter(Boolean).join(" · ");
}

function CountsBar({ counts }: { counts: ReturnType<typeof checkWeek>["counts"] }) {
  const items: [string, string, boolean][] = [
    ["Filled", `${counts.filled} of ${counts.toFill}`, false],
    ["Fish", `${counts.fish}`, counts.filled === counts.toFill && counts.fish === 0],
    ["Meat", `${counts.meat}`, false],
    ["Veg", `${counts.veg}`, false],
    ["Pasta", `${counts.pasta} of ${LIMITS.pasta}`, counts.pasta > LIMITS.pasta],
    ["Processed", `${counts.processed} of ${LIMITS.processed}`, counts.processed > LIMITS.processed],
    ["New", `${counts.newMeals} of ~${LIMITS.newMeals}`, counts.newMeals > LIMITS.newMeals],
    ["Sobras", `${counts.sobras}`, false],
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5" aria-live="polite">
      {items.map(([label, value, over]) => (
        <div key={label} className={cn("rounded-md border bg-card px-2 py-1.5", over && "border-warning bg-warning/10")}>
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className={cn("text-sm font-semibold", over && "text-warning")}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function WarningList({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {warnings.map((w, i) => (
        <WarningChip key={i} w={w} />
      ))}
    </ul>
  );
}

function WarningChip({ w }: { w: Warning }) {
  return (
    <li
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        w.level === "block" && "bg-destructive/15 text-destructive",
        w.level === "hard" && "bg-warning/15 text-warning",
        w.level === "soft" && "bg-muted text-muted-foreground",
      )}
    >
      {w.level === "block" ? "Blocked: " : ""}
      {w.text}
    </li>
  );
}

type Run = (ch: Change, action: () => Promise<{ ok: boolean; error?: string; adjustmentId?: string }>, after?: (id?: string) => void) => void;

function CellSheet({
  week,
  day,
  slot,
  cell,
  cells,
  ruleCells,
  meals,
  mealMap,
  history,
  warnings,
  error,
  pending,
  run,
  onClose,
}: {
  week: string;
  day: Day;
  slot: Slot;
  cell: BoardCell | null;
  cells: BoardCell[];
  ruleCells: Cell[];
  meals: BoardMeal[];
  mealMap: Map<string, PlanMeal>;
  history: Use[];
  warnings: Warning[];
  error: string | null;
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"main" | "move" | "tags" | "reason">("main");
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const meal = cell?.mealId ? mealMap.get(cell.mealId) : undefined;
  const here = { day, slot, mealId: meal?.id ?? null };
  const suggestions = suggestAlternatives({ weekStart: week, cells: ruleCells, meals: mealMap, history, cell: here });

  const askReason = (id?: string) => {
    if (!id) return onClose();
    setAdjustmentId(id);
    setMode("reason");
  };
  const pick = (m: BoardMeal) =>
    run({ type: "set", day, slot, mealId: m.id, text: m.name }, () => setCellMeal(week, day, slot, m.id), askReason);

  const q = normalise(query).trim();
  const matches = q ? meals.filter((m) => normalise(m.name).includes(q)).slice(0, 8) : [];
  const exact = meals.some((m) => normalise(m.name).trim() === q);

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`${DAY_LABEL[day]} ${slot}`}
        className="flex max-h-[85dvh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-background p-4 pb-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase">
              {DAY_LABEL[day]} {SLOT_LABEL[slot]}
            </p>
            <p className="font-semibold">{cell ? (cell.text ?? meal?.name) : "Empty"}</p>
            {meal && cell?.text && cell.text !== meal.name && <p className="text-xs text-muted-foreground">Library: {meal.name}</p>}
          </div>
          <button onClick={onClose} className="rounded-full px-2 text-xl text-muted-foreground" aria-label="Close">
            ×
          </button>
        </div>

        {meal && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <GlutenBadge status={meal.gluten} />
            <span className="text-muted-foreground">{tagLine(meal.tags)}</span>
            {meal.tags.effort && <span className="text-muted-foreground">· {meal.tags.effort}</span>}
            {meal.pinned && <span className="text-muted-foreground">· pinned</span>}
          </div>
        )}
        {warnings.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {warnings.map((w, i) => (
              <WarningChip key={i} w={w} />
            ))}
          </ul>
        )}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

        {mode === "reason" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Saved. Why the change? (optional)</p>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  className="rounded-full border bg-card px-3 py-1.5 text-sm"
                  onClick={() => {
                    if (adjustmentId) void setReason(adjustmentId, r);
                    onClose();
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="self-start">
              Skip
            </Button>
          </div>
        )}

        {mode === "main" && (
          <>
            <section className="flex flex-col gap-1.5">
              <h2 className="text-sm font-semibold">{cell ? "Swap for" : "Suggested"}</h2>
              {suggestions.length === 0 && <p className="text-sm text-muted-foreground">No meal fits every rule here. Search below.</p>}
              {suggestions.map(({ meal: m, why }) => (
                <button
                  key={m.id}
                  disabled={pending}
                  onClick={() => pick(m as BoardMeal)}
                  className="flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-left text-sm"
                >
                  <span>
                    <span className="font-medium">{m.name}</span>
                    <br />
                    <span className="text-xs text-muted-foreground">
                      {tagLine(m.tags)} · {why}
                    </span>
                  </span>
                  <GlutenBadge status={m.gluten} />
                </button>
              ))}
            </section>

            <section className="flex flex-col gap-1.5">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all meals" aria-label="Search meals" />
              {matches.map((m) => {
                const blocked = m.gluten === "blocked";
                const elsewhere = cells.filter((c) => c.mealId === m.id && !(c.day === day && c.slot === slot));
                return (
                  <button
                    key={m.id}
                    disabled={blocked || pending}
                    onClick={() => pick(m)}
                    className={cn("flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-left text-sm", blocked && "opacity-60")}
                  >
                    <span>
                      <span className="font-medium">{m.name}</span>
                      <br />
                      <span className="text-xs text-muted-foreground">
                        {blocked
                          ? "Blocked for gluten. Mark it as cooked GF on the Gluten page first"
                          : `${tagLine(m.tags)}${elsewhere.length ? ` · already on ${elsewhere.map((c) => DAY_LABEL[c.day]).join(", ")}` : ""}`}
                      </span>
                    </span>
                    <GlutenBadge status={m.gluten} />
                  </button>
                );
              })}
              {q.length > 1 && !exact && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run({ type: "set", day, slot, mealId: `new:${query}`, text: query.trim() }, () => addNewMeal(week, day, slot, query), askReason)
                  }
                >
                  Add &ldquo;{query.trim()}&rdquo; as a new meal
                </Button>
              )}
            </section>

            {cell && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setMode("move")}>
                  Move
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run({ type: "lock", day, slot, locked: !cell.locked }, () => setLocked(week, day, slot, !cell.locked))}
                >
                  {cell.locked ? "Unlock" : "Lock"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run({ type: "clear", day, slot }, () => clearCell(week, day, slot), askReason)}
                >
                  Remove
                </Button>
                {meal && (
                  <Button variant="ghost" size="sm" onClick={() => setMode("tags")}>
                    Fix meal facts
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {mode === "move" && cell && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Move to which cell? A filled cell trades places.</p>
            <div className="grid grid-cols-[2.5rem_repeat(3,minmax(0,1fr))] gap-1 text-xs">
              <span />
              {SLOTS.map((s) => (
                <span key={s} className="font-semibold text-muted-foreground uppercase">
                  {SLOT_LABEL[s]}
                </span>
              ))}
              {DAYS.map((d) => (
                <MoveRow
                  key={d}
                  day={d}
                  cells={cells}
                  current={{ day, slot }}
                  onPick={(to) =>
                    run({ type: "move", from: here, to }, () => moveCell(week, { day, slot }, to), askReason)
                  }
                />
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMode("main")} className="self-start">
              Back
            </Button>
          </div>
        )}

        {mode === "tags" && meal && (
          <TagForm
            meal={meal}
            pending={pending}
            onSave={(t) => run({ type: "lock", day, slot, locked: cell?.locked ?? false }, () => saveMealTags(meal.id, t), () => setMode("main"))}
            onBack={() => setMode("main")}
          />
        )}
      </div>
    </div>
  );
}

function MoveRow({
  day,
  cells,
  current,
  onPick,
}: {
  day: Day;
  cells: BoardCell[];
  current: { day: Day; slot: Slot };
  onPick: (to: { day: Day; slot: Slot }) => void;
}) {
  return (
    <>
      <span className="self-center font-semibold">{DAY_LABEL[day]}</span>
      {SLOTS.map((slot) => {
        const c = cells.find((x) => x.day === day && x.slot === slot);
        const isHere = day === current.day && slot === current.slot;
        return (
          <button
            key={slot}
            disabled={isHere}
            onClick={() => onPick({ day, slot })}
            className={cn("min-h-9 truncate rounded border bg-card px-1 text-left", isHere && "border-primary bg-primary/10", !c && "border-dashed bg-transparent")}
          >
            {isHere ? "here" : (c?.text ?? "")}
          </button>
        );
      })}
    </>
  );
}

function TagForm({
  meal,
  pending,
  onSave,
  onBack,
}: {
  meal: PlanMeal;
  pending: boolean;
  onSave: (t: TagEdit) => void;
  onBack: () => void;
}) {
  const [t, setT] = useState<TagEdit>({
    protein: meal.tags.protein,
    starch: meal.tags.starch ?? "none",
    is_pasta: meal.tags.isPasta,
    is_processed: meal.tags.isProcessed,
    effort: meal.tags.effort ?? "",
  });
  const seg = <K extends keyof TagEdit>(key: K, options: TagEdit[K][], label: (o: TagEdit[K]) => string) => (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => setT({ ...t, [key]: o })}
          className={cn("rounded-full border px-3 py-1 text-sm", t[key] === o ? "border-primary bg-primary text-primary-foreground" : "bg-card")}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
  const guessed = Object.entries(meal.tags.guessed).some(([, v]) => v);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        These facts apply to {meal.name} everywhere.{guessed ? " Some were guessed from the name." : ""}
      </p>
      <div className="flex flex-col gap-1">
        <span className="font-medium">Main protein</span>
        {seg("protein", ["meat", "fish", "veg"], (o) => (o === "veg" ? "vegetarian" : o))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">Main starch</span>
        {seg("starch", STARCHES, (o) => o)}
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">Effort</span>
        {seg("effort", ["quick", "normal", "long", ""], (o) => (o ? o : "not sure"))}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={t.is_pasta} onChange={(e) => setT({ ...t, is_pasta: e.target.checked })} className="size-5" />
        Counts as a pasta meal
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={t.is_processed} onChange={(e) => setT({ ...t, is_processed: e.target.checked })} className="size-5" />
        Counts as processed or ready-made
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSave(t)}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Gluten: {STATUS_LABEL[meal.gluten]}. Change that on the Gluten page.</p>
    </div>
  );
}
