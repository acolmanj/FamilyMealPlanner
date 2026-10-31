"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { FoodIcons } from "@/components/food-icons";
import { GlutenBadge } from "@/components/gluten-badge";
import { useLang } from "@/components/lang";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalise } from "@/lib/gluten/gate";
import type { Messages } from "@/lib/i18n/messages";
import {
  DAYS,
  SLOTS,
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
import { addNewMeal, clearCell, moveCell, saveMealTags, setCellMeal, setLocked, setReason, type TagEdit } from "./actions";
import type { BoardCell, BoardMeal } from "./load";
import { useResolveImages } from "./resolve-images";

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

function tagLine(m: Messages, t: Tags) {
  return [t.isPulse ? m.board.pulses : null, t.isPasta ? m.starch.pasta : t.starch && m.starch[t.starch], t.isProcessed ? m.board.processed : null]
    .filter(Boolean)
    .join(" · ");
}

// A small photo, about a fifth of the tile. Hosted by TheMealDB or Wikimedia Commons.
function Thumb({ meal }: { meal?: Pick<BoardMeal, "image"> }) {
  if (!meal?.image) return null;
  return (
    <img
      src={meal.image.url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      className="pointer-events-none aspect-square w-1/5 shrink-0 rounded object-cover"
    />
  );
}

export function WeekBoard({ week, cells, meals, history }: { week: string; cells: BoardCell[]; meals: BoardMeal[]; history: Use[] }) {
  const { lang, t } = useLang();
  const [shown, change] = useOptimistic(cells, applyChange);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Target | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mealMap = useMemo(() => new Map<string, BoardMeal>(meals.map((m) => [m.id, m])), [meals]);
  const ruleCells: Cell[] = shown.map((c) => ({ day: c.day, slot: c.slot, mealId: c.mealId && mealMap.has(c.mealId) ? c.mealId : null }));

  useResolveImages();

  const run: Run = (ch, action, after) => {
    setError(null);
    startTransition(async () => {
      change(ch);
      const r = await action();
      if (!r.ok) setError(r.error ?? t.board.didNotSave);
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
  const weekSuggestions = suggestForWeek({ weekStart: week, cells: ruleCells, meals: mealMap, history, count: 10, lang });

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
        {drag?.data.kind === "cell" && <p className="rounded bg-destructive/10 p-2 text-center font-medium text-destructive">{t.board.dropToRemove}</p>}
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
              {t.slots[s]}
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
              {t.protein[p]}
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
  const { t } = useLang();
  return (
    <>
      <span className="flex flex-col justify-center leading-tight">
        <span className="font-semibold">{t.days[day]}</span>
        <span className="text-muted-foreground">{Number(date.slice(8))}</span>
      </span>
      {SLOTS.map((slot) => {
        const key = cellKey({ day, slot });
        const c = cells.find((x) => x.day === day && x.slot === slot);
        const m = c?.mealId ? meals.get(c.mealId) : undefined;
        const label = m?.name ?? c?.text ?? "";
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
            aria-label={`${t.days[day]} ${t.slots[slot]}: ${label || t.board.emptyLabel}`}
          >
            {c ? (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 self-stretch">
                  <span className="line-clamp-3 font-medium break-words hyphens-auto">{label}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    {c.locked && <span title={t.board.locked}>🔒</span>}
                    {m && <FoodIcons starch={m.tags.starch} isPasta={m.tags.isPasta} isPulse={m.tags.isPulse} className="text-sm" />}
                    {m?.tags.isProcessed && <span>{t.board.processed}</span>}
                    {m?.gluten === "blocked" && <span className="font-semibold text-destructive">{t.board.blocked}</span>}
                    {!m && <span>{c.leftover ? t.board.leftovers : t.board.notInLibrary}</span>}
                  </span>
                </span>
                <Thumb meal={m} />
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

// Suggestions come back from the rules as PlanMeal, but they are the board's meals, photo included.
function MealTile({ meal, why, picked, onClick, extra }: { meal: PlanMeal; why?: string; picked?: boolean; onClick: () => void; extra?: object }) {
  const { t } = useLang();
  return (
    <button
      onClick={onClick}
      {...extra}
      className={cn(
        "flex touch-manipulation items-start gap-1 rounded-md border border-l-4 p-1.5 text-left select-none [-webkit-touch-callout:none]",
        PROTEIN_STYLE[meal.tags.protein],
        meal.gluten === "blocked" && "opacity-60",
        picked && "ring-2 ring-primary",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium break-words hyphens-auto">{meal.name}</span>
        <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <FoodIcons starch={meal.tags.starch} isPasta={meal.tags.isPasta} isPulse={meal.tags.isPulse} className="text-sm" />
          <span>{[meal.tags.isProcessed ? t.board.processed : null, why, meal.gluten === "blocked" ? t.board.blockedForGluten : null].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <Thumb meal={meal as BoardMeal} />
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
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const q = normalise(query).trim();
  const inWeek = new Set(cells.map((c) => c.mealId));
  const list = q
    ? meals
        .filter((m) => normalise(m.name).includes(q) && m.gluten !== "blocked")
        .slice(0, 10)
        .map((m) => ({ meal: m as PlanMeal, why: inWeek.has(m.id) ? t.board.alreadyThisWeek : "" }))
    : suggestions;
  return (
    <>
      <h2 className="text-sm font-semibold">{t.board.suggested}</h2>
      <p className="text-muted-foreground">
        {picked ? t.board.tapSlotNow : t.board.dragHelp}
      </p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.board.search} aria-label={t.board.search} className="h-9 text-sm" />
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
      {q && list.length === 0 && <p className="text-muted-foreground">{t.board.noMatch}</p>}
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
  const { lang, t } = useLang();
  const [mode, setMode] = useState<"main" | "move" | "tags" | "reason">("main");
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const meal = cell?.mealId ? mealMap.get(cell.mealId) : undefined;
  const here = { day, slot, mealId: meal?.id ?? null };
  const suggestions = suggestAlternatives({ weekStart: week, cells: ruleCells, meals: mealMap, history, cell: here, count: 5, lang });

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
    <div role="dialog" aria-label={`${t.days[day]} ${t.slots[slot]}`} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="font-semibold text-muted-foreground uppercase">
            {t.days[day]} {t.slots[slot]}
          </p>
          <p className="text-sm font-semibold">{cell ? (meal?.name ?? cell.text) : t.board.empty}</p>
        </div>
        <button onClick={onClose} className="rounded-full px-1.5 text-lg leading-none text-muted-foreground" aria-label={t.board.close}>
          ×
        </button>
      </div>

      {meal && (
        <div className="flex flex-wrap items-center gap-1">
          <GlutenBadge status={meal.gluten} />
          <span className="text-muted-foreground">
            {t.protein[meal.tags.protein]}
            {tagLine(t, meal.tags) ? ` · ${tagLine(t, meal.tags)}` : ""}
          </span>
        </div>
      )}

      {meal && mode === "main" && <RecipeNote meal={meal} />}

      {mode === "reason" && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">{t.board.whyChange}</p>
          {REASONS.map((r) => (
            <button
              key={r}
              className="rounded-full border bg-background px-2.5 py-1.5 text-left"
              onClick={() => {
                if (adjustmentId) void setReason(adjustmentId, r);
                onClose();
              }}
            >
              {t.board.reasons[r] ?? r}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={onClose} className="self-start">
            {t.board.skip}
          </Button>
        </div>
      )}

      {mode === "main" && (
        <>
          <h2 className="text-sm font-semibold">{cell ? t.board.swapFor : t.board.suggestedHere}</h2>
          {suggestions.length === 0 && <p className="text-muted-foreground">{t.board.noFit}</p>}
          {suggestions.map(({ meal: m, why }) => (
            <MealTile key={m.id} meal={m} why={why} onClick={() => !pending && pick(m)} />
          ))}
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.board.search} aria-label={t.board.search} className="h-9 text-sm" />
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
              {t.board.addNew(query.trim())}
            </Button>
          )}
          {cell && (
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setMode("move")}>
                {t.board.move}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => run({ type: "lock", day, slot, locked: !cell.locked }, () => setLocked(week, day, slot, !cell.locked))}
              >
                {cell.locked ? t.board.unlock : t.board.lock}
              </Button>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run({ type: "clear", day, slot }, () => clearCell(week, day, slot), askReason)}>
                {t.board.remove}
              </Button>
              {meal && (
                <Button variant="ghost" size="sm" onClick={() => setMode("tags")}>
                  {t.board.fixFacts}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {mode === "move" && cell && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">{t.board.moveWhere}</p>
          <div className="grid grid-cols-[1.75rem_repeat(2,minmax(0,1fr))] gap-1">
            {DAYS.map((d) => (
              <MoveRow key={d} day={d} cells={cells} meals={mealMap} current={target} onPick={(to) => run({ type: "move", from: target, to }, () => moveCell(week, target, to), askReason)} />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setMode("main")} className="self-start">
            {t.board.back}
          </Button>
        </div>
      )}

      {mode === "tags" && meal && (
        <TagForm
          meal={meal}
          pending={pending}
          onSave={(edit) => run({ type: "lock", day, slot, locked: cell?.locked ?? false }, () => saveMealTags(meal.id, edit), () => setMode("main"))}
          onBack={() => setMode("main")}
        />
      )}
    </div>
  );
}

// The recipe idea and photo credit. A recipe is written for ordinary flour and sauces,
// so it lists what the gluten gate finds and the swap to buy; the meal's own status above still rules.
function RecipeNote({ meal }: { meal: BoardMeal }) {
  const { t } = useLang();
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
              {t.board.recipeIdea(recipe.name)}
            </a>
            {recipe.gluten.length > 0 ? (
              <>
                <p className="text-muted-foreground">{t.board.recipeHasGluten}</p>
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
              <p className="text-muted-foreground">{t.board.recipeNoGluten}</p>
            )}
          </>
        ) : (
          image?.page && (
            <a href={image.page} target="_blank" rel="noreferrer" className="text-muted-foreground underline">
              {t.board.aboutDish}
            </a>
          )
        )}
        {image && <span className="text-[10px] text-muted-foreground">{t.board.photo(photoSource(image))}</span>}
      </div>
    </div>
  );
}

function photoSource(image: NonNullable<BoardMeal["image"]>) {
  if (image.source === "wikimedia") return "Wikimedia Commons";
  if (image.source === "themealdb" || !image.page) return "TheMealDB";
  return new URL(image.page).hostname.replace(/^www\./, "");
}

function MoveRow({
  day,
  cells,
  meals,
  current,
  onPick,
}: {
  day: Day;
  cells: BoardCell[];
  meals: Map<string, BoardMeal>;
  current: Target;
  onPick: (to: Target) => void;
}) {
  const { t } = useLang();
  return (
    <>
      <span className="self-center font-semibold">{t.days[day]}</span>
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
            {isHere ? t.board.here : ((c?.mealId && meals.get(c.mealId)?.name) || c?.text || "")}
          </button>
        );
      })}
    </>
  );
}

function TagForm({ meal, pending, onSave, onBack }: { meal: PlanMeal; pending: boolean; onSave: (edit: TagEdit) => void; onBack: () => void }) {
  const { t } = useLang();
  const [f, setF] = useState<TagEdit>({
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
          onClick={() => setF({ ...f, [key]: o })}
          className={cn("rounded-full border px-2 py-1", f[key] === o ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
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
        {t.board.factsApply(meal.name)}
        {guessed ? t.board.someGuessed : ""}
      </p>
      <span className="font-medium">{t.board.mainProtein}</span>
      {seg("protein", ["meat", "fish", "veg"], (o) => t.protein[o].toLowerCase())}
      <span className="font-medium">{t.board.mainStarch}</span>
      {seg("starch", STARCHES, (o) => t.starch[o as keyof Messages["starch"]] ?? o)}
      <span className="font-medium">{t.board.effortLabel}</span>
      {seg("effort", ["quick", "normal", "long", ""], (o) => (o ? t.effort[o] : t.effort.unsure))}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_pasta} onChange={(e) => setF({ ...f, is_pasta: e.target.checked })} className="size-4" />
        {t.board.pastaMeal}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.is_processed} onChange={(e) => setF({ ...f, is_processed: e.target.checked })} className="size-4" />
        {t.board.processedMeal}
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={pending} onClick={() => onSave(f)}>
          {t.board.save}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t.board.back}
        </Button>
      </div>
      <p className="text-muted-foreground">{t.board.glutenHere(t.status[meal.gluten])}</p>
    </div>
  );
}
