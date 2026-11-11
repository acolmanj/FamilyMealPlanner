"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { previewPlan, planTheWeeks, undoPlan, type PlanSummary } from "@/app/(app)/plan/actions";
import { withImagesPaused } from "@/app/(app)/week/resolve-images";
import { useLang } from "@/components/lang";
import { formatDate, type Messages } from "@/lib/i18n/messages";
import { relaxedNotes } from "@/lib/planner/generate";
import { cn } from "@/lib/utils";

// "Plan week" in the tab bar: ask first (how many empty slots), plan both weeks,
// then show the week with a short summary and an Undo for what was just added.

type Preview = { weeks: { weekStart: string; empty: number }[]; total: number };
type State =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "confirm"; preview: Preview }
  | { step: "working"; preview: Preview }
  | { step: "error"; text: string };
type Toast = { summary: PlanSummary; undone?: number | "failed"; undoing?: boolean } | null;

export const SPARKLES =
  "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0zM20 3v4M22 5h-4M4 17v2M5 18H3";

const weekLabel = (t: Messages, lang: "en" | "es", weekStart: string, i: number) =>
  (i === 0 ? t.plan.thisWeek : t.plan.nextWeek)(formatDate(weekStart, lang));

const portal = (node: React.ReactNode) => (typeof document === "undefined" ? null : createPortal(node, document.body));

