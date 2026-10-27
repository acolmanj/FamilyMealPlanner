"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { GlutenBadge } from "@/components/gluten-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_LABEL, normalise } from "@/lib/gluten/gate";
import {
  DAYS,
  DAY_LABEL,
  SLOTS,
  SLOT_LABEL,
  addDays,
  cellKey,
  suggestAlternatives,
  suggestForWeek,
  type Cell,
  type Day,
  type PlanMeal,
  type Slot,
  type Use,
} from "@/lib/planner/rules";
import type { Protein, Tags } from "@/lib/planner/tags";
import { cn } from "@/lib/utils";
import { addNewMeal, clearCell, moveCell, resolveMealImages, saveMealTags, setCellMeal, setLocked, setReason, type TagEdit } from "./actions";
import type { BoardCell, BoardMeal } from "./load";

type Change =
  | { type: "set"; day: Day; slot: Slot; mealId: string; text: string }
  | { type: "move"; from: { day: Day; slot: Slot }; to: { day: Day; slot: Slot } }
  | { type: "lock"; day: Day; slot: Slot; locked: boolean }
  | { type: "clear"; day: Day; slot: Slot };

type Result = { ok: boolean; error?: string; adjustmentId?: string };
type Run = (ch: Change, action: () => Promise<Result>, after?: (id?: string) => void) => void;
type Target = { day: Day; slot: Slot };
type DragData = { kind: "meal"; mealId: string; label: string } | { kind: "cell"; day: Day; slot: Slot; label: string };

const REASONS = ["too much pasta", "not in the mood", "no time", "guests", "other"];
const STARCHES = ["pasta", "potatoes", "rice", "noodles", "bread", "none"];

// Meat dark red, fish blue, vegetarian green.
const PROTEIN_STYLE: Record<Protein, string> = {
  meat: "border-l-[#8b1a1a] bg-[#f6e4e4]",
  fish: "border-l-[#1d5fb4] bg-[#e3eefb]",
  veg: "border-l-[#2e7d32] bg-[#e6f2e0]",
};
const PROTEIN_LABEL: Record<Protein, string> = { meat: "Meat", fish: "Fish", veg: "Vegetarian" };
const PROTEIN_DOT: Record<Protein, string> = { meat: "bg-[#8b1a1a]", fish: "bg-[#1d5fb4]", veg: "bg-[#2e7d32]" };

function applyChange(cells: BoardCell[], ch: Change): BoardCell[] {
  const same = (c: BoardCell, t: Target) => c.day === t.day && c.slot === t.slot;
  switch (ch.type) {
    case "set":
      return [
        ...cells.filter((c) => !same(c, ch)),
        { day: ch.day, slot: ch.slot, mealId: ch.mealId, text: ch.text, locked: true, leftover: false },
      ];
    case "clear":
      return cells.filter((c) => !same(c, ch));
    case "lock":
      return cells.map((c) => (same(c, ch) ? { ...c, locked: ch.locked } : c));
    case "move": {
      const a = cells.find((c) => same(c, ch.from));
      const b = cells.find((c) => same(c, ch.to));
      if (!a) return cells;
      const rest = cells.filter((c) => c !== a && c !== b);
      return [...rest, { ...a, ...ch.to, locked: true }, ...(b ? [{ ...b, ...ch.from, locked: true }] : [])];
    }
  }
}

function tagLine(t: Tags) {
  return [t.isPulse ? "pulses" : null, t.isPasta ? "pasta" : t.starch, t.isProcessed ? "processed" : null].filter(Boolean).join(" · ");
}

