"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCheck,
  ClipboardCheck,
  Eye,
  EyeOff,
  Hand,
  Radio,
  Square,
  Timer,
  UserCheck,
} from "lucide-react";
import {
  closeAttendanceWindow,
  fillUnmarkedAttendance,
  openAttendanceWindow,
  setAttendanceVisibility,
} from "@/server/attendance-actions";
import type { AttendanceBoard, BoardSessionView } from "@/server/attendance-board";
import { CatchUpCard } from "./CatchUpCard";
import { countdownLabel, MAX_WINDOW_MINUTES } from "@/lib/attendance-window";
import { AttendanceSheetModal } from "@/components/attendance/AttendanceSheet";
import { Modal } from "@/components/ui/Modal";
import { Btn, SegmentedControl } from "@/components/ui/controls";
import { Field, FormError } from "@/components/ui/form";
import { Card, Chip, EmptyState, Pill } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";

/**
 * THE REGISTER DESK, client half.
 *
 * ── Why this polls, when almost nothing else in the app does ────────────────────────────
 * Every other screen here is a server component that re-reads on navigation, and that is the
 * right default. This one has a genuinely live job: a tutor opens the window and then watches
 * eight people arrive over four minutes. Without a refresh the page would show "0 of 8" for
 * the entire window and the tutor would have no way to tell the feature was working at all.
 *
 * It polls ONLY while a window is open (`board.liveNow.length`), so the desk costs nothing on
 * the other six days of the week, and it asks the SERVER rather than keeping a client-side
 * count - the arrivals are coming from other people's devices, so there is nothing local to
 * count. Ten seconds is the compromise: fast enough that the list visibly moves, slow enough
 * that a cohort of eight does not re-render a page six times a minute.
 */
export function AttendanceDesk({ board }: { board: AttendanceBoard }) {
  const router = useRouter();
  const live = board.liveNow.length > 0;

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [live, router]);

  const [sheet, setSheet] = useState<{ id: string; title: string } | null>(null);
  const [opening, setOpening] = useState<BoardSessionView | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  const lists: { key: string; label: string; rows: BoardSessionView[]; empty: string }[] = [
    {
      key: "today",
      label: "Today",
      rows: board.today,
      empty: "No class today in any cohort you teach.",
    },
    {
      key: "outstanding",
      label: "Never marked",
      rows: board.outstanding,
      empty: "Every class you have taught has a register. Nothing owed.",
    },
    {
      key: "unpublished",
      label: "Not shown to students",
      rows: board.unpublished,
      empty: board.publishRequired
        ? "Every marked register has been shown to its batch."
        : "Publishing is switched off in Console → Attendance, so marks are visible as soon as they are taken.",
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── What is open right now. First, because it is the only thing with a deadline. ── */}
      {board.liveNow.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2 font-display text-h3 text-ink">
              <Radio size={18} className="animate-pulse text-primary" aria-hidden />
              Open now
            </span>
          }
          subtitle="Students in these cohorts are seeing a check-in button."
        >
          <div className="space-y-3">
            {board.liveNow.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                board={board}
                onTake={() => setSheet({ id: s.id, title: s.title })}
                onOpen={() => setOpening(s)}
                onChanged={refresh}
                emphasise
              />
            ))}
          </div>
        </Card>
      )}

      {lists.map((l) => (
        <Card key={l.key} title={`${l.label}${l.rows.length ? ` (${l.rows.length})` : ""}`}>
          {l.rows.length === 0 ? (
            <p className="text-sm text-muted">{l.empty}</p>
          ) : (
            <div className="space-y-3">
              {l.rows.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  board={board}
                  onTake={() => setSheet({ id: s.id, title: s.title })}
                  onOpen={() => setOpening(s)}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}
        </Card>
      ))}

      {/*
        ── Who missed a class and has not caught up ──
        The founders' "section for when they are not watching the recordings within 24 hours".
        It sits below the registers because it is a follow-up list rather than a deadline, and
        above the cohort summary because it is something to DO.
      */}
      <CatchUpCard rows={board.catchUp} graceHours={board.catchUpHours} onChanged={refresh} />

      {/* ── The cohorts themselves, as a standing reference rather than a chore list. ── */}
      <Card title="Your cohorts" subtitle="Attendance across every class marked so far.">
        {board.batches.length === 0 ? (
          <EmptyState
            icon={<UserCheck size={22} />}
            title="No cohort assigned to you"
            body="Attendance is scoped to the batches you lead. Ask the founder to set you as the batch lead, and this desk fills itself."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {board.batches.map((b) => (
              <Link
                key={b.id}
                href={b.href}
                className="press block rounded-field border border-line bg-surface p-4 hover:border-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display font-semibold text-ink">{b.name}</p>
                    <p className="text-caption text-muted">
                      {b.level} · {b.rosterSize} student{b.rosterSize === 1 ? "" : "s"} ·{" "}
                      {b.markedSessions} of {b.liveSessions} class
                      {b.liveSessions === 1 ? "" : "es"} marked
                    </p>
                  </div>
                  {b.attendancePct === null ? (
                    <Pill tone="neutral">Not marked</Pill>
                  ) : (
                    <Pill tone={b.attendancePct >= 80 ? "good" : b.attendancePct >= 60 ? "warn" : "bad"}>
                      {b.attendancePct}%
                    </Pill>
                  )}
                </div>
                {!b.iLead && <p className="mt-2 text-caption text-muted">You are supervising this one.</p>}
              </Link>
            ))}
          </div>
        )}
      </Card>

      {board.recent.length > 0 && (
        <Card title="Recently marked">
          <div className="space-y-3">
            {board.recent.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                board={board}
                onTake={() => setSheet({ id: s.id, title: s.title })}
                onOpen={() => setOpening(s)}
                onChanged={refresh}
              />
            ))}
          </div>
        </Card>
      )}

      {sheet && (
        <AttendanceSheetModal
          sessionId={sheet.id}
          sessionTitle={sheet.title}
          open
          onClose={() => setSheet(null)}
          onSaved={refresh}
        />
      )}
      {opening && (
        <OpenWindowModal
          session={opening}
          defaultMins={board.defaultWindowMins}
          defaultGrace={board.defaultGraceMins}
          onClose={() => setOpening(null)}
          onOpened={refresh}
        />
      )}
    </div>
  );
}