function Spinner({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

export function PlanWeekTab() {
  const { lang, t } = useLang();
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<State>({ step: "idle" });
  const [toast, setToast] = useState<Toast>(null);
  const titleId = useId();
  const goRef = useRef<HTMLButtonElement>(null);

  const open = state.step !== "idle";
  const busy = state.step === "checking" || state.step === "working";
  const close = () => !busy && setState({ step: "idle" });

  // Focus the main button when the sheet changes step; Escape closes it.
  useEffect(() => {
    if (!open) return;
    goRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setState({ step: "idle" });
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, busy, state.step]);

  // The summary goes away by itself after a while, unless Undo is running.
  useEffect(() => {
    if (!toast || toast.undoing) return;
    const id = window.setTimeout(() => setToast(null), toast.undone !== undefined ? 5000 : 20000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Plain async handlers, not transitions: the navigation and refresh that follow must
  // not wait on (or be folded into) a transition that is still open.
  const start = async () => {
    setToast(null);
    setState({ step: "checking" });
    const r = await withImagesPaused(previewPlan).catch(() => null);
    if (!r?.ok) return setState({ step: "error", text: r?.error ?? t.plan.error });
    setState({ step: "confirm", preview: r });
  };

  const go = async (preview: Preview) => {
    setState({ step: "working", preview });
    const r = await withImagesPaused(() => planTheWeeks(Math.floor(Math.random() * 2 ** 31))).catch(() => null);
    if (!r?.ok) return setState({ step: "error", text: r?.error ?? t.plan.error });
    setState({ step: "idle" });
    setToast({ summary: r });
    if (path === "/week") router.refresh();
    else router.push("/week");
  };

  const undo = async () => {
    if (!toast) return;
    setToast({ ...toast, undoing: true });
    const r = await withImagesPaused(() => undoPlan(toast.summary.added)).catch(() => null);
    setToast({ summary: toast.summary, undone: r?.ok ? r.removed : "failed" });
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-haspopup="dialog"
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 pt-1 pb-1 text-[10px] font-semibold text-primary"
      >
        <span className="-mt-3 flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift ring-4 ring-white transition active:scale-90">
          {busy ? (
            <Spinner />
          ) : (
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={SPARKLES} />
            </svg>
          )}
        </span>
        <span className="truncate">{t.nav.plan}</span>
      </button>

      {/* The tab bar blurs what is behind it, which would trap fixed children inside it:
          the sheet and the summary are drawn on the page itself instead. */}
      {open && portal(
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/30" onClick={close} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-busy={busy}
            className="relative flex w-full max-w-md flex-col gap-3 rounded-t-3xl bg-card px-5 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-[15px] shadow-lift sm:rounded-3xl sm:pt-5"
          >
            <span className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-black/15 sm:hidden" aria-hidden="true" />
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {t.plan.title}
            </h2>

            {state.step === "checking" && (
              <p className="flex items-center gap-2 py-6 text-muted-foreground" role="status">
                <Spinner className="text-primary" /> {t.plan.checking}
              </p>
            )}

            {state.step === "error" && (
              <>
                <p className="rounded-xl bg-destructive/10 p-3 text-destructive" role="alert">
                  {state.text}
                </p>
                <button ref={goRef} onClick={close} className="h-12 rounded-full bg-muted font-semibold">
                  {t.plan.close}
                </button>
              </>
            )}

            {(state.step === "confirm" || state.step === "working") && (
              <>
                {state.preview.total > 0 ? (
                  <p className="text-[17px] font-medium">{t.plan.confirm(state.preview.total)}</p>
                ) : (
                  <p>{t.plan.nothing}</p>
                )}
                <ul className="flex flex-col divide-y divide-black/5 rounded-2xl bg-muted/60">
                  {state.preview.weeks.map((w, i) => (
                    <li key={w.weekStart} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span>{weekLabel(t, lang, w.weekStart, i)}</span>
                      <span className={cn("shrink-0 font-semibold", w.empty ? "text-primary" : "text-muted-foreground")}>{t.plan.emptyCount(w.empty)}</span>
                    </li>
                  ))}
                </ul>
                {state.preview.total > 0 && (
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">
                    <li>{t.plan.keeps}</li>
                    <li>{t.plan.elpais}</li>
                  </ul>
                )}
                {state.step === "working" ? (
                  <p className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary/10 font-semibold text-primary" role="status">
                    <Spinner /> {t.plan.workingLong}
                  </p>
                ) : state.preview.total > 0 ? (
                  <div className="flex flex-col gap-2">
                    <button
                      ref={goRef}
                      onClick={() => go(state.preview)}
                      className="h-12 rounded-full bg-primary text-[17px] font-semibold text-primary-foreground shadow-card active:scale-[0.98]"
                    >
                      {t.plan.go(state.preview.total)}
                    </button>
                    <button onClick={close} className="h-11 rounded-full font-semibold text-primary">
                      {t.plan.cancel}
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/week"
                    onClick={close}
                    className="flex h-12 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
                  >
                    {t.plan.seeWeek}
                  </Link>
                )}
              </>
            )}
          </div>
        </div>,
      )}

      {toast && portal(<PlanToast toast={toast} onUndo={undo} onClose={() => setToast(null)} />)}
    </>
  );
}

function PlanToast({ toast, onUndo, onClose }: { toast: NonNullable<Toast>; onUndo: () => void; onClose: () => void }) {
  const { lang, t } = useLang();
  const { summary } = toast;
  const headline = [t.plan.filled(summary.filled), summary.elpais.planned ? t.plan.fromElPais(summary.elpais.planned) : null].filter(Boolean).join(" · ");
  const notes = [
    summary.elpais.status === "down" ? t.plan.elpaisDown : null,
    summary.elpais.added.length ? t.plan.elpaisAdded(summary.elpais.added.length) : null,
    summary.elpais.skippedGluten ? t.plan.elpaisSkipped(summary.elpais.skippedGluten) : null,
    ...summary.weeks.map((w, i) => (w.failed ? t.plan.weekFailed(weekLabel(t, lang, w.weekStart, i)) : null)),
    ...relaxedNotes(t, [...new Set(summary.weeks.flatMap((w) => w.relaxed))]),
  ].filter((x): x is string => Boolean(x));
  const next = summary.weeks[1];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-xl flex-col gap-2 rounded-2xl bg-foreground px-4 py-3 text-[14px] text-white shadow-lift"
    >
      {toast.undone !== undefined ? (
        <div className="flex items-center justify-between gap-3">
          <span>{toast.undone === "failed" ? t.plan.undoFailed : t.plan.undone(toast.undone)}</span>
          <button onClick={onClose} className="shrink-0 px-2 py-1 font-semibold text-[#7ee08f]">
            {t.plan.close}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{headline}</span>
              {notes.map((n) => (
                <span key={n} className="mt-0.5 block text-[12px] text-white/75">
                  {n}
                </span>
              ))}
            </span>
            <button onClick={onClose} aria-label={t.plan.close} className="-mt-1 -mr-2 flex size-9 shrink-0 items-center justify-center text-lg text-white/70">
              ×
            </button>
          </div>
          <div className="flex items-center gap-2">
            {summary.filled > 0 && (
              <button
                onClick={onUndo}
                disabled={toast.undoing}
                className="flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 font-semibold text-white active:scale-95 disabled:opacity-60"
              >
                {toast.undoing && <Spinner />}
                {toast.undoing ? t.plan.undoing : t.plan.undo}
              </button>
            )}
            {next && next.filled > 0 && (
              <Link href={`/week?w=${next.weekStart}`} className="flex h-10 items-center rounded-full px-3 font-semibold text-[#7ee08f]">
                {t.plan.nextWeekLink}
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