export function WeekBoard({ week, cells, meals, history }: { week: string; cells: BoardCell[]; meals: BoardMeal[]; history: Use[] }) {
  const [shown, change] = useOptimistic(cells, applyChange);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Target | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mealMap = useMemo(() => new Map<string, BoardMeal>(meals.map((m) => [m.id, m])), [meals]);
  const ruleCells: Cell[] = shown.map((c) => ({ day: c.day, slot: c.slot, mealId: c.mealId && mealMap.has(c.mealId) ? c.mealId : null }));

  // Fetch photos for meals that have none checked yet, then redraw once they are saved.
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    void (async () => {
      let changed = false;
      for (let round = 0; round < 8 && !stop; round++) {
        const r = await resolveMealImages().catch(() => null);
        if (!r?.ok) break;
        changed ||= r.updated > 0;
        if (!r.remaining) break;
      }
      if (changed && !stop) router.refresh();
    })();
    return () => {
      stop = true;
    };
  }, [router]);

  const run: Run = (ch, action, after) => {
    setError(null);
    startTransition(async () => {
      change(ch);
      const r = await action();
      if (!r.ok) setError(r.error ?? "That did not save");
      else after?.(r.adjustmentId);
    });
  };

  const place = (mealId: string, t: Target) => {
    const m = mealMap.get(mealId);
    if (!m) return;
    run({ type: "set", ...t, mealId, text: m.name }, () => setCellMeal(week, t.day, t.slot, mealId));
  };

  // Drag and drop with pointer events, so it works with a finger as well as a mouse.
  // On touch a short press-and-hold starts the drag, so the lists still scroll.
  const [drag, setDrag] = useState<{ data: DragData; x: number; y: number; over: string | null } | null>(null);
  const pressRef = useRef<{ data: DragData; x: number; y: number; touch: boolean; active: boolean; timer?: number } | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef<(data: DragData, target: string | null) => void>(() => {});
  dropRef.current = (data, target) => {
    if (!target) return;
    if (target === "remove") {
      if (data.kind === "cell") run({ type: "clear", day: data.day, slot: data.slot }, () => clearCell(week, data.day, data.slot));
      return;
    }
    const [day, slot] = target.split("-") as [Day, Slot];
    if (data.kind === "meal") place(data.mealId, { day, slot });
    else if (data.day !== day || data.slot !== slot)
      run({ type: "move", from: { day: data.day, slot: data.slot }, to: { day, slot } }, () =>
        moveCell(week, { day: data.day, slot: data.slot }, { day, slot }),
      );
  };

  useEffect(() => {
    const targetAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;
    const move = (e: PointerEvent) => {
      const p = pressRef.current;
      if (!p) return;
      if (!p.active) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (!p.touch && moved > 6) {
          p.active = true;
          setDrag({ data: p.data, x: e.clientX, y: e.clientY, over: targetAt(e.clientX, e.clientY) });
        } else if (p.touch && moved > 10) {
          clearTimeout(p.timer);
          pressRef.current = null; // the finger is scrolling
        }
        return;
      }
      setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, over: targetAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const p = pressRef.current;
      pressRef.current = null;
      if (!p) return;
      clearTimeout(p.timer);
      if (!p.active) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      setDrag(null);
      dropRef.current(p.data, targetAt(e.clientX, e.clientY));
    };
    const cancel = () => {
      if (pressRef.current) clearTimeout(pressRef.current.timer);
      pressRef.current = null;
      setDrag(null);
    };
    // While dragging, stop the page from scrolling under the finger.
    const touchMove = (e: TouchEvent) => {
      if (pressRef.current?.active) e.preventDefault();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("touchmove", touchMove);
    };
  }, []);

  const dragProps = (data: DragData) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const touch = e.pointerType !== "mouse";
      const press = { data, x: e.clientX, y: e.clientY, touch, active: false, timer: undefined as number | undefined };
      pressRef.current = press;
      if (touch)
        press.timer = window.setTimeout(() => {
          if (pressRef.current !== press) return;
          press.active = true;
          navigator.vibrate?.(10);
          setDrag({ data, x: press.x, y: press.y, over: null });
        }, 280);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const tapped =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      if (!suppressClick.current) fn(...a);
    };

  const openCell = open ? (shown.find((c) => c.day === open.day && c.slot === open.slot) ?? null) : null;
  const weekSuggestions = suggestForWeek({ weekStart: week, cells: ruleCells, meals: mealMap, history, count: 10 });

  return (
    <div className="flex items-start gap-2">
      <aside
        data-drop={drag?.data.kind === "cell" ? "remove" : undefined}
        className={cn(
          "sticky top-28 flex max-h-[calc(100dvh-8rem)] w-[40%] max-w-72 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border bg-card p-2 text-xs",
          drag?.data.kind === "cell" && "border-destructive",
          drag?.over === "remove" && "bg-destructive/10",
        )}
      >
        {drag?.data.kind === "cell" && <p className="rounded bg-destructive/10 p-2 text-center font-medium text-destructive">Drop here to remove</p>}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-destructive">{error}</p>}
        {open ? (
          <CellPanel
            key={cellKey(open)}
            week={week}
            target={open}
            cell={openCell}
            cells={shown}
            ruleCells={ruleCells}
            meals={meals}
            mealMap={mealMap}
            history={history}
            pending={pending}
            run={run}
            onClose={() => setOpen(null)}
          />
        ) : (
          <WeekSuggestions
            suggestions={weekSuggestions}
            meals={meals}
            cells={shown}
            picked={picked}
            onPick={tapped((id: string) => setPicked((p) => (p === id ? null : id)))}
            dragProps={dragProps}
          />
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="grid grid-cols-[2rem_repeat(2,minmax(0,1fr))] gap-1.5 text-xs" aria-busy={pending}>
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
              open={open}
              over={drag?.over ?? null}
              dragProps={dragProps}
              onTap={tapped((slot: Slot) => {
                setError(null);
                if (picked) {
                  place(picked, { day, slot });
                  setPicked(null);
                } else setOpen((o) => (o?.day === day && o.slot === slot ? null : { day, slot }));
              })}
            />
          ))}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(["meat", "fish", "veg"] as Protein[]).map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className={cn("inline-block size-2.5 rounded-sm", PROTEIN_DOT[p])} />
              {PROTEIN_LABEL[p]}
            </span>
          ))}
        </p>
      </div>

      {drag && (
        <div
          className="pointer-events-none fixed z-50 max-w-40 -translate-x-1/2 -translate-y-[130%] rounded-md border bg-card px-2 py-1 text-xs font-medium shadow-lg"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.data.label}
        </div>
      )}
    </div>
  );
}