/** Ticks down from the server's `remainingMs`, anchored at mount. See CheckInCard's note. */
function LiveCountdown({ ms }: { ms: number }) {
  const deadline = useMemo(() => Date.now() + ms, [ms]);
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, deadline - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return (
    // The title matters in the "Today" list, where the bare clock is the only thing on the row
    // that could be mistaken for the class time.
    <Pill tone={left < 60_000 ? "bad" : "warn"} title="Time left for students to check themselves in">
      <Timer size={12} aria-hidden /> {countdownLabel(left)} left
    </Pill>
  );
}

function SessionRow({
  s,
  board,
  onTake,
  onOpen,
  onChanged,
  emphasise = false,
}: {
  s: BoardSessionView;
  board: AttendanceBoard;
  onTake: () => void;
  onOpen: () => void;
  onChanged: () => void;
  emphasise?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) => {
      setBusy(key);
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast(okText, "success");
      onChanged();
    },
    [onChanged],
  );

  const open = s.windowState === "OPEN";
  /**
   * Opening a window only makes sense within a day of the class - the same bound the server
   * enforces in `openAttendanceWindow`. Showing the button outside it would be offering a
   * press whose only outcome is an error message.
   */
  const DAY = 86_400_000;
  const startMs = new Date(s.startsAt).getTime();
  const openable =
    s.canMark &&
    board.selfCheckInEnabled &&
    !open &&
    Math.abs(startMs - Date.now()) <= DAY;

  const published = s.publishedAt !== null;
  const unmarked = Math.max(0, s.rosterSize - s.markedCount);

  return (
    <div
      className={`rounded-field border p-4 ${
        emphasise ? "border-primary-tint bg-sky" : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[200px] flex-1">
          <p className="font-display text-[15px] font-semibold text-ink">{s.title}</p>
          <p className="text-caption text-muted">
            {s.batchName} · {formatDate(s.dateYmd)}
            {s.timeHm ? ` · ${s.timeHm} IST` : ""}
            {s.framework ? ` · ${s.framework}` : ""}
          </p>
        </div>

        {/* Marked / roster, and how much of it the students did themselves - the number that
            says whether the window is earning its keep. */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip>
            {s.markedCount} of {s.rosterSize} marked
          </Chip>
          {s.checkedInCount > 0 && (
            <Pill tone="info" title="Students who checked themselves in">
              <Hand size={12} aria-hidden /> {s.checkedInCount} checked in
            </Pill>
          )}
          {open && <LiveCountdown ms={s.windowRemainingMs} />}
          {!open && s.markedCount > 0 && board.publishRequired && (
            <Pill tone={published ? "good" : "warn"}>
              {published ? "Shown to students" : "Not shown yet"}
            </Pill>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {openable && (
            <Btn size="sm" variant="primary" onClick={onOpen} icon={<Radio size={14} />}>
              Open attendance
            </Btn>
          )}
          {open && s.canMark && (
            <Btn
              size="sm"
              variant="outline"
              icon={<Square size={14} />}
              busy={busy === "close"}
              onClick={() =>
                run("close", () => closeAttendanceWindow({ sessionId: s.id }), "Attendance closed.")
              }
            >
              Close now
            </Btn>
          )}
          {s.canMark && (
            <Btn size="sm" variant="secondary" onClick={onTake} icon={<ClipboardCheck size={14} />}>
              {s.markedCount > 0 ? "Edit register" : "Take register"}
            </Btn>
          )}
          {/* The one press that finishes a register the room has mostly filled. Offered only
              when there is actually a residue, and only once the class has started. */}
          {s.canMark && unmarked > 0 && s.markedCount > 0 && startMs <= Date.now() && (
            <Btn
              size="sm"
              variant="ghost"
              icon={<CheckCheck size={14} />}
              busy={busy === "fill"}
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Mark the remaining ${unmarked} absent?`,
                  body: "Students who already have a mark are left alone. You can change any row afterwards.",
                  confirmLabel: "Mark absent",
                });
                if (!ok) return;
                await run(
                  "fill",
                  () => fillUnmarkedAttendance({ sessionId: s.id, status: "ABSENT" }),
                  `${unmarked} student${unmarked === 1 ? "" : "s"} marked absent.`,
                );
              }}
            >
              Rest absent ({unmarked})
            </Btn>
          )}
          {s.canMark && s.markedCount > 0 && board.publishRequired && (
            <Btn
              size="sm"
              variant={published ? "ghost" : "primary"}
              icon={published ? <EyeOff size={14} /> : <Eye size={14} />}
              busy={busy === "publish"}
              onClick={() =>
                run(
                  "publish",
                  () =>
                    setAttendanceVisibility({
                      sessionId: s.id,
                      published: published ? "false" : "true",
                    }),
                  published ? "Hidden from the batch." : "The batch can now see this register.",
                )
              }
            >
              {published ? "Hide" : "Show to students"}
            </Btn>
          )}
        </div>
      </div>

      {open && s.openedByName && (
        <p className="mt-2 text-caption text-muted">Opened by {s.openedByName}.</p>
      )}
      {published && s.publishedByName && !open && (
        <p className="mt-2 text-caption text-muted">Shown by {s.publishedByName}.</p>
      )}
    </div>
  );
}

