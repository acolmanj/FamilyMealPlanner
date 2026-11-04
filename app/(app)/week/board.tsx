"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { FoodIcons } from "@/components/food-icons";
import { GlutenBadge } from "@/components/gluten-badge";
import { useLang } from "@/components/lang";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalise } from "@/lib/gluten/gate";
import { cleanTitle, type Messages } from "@/lib/i18n/messages";
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
  meat: "border-l-[#8b1a1a] bg-[#fbeeee]",
  fish: "border-l-[#1d5fb4] bg-[#edf4fd]",
  veg: "border-l-[#2e7d32] bg-[#eef7ea]",
};
// Below the sm breakpoint the side panel becomes a bottom sheet.
const isWide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
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
      className="pointer-events-none aspect-square w-1/5 max-w-14 min-w-8 shrink-0 rounded-lg object-cover"
    />
  );
}

export function WeekBoard({ week, cells, meals, history }: { week: string; cells: BoardCell[]; meals: BoardMeal[]; history: Use[] }) {
  const { lang, t } = useLang();
  const [shown, change] = useOptimistic(cells, applyChange);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<Target | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
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

  const sheetUp = Boolean(open) || sheet;
  const closeSheet = () => {
    setOpen(null);
    setSheet(false);
  };
  const pickedMeal = picked ? mealMap.get(picked) : undefined;

  const openCell = open ? (shown.find((c) => c.day === open.day && c.slot === open.slot) ?? null) : null;
  const weekSuggestions = suggestForWeek({ weekStart: week, cells: ruleCells, meals: mealMap, history, count: 10, lang });

  return (
    <div className="flex items-start gap-3">
      {/* On a phone the panel is a sheet over the week; tapping outside closes it. */}
      {sheetUp && !drag && <div className="fixed inset-0 z-40 bg-black/25 sm:hidden" onClick={closeSheet} aria-hidden="true" />}
      <aside
        data-drop={drag?.data.kind === "cell" ? "remove" : undefined}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[70dvh] flex-col [&>*]:shrink-0 gap-2.5 overflow-y-auto overscroll-contain rounded-t-3xl bg-card px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm shadow-lift transition",
          "sm:sticky sm:top-16 sm:z-auto sm:flex sm:max-h-[calc(100dvh-9rem)] sm:w-[40%] sm:max-w-72 sm:shrink-0 sm:rounded-2xl sm:p-3 sm:text-xs sm:shadow-card",
          !sheetUp && "hidden",
          // While a meal is being dragged from the sheet, let the finger reach the week underneath.
          drag?.data.kind === "meal" && "pointer-events-none opacity-30 sm:pointer-events-auto sm:opacity-100",
          drag?.data.kind === "cell" && "ring-2 ring-destructive",
          drag?.over === "remove" && "bg-[#fff0ef]",
        )}
      >
        <span className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-black/15 sm:hidden" aria-hidden="true" />
        {drag?.data.kind === "cell" && <p className="rounded-xl bg-destructive/10 p-2 text-center font-medium text-destructive">{t.board.dropToRemove}</p>}
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
            onClose={closeSheet}
          />
        ) : (
          <WeekSuggestions
            suggestions={weekSuggestions}
            meals={meals}
            cells={shown}
            picked={picked}
            onPick={tapped((id: string) => {
              setPicked((p) => (p === id ? null : id));
              // On a phone, get the sheet out of the way so the week can be tapped.
              if (!isWide()) setSheet(false);
            })}
            onClose={closeSheet}
            dragProps={dragProps}
          />
        )}
      </aside>

      {/* Phone only: dragging a planned meal here removes it. */}
      {drag?.data.kind === "cell" && (
        <div
          data-drop="remove"
          className={cn(
            "fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 rounded-2xl bg-card p-4 text-center text-sm font-semibold text-destructive shadow-lift sm:hidden",
            drag.over === "remove" && "bg-destructive text-white",
          )}
        >
          {t.board.dropToRemove}
        </div>
      )}

      {pickedMeal && !drag && (
        <div className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-2xl bg-foreground/90 px-4 py-3 text-sm text-white shadow-lift backdrop-blur-xl sm:hidden">
          <span className="min-w-0 flex-1 truncate">{t.board.tapSlotFor(pickedMeal.name)}</span>
          <button className="shrink-0 font-semibold text-[#7ee08f]" onClick={() => setPicked(null)}>
            {t.board.cancel}
          </button>
        </div>
      )}

      {!sheetUp && !pickedMeal && !drag && (
        <button
          onClick={() => setSheet(true)}
          className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-12 items-center gap-1.5 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground shadow-lift active:scale-95 sm:hidden"
        >
          <span aria-hidden="true">✨</span>
          {t.board.suggestions}
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2 pb-16 sm:pb-0">
        {error && !sheetUp && <p className="rounded-xl bg-destructive/10 p-2 text-sm text-destructive sm:hidden">{error}</p>}
        <div className="grid grid-cols-[2.25rem_repeat(2,minmax(0,1fr))] gap-2 text-xs" aria-busy={pending}>
          <span />
          {SLOTS.map((s) => (
            <span key={s} className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
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
                } else {
                  setSheet(false);
                  setOpen((o) => (o?.day === day && o.slot === slot ? null : { day, slot }));
                }
              })}
            />
          ))}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
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
          className="pointer-events-none fixed z-[60] max-w-44 -translate-x-1/2 -translate-y-[130%] rounded-xl bg-card px-3 py-1.5 text-xs font-semibold shadow-lift"
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
        <span className="text-[11px] font-semibold text-muted-foreground uppercase">{t.days[day]}</span>
        <span className="text-lg font-semibold">{Number(date.slice(8))}</span>
      </span>
      {SLOTS.map((slot) => {
        const key = cellKey({ day, slot });
        const c = cells.find((x) => x.day === day && x.slot === slot);
        const m = c?.mealId ? meals.get(c.mealId) : undefined;
        const label = m?.name ?? cleanTitle(c?.text ?? "");
        return (
          <button
            key={slot}
            data-drop={key}
            onClick={() => onTap(slot)}
            {...(c ? dragProps({ kind: "cell", day, slot, label }) : {})}
            className={cn(
              "flex min-h-[4.5rem] touch-manipulation items-start gap-1.5 rounded-xl border-l-4 border-l-transparent bg-card p-2 text-left shadow-card transition select-none active:scale-[0.98] [-webkit-touch-callout:none]",
              !c && "border-2 border-dashed border-black/10 bg-transparent text-muted-foreground shadow-none",
              m && PROTEIN_STYLE[m.tags.protein],
              c && !m && "bg-card",
              m?.gluten === "blocked" && "ring-2 ring-destructive",
              open?.day === day && open.slot === slot && "ring-2 ring-primary",
              over === key && "ring-2 ring-primary/60 shadow-lift",
            )}
            aria-label={`${t.days[day]} ${t.slots[slot]}: ${label || t.board.emptyLabel}`}
          >
            {c ? (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 self-stretch">
                  <span className="line-clamp-3 text-[13px] leading-snug font-medium break-words hyphens-auto">{label}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    {m && <FoodIcons starch={m.tags.starch} isPasta={m.tags.isPasta} isPulse={m.tags.isPulse} hasRice={m.tags.hasRice} className="text-sm" />}
                    {m?.tags.isProcessed && <span>{t.board.processed}</span>}
                    {m?.gluten === "blocked" && <span className="font-semibold text-destructive">{t.board.blocked}</span>}
                    {!m && <span>{c.leftover ? t.board.leftovers : t.board.notInLibrary}</span>}
                  </span>
                </span>
                <Thumb meal={m} />
              </>
            ) : (
              <span className="m-auto text-xl font-light">+</span>
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
        "flex shrink-0 touch-manipulation items-start gap-1.5 rounded-xl border-l-4 p-2 text-left shadow-card transition select-none active:scale-[0.98] [-webkit-touch-callout:none]",
        PROTEIN_STYLE[meal.tags.protein],
        meal.gluten === "blocked" && "opacity-60",
        picked && "ring-2 ring-primary",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="leading-snug font-medium break-words hyphens-auto">{meal.name}</span>
        <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <FoodIcons starch={meal.tags.starch} isPasta={meal.tags.isPasta} isPulse={meal.tags.isPulse} hasRice={meal.tags.hasRice} className="text-sm" />
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
  onClose,
  dragProps,
}: {
  suggestions: { meal: PlanMeal; why: string }[];
  meals: BoardMeal[];
  cells: BoardCell[];
  picked: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold sm:text-sm">{t.board.suggested}</h2>
        <button onClick={onClose} className="text-[15px] font-semibold text-primary sm:hidden">
          {t.board.done}
        </button>
      </div>
      <p className="text-muted-foreground">
        {picked ? t.board.tapSlotNow : t.board.dragHelp}
      </p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.board.search} aria-label={t.board.search} className="h-10 text-[15px] sm:h-9 sm:text-sm" />
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
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t.days[day]} {t.slots[slot]}
          </p>
          <p className="text-[17px] leading-snug font-semibold sm:text-sm">{cell ? (meal?.name ?? cleanTitle(cell.text ?? "")) : t.board.empty}</p>
        </div>
        <button onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-lg leading-none text-muted-foreground" aria-label={t.board.close}>
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
              className="rounded-xl bg-muted px-3 py-2.5 text-left font-medium active:bg-black/10"
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
          <h2 className="mt-1 text-sm font-semibold">{cell ? t.board.swapFor : t.board.suggestedHere}</h2>
          {suggestions.length === 0 && <p className="text-muted-foreground">{t.board.noFit}</p>}
          {suggestions.map(({ meal: m, why }) => (
            <MealTile key={m.id} meal={m} why={why} onClick={() => !pending && pick(m)} />
          ))}
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.board.search} aria-label={t.board.search} className="h-10 text-[15px] sm:h-9 sm:text-sm" />
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
          <div className="grid grid-cols-[2rem_repeat(2,minmax(0,1fr))] gap-1.5">
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
    <div className="flex gap-2 rounded-xl bg-muted p-2">
      {image && (
        <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-lg object-cover" />
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
            className={cn("min-h-10 truncate rounded-lg bg-muted px-1.5 text-left", isHere && "bg-primary/15 font-semibold text-primary", !c && "border border-dashed border-black/15 bg-transparent")}
          >
            {isHere ? t.board.here : ((c?.mealId && meals.get(c.mealId)?.name) || cleanTitle(c?.text ?? ""))}
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
          className={cn("rounded-full px-3 py-1.5 font-medium", f[key] === o ? "bg-primary text-primary-foreground" : "bg-muted")}
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