function DayRow({
  day,
  date,
  cells,
  meals,
  open,
  over,
  dragProps,
  onTap,
}: {
  day: Day;
  date: string;
  cells: BoardCell[];
  meals: Map<string, BoardMeal>;
  open: Target | null;
  over: string | null;
  dragProps: (d: DragData) => object;
  onTap: (slot: Slot) => void;
}) {
  return (
    <>
      <span className="flex flex-col justify-center leading-tight">
        <span className="font-semibold">{DAY_LABEL[day]}</span>
        <span className="text-muted-foreground">{Number(date.slice(8))}</span>
      </span>
      {SLOTS.map((slot) => {
        const key = cellKey({ day, slot });
        const c = cells.find((x) => x.day === day && x.slot === slot);
        const m = c?.mealId ? meals.get(c.mealId) : undefined;
        const label = c?.text ?? m?.name ?? "";
        return (
          <button
            key={slot}
            data-drop={key}
            onClick={() => onTap(slot)}
            {...(c ? dragProps({ kind: "cell", day, slot, label }) : {})}
            className={cn(
              "flex min-h-16 touch-manipulation items-start gap-1 rounded-md border border-l-4 bg-card p-1.5 text-left select-none [-webkit-touch-callout:none]",
              !c && "border-l border-dashed bg-transparent text-muted-foreground",
              m && PROTEIN_STYLE[m.tags.protein],
              c && !m && "bg-muted",
              m?.gluten === "blocked" && "border-destructive ring-1 ring-destructive",
              open?.day === day && open.slot === slot && "ring-2 ring-primary",
              over === key && "ring-2 ring-accent",
            )}
            aria-label={`${DAY_LABEL[day]} ${slot}: ${label || "empty"}`}
          >
            {c ? (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 self-stretch">
                  <span className="line-clamp-3 font-medium break-words">{label}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    {c.locked && <span title="Locked">🔒</span>}
                    {m && <span>{tagLine(m.tags)}</span>}
                    {m?.gluten === "blocked" && <span className="font-semibold text-destructive">Blocked</span>}
                    {!m && <span>{c.leftover ? "leftovers" : "not in library"}</span>}
                  </span>
                </span>
                {m?.image && (
                  // A small thumbnail, about a fifth of the tile. Hosted by TheMealDB or Wikimedia Commons.
                  <img
                    src={m.image.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="pointer-events-none aspect-square w-1/5 shrink-0 rounded object-cover"
                  />
                )}
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

function MealTile({ meal, why, picked, onClick, extra }: { meal: PlanMeal; why?: string; picked?: boolean; onClick: () => void; extra?: object }) {
  return (
    <button
      onClick={onClick}
      {...extra}
      className={cn(
        "flex touch-manipulation flex-col items-start gap-0.5 rounded-md border border-l-4 p-1.5 text-left select-none [-webkit-touch-callout:none]",
        PROTEIN_STYLE[meal.tags.protein],
        meal.gluten === "blocked" && "opacity-60",
        picked && "ring-2 ring-primary",
      )}
    >
      <span className="font-medium break-words">{meal.name}</span>
      <span className="text-[10px] text-muted-foreground">
        {[tagLine(meal.tags), why, meal.gluten === "blocked" ? "blocked for gluten" : null].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

function WeekSuggestions({
  suggestions,
  meals,
  cells,
  picked,
  onPick,
  dragProps,
}: {
  suggestions: { meal: PlanMeal; why: string }[];
  meals: BoardMeal[];
  cells: BoardCell[];
  picked: string | null;
  onPick: (id: string) => void;
  dragProps: (d: DragData) => object;
}) {
  const [query, setQuery] = useState("");
  const q = normalise(query).trim();
  const inWeek = new Set(cells.map((c) => c.mealId));
  const list = q
    ? meals
        .filter((m) => normalise(m.name).includes(q) && m.gluten !== "blocked")
        .slice(0, 10)
        .map((m) => ({ meal: m as PlanMeal, why: inWeek.has(m.id) ? "already this week" : "" }))
    : suggestions;
  return (
    <>
      <h2 className="text-sm font-semibold">Suggested meals</h2>
      <p className="text-muted-foreground">
        {picked ? "Now tap a slot to place it." : "Drag a meal onto a slot (on a phone, hold it first), or tap a meal and then a slot."}
      </p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all meals" aria-label="Search meals" className="h-9 text-sm" />
      {list.map(({ meal, why }) => (
        <MealTile
          key={meal.id}
          meal={meal}
          why={why}
          picked={picked === meal.id}
          onClick={() => onPick(meal.id)}
          extra={dragProps({ kind: "meal", mealId: meal.id, label: meal.name })}
        />
      ))}
      {q && list.length === 0 && <p className="text-muted-foreground">No meal matches. Tap a slot to add a new one there.</p>}
    </>
  );
}

function CellPanel({
  week,
  target,
  cell,
  cells,
  ruleCells,
  meals,
  mealMap,
  history,
  pending,
  run,
  onClose,
}: {
  week: string;
  target: Target;
  cell: BoardCell | null;
  cells: BoardCell[];
  ruleCells: Cell[];
  meals: BoardMeal[];
  mealMap: Map<string, BoardMeal>;
  history: Use[];
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const { day, slot } = target;
  const [mode, setMode] = useState<"main" | "move" | "tags" | "reason">("main");
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const meal = cell?.mealId ? mealMap.get(cell.mealId) : undefined;
  const here = { day, slot, mealId: meal?.id ?? null };
  const suggestions = suggestAlternatives({ weekStart: week, cells: ruleCells, meals: mealMap, history, cell: here, count: 5 });

  const askReason = (id?: string) => {
    if (!id) return onClose();
    setAdjustmentId(id);
    setMode("reason");
  };
  // Filling an empty slot is not a correction, so it needs no reason.
  const afterFill = cell ? askReason : () => onClose();
  const pick = (m: PlanMeal) => run({ type: "set", day, slot, mealId: m.id, text: m.name }, () => setCellMeal(week, day, slot, m.id), afterFill);

  const q = normalise(query).trim();
  const matches = q ? meals.filter((m) => normalise(m.name).includes(q)).slice(0, 8) : [];
  const exact = meals.some((m) => normalise(m.name).trim() === q);

  return (
    <div role="dialog" aria-label={`${DAY_LABEL[day]} ${slot}`} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="font-semibold text-muted-foreground uppercase">
            {DAY_LABEL[day]} {SLOT_LABEL[slot]}
          </p>
          <p className="text-sm font-semibold">{cell ? (cell.text ?? meal?.name) : "Empty"}</p>
          {meal && cell?.text && cell.text !== meal.name && <p className="text-muted-foreground">Library: {meal.name}</p>}
        </div>
        <button onClick={onClose} className="rounded-full px-1.5 text-lg leading-none text-muted-foreground" aria-label="Close">
          ×
        </button>
      </div>

      {meal && (
        <div className="flex flex-wrap items-center gap-1">
          <GlutenBadge status={meal.gluten} />
          <span className="text-muted-foreground">
            {PROTEIN_LABEL[meal.tags.protein]}
            {tagLine(meal.tags) ? ` · ${tagLine(meal.tags)}` : ""}
          </span>
        </div>
      )}

      {meal && mode === "main" && <RecipeNote meal={meal} />}

      {mode === "reason" && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">Saved. Why the change? (optional)</p>
          {REASONS.map((r) => (
            <button
              key={r}
              className="rounded-full border bg-background px-2.5 py-1.5 text-left"
              onClick={() => {
                if (adjustmentId) void setReason(adjustmentId, r);
                onClose();
              }}
            >
              {r}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={onClose} className="self-start">
            Skip
          </Button>
        </div>
      )}

      {mode === "main" && (
        <>
          <h2 className="text-sm font-semibold">{cell ? "Swap for" : "Suggested"}</h2>
          {suggestions.length === 0 && <p className="text-muted-foreground">No meal fits every rule here. Search below.</p>}
          {suggestions.map(({ meal: m, why }) => (
            <MealTile key={m.id} meal={m} why={why} onClick={() => !pending && pick(m)} />
          ))}
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all meals" aria-label="Search meals" className="h-9 text-sm" />
          {matches.map((m) => (
            <MealTile key={m.id} meal={m} onClick={() => !pending && m.gluten !== "blocked" && pick(m)} />
          ))}
          {q.length > 1 && !exact && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              className="h-auto py-1.5 whitespace-normal"
              onClick={() => run({ type: "set", day, slot, mealId: `new:${query}`, text: query.trim() }, () => addNewMeal(week, day, slot, query), afterFill)}
            >
              Add &ldquo;{query.trim()}&rdquo; as a new meal
            </Button>
          )}
          {cell && (
            <div className="flex flex-wrap gap-1.5">
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
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run({ type: "clear", day, slot }, () => clearCell(week, day, slot), askReason)}>
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
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">Move to which slot? A filled slot trades places. You can also drag it.</p>
          <div className="grid grid-cols-[1.75rem_repeat(2,minmax(0,1fr))] gap-1">
            {DAYS.map((d) => (
              <MoveRow key={d} day={d} cells={cells} current={target} onPick={(to) => run({ type: "move", from: target, to }, () => moveCell(week, target, to), askReason)} />
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
  );
}

// The recipe idea and photo credit. A recipe is written for ordinary flour and sauces,
// so it lists what the gluten gate finds and the swap to buy; the meal's own status above still rules.
function RecipeNote({ meal }: { meal: BoardMeal }) {
  const { recipe, image } = meal;
  if (!recipe && !image) return null;
  return (
    <div className="flex gap-2 rounded-md border bg-background p-1.5">
      {image && (
        <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded object-cover" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {recipe ? (
          <>
            <a href={recipe.url} target="_blank" rel="noreferrer" className="font-medium underline">
              Recipe idea: {recipe.name}
            </a>
            {recipe.gluten.length > 0 ? (
              <>
                <p className="text-muted-foreground">As written it has gluten. Cook it gluten-free:</p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {recipe.gluten.map((g) => (
                    <li key={g.term}>
                      <span className="font-medium text-foreground">{g.term}</span>
                      {g.swap ? `: ${g.swap}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">No gluten spotted in its ingredients. Still check the labels.</p>
            )}
          </>
        ) : (
          image?.page && (
            <a href={image.page} target="_blank" rel="noreferrer" className="text-muted-foreground underline">
              About this dish
            </a>
          )
        )}
        {image && <span className="text-[10px] text-muted-foreground">Photo: {image.source === "wikimedia" ? "Wikimedia Commons" : "TheMealDB"}</span>}
      </div>
    </div>
  );
}

function MoveRow({ day, cells, current, onPick }: { day: Day; cells: BoardCell[]; current: Target; onPick: (to: Target) => void }) {
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
            className={cn("min-h-8 truncate rounded border bg-background px-1 text-left", isHere && "border-primary bg-primary/10", !c && "border-dashed")}
          >
            {isHere ? "here" : (c?.text ?? "")}
          </button>
        );
      })}
    </>
  );
}

function TagForm({ meal, pending, onSave, onBack }: { meal: PlanMeal; pending: boolean; onSave: (t: TagEdit) => void; onBack: () => void }) {
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
          className={cn("rounded-full border px-2 py-1", t[key] === o ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
  const guessed = Object.values(meal.tags.guessed).some(Boolean);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">
        These facts apply to {meal.name} everywhere.{guessed ? " Some were guessed from the name." : ""}
      </p>
      <span className="font-medium">Main protein</span>
      {seg("protein", ["meat", "fish", "veg"], (o) => (o === "veg" ? "vegetarian" : o))}
      <span className="font-medium">Main starch</span>
      {seg("starch", STARCHES, (o) => o)}
      <span className="font-medium">Effort</span>
      {seg("effort", ["quick", "normal", "long", ""], (o) => (o ? o : "not sure"))}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={t.is_pasta} onChange={(e) => setT({ ...t, is_pasta: e.target.checked })} className="size-4" />
        Pasta meal
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={t.is_processed} onChange={(e) => setT({ ...t, is_processed: e.target.checked })} className="size-4" />
        Processed or ready-made
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={pending} onClick={() => onSave(t)}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
      <p className="text-muted-foreground">Gluten: {STATUS_LABEL[meal.gluten]}. Change that on the Gluten page.</p>
    </div>
  );
}