/**
 * How long, and how long is still on time.
 *
 * A modal rather than a one-press default, because these two numbers are the only thing that
 * makes a self check-in trustworthy and a tutor should set them deliberately the first few
 * times. The defaults come from the founder's config, so the common case is open-and-confirm.
 */
function OpenWindowModal({
  session,
  defaultMins,
  defaultGrace,
  onClose,
  onOpened,
}: {
  session: BoardSessionView;
  defaultMins: number;
  defaultGrace: number;
  onClose: () => void;
  onOpened: () => void;
}) {
  const [mins, setMins] = useState(String(defaultMins));
  const [grace, setGrace] = useState(String(Math.min(defaultGrace, defaultMins)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await openAttendanceWindow({
      sessionId: session.id,
      minutes: mins,
      graceMins: grace,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast(`Attendance is open for ${mins} minutes.`, "success");
    onOpened();
    onClose();
  };

  const MINUTE_CHOICES = ["5", "10", "15", "30", "60"] as const;

  return (
    <Modal open onClose={onClose} title="Open attendance" subtitle={session.title} size="md">
      <div className="space-y-5">
        <p className="text-sm text-ink-2">
          Everyone on this cohort&apos;s roster will see a check-in button with a countdown. You can
          close it early, and you can change any mark afterwards.
        </p>

        <Field label="Open for" hint="The window closes itself when this runs out.">
          <SegmentedControl
            value={mins}
            onChange={(v) => {
              setMins(v);
              // The server refuses a grace longer than the window; keeping the two consistent
              // here means the tutor never meets that error.
              if (Number(grace) > Number(v)) setGrace(v);
            }}
            options={MINUTE_CHOICES.map((m) => ({ value: m, label: `${m} min` }))}
            ariaLabel="How long to keep attendance open"
            size="sm"
          />
        </Field>

        <Field
          label="On time for the first"
          hint="A check-in after this records as Late, which still counts as attending."
        >
          <SegmentedControl
            value={grace}
            onChange={setGrace}
            options={["0", "5", "10", "15"]
              .filter((g) => Number(g) <= Number(mins) && Number(g) <= MAX_WINDOW_MINUTES)
              .map((g) => ({ value: g, label: g === "0" ? "No grace" : `${g} min` }))}
            ariaLabel="How long a check-in still counts as on time"
            size="sm"
          />
        </Field>

        <p className="text-caption text-muted">
          Lateness is counted from whichever is later - the class start time or the moment you
          open this - so opening early does not make anyone late, and opening late does not
          penalise the room.
        </p>

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={submit} busy={busy} icon={<Radio size={15} />}>
            Open attendance
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
