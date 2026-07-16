"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TrackerRow } from "@/server/students-metrics";
import type { WhatsAppStatusCell } from "@/server/whatsapp";
import { sendStudentNudge } from "@/server/whatsapp-actions";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/form";
import { SendWhatsAppButton } from "@/components/ui/SendWhatsAppButton";
import { WhatsAppStatusBadge } from "@/components/ui/WhatsAppStatusBadge";
import { MomentumChip } from "@/components/ui/gamification";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { signalForStudent } from "@/lib/signals";
import { formatDate } from "@/lib/format";
import { MILESTONE_LABELS, PROGRAM_LEVEL_LABELS } from "@/lib/labels";

const SIGNAL_ORDER: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2 };

/** 90/120-day tracker list (PRD2 §4.3) with the three PRD sorts + signal/level filters. */
export function TrackerTable({
  rows,
  isAdmin,
  waStatus = {},
}: {
  rows: TrackerRow[];
  isAdmin: boolean;
  waStatus?: Record<string, WhatsAppStatusCell>;
}) {
  const [signalFilter, setSignalFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [sort, setSort] = useState<"signal" | "session" | "end">("signal");

  const visible = useMemo(() => {
    let out = rows;
    if (signalFilter) out = out.filter((r) => r.signalColour === signalFilter);
    if (levelFilter) out = out.filter((r) => r.programLevel === levelFilter);
    return [...out].sort((a, b) => {
      if (sort === "signal") {
        return (SIGNAL_ORDER[a.signalColour ?? ""] ?? 3) - (SIGNAL_ORDER[b.signalColour ?? ""] ?? 3);
      }
      if (sort === "session") {
        return (b.daysSinceLastSession ?? -1) - (a.daysSinceLastSession ?? -1);
      }
      return (a.programEndDate ?? "9999").localeCompare(b.programEndDate ?? "9999");
    });
  }, [rows, signalFilter, levelFilter, sort]);

  const columns: Column<TrackerRow>[] = [
    {
      key: "name", header: "Student",
      cell: (r) => (
        <Link href={`/students/${r.studentId}`} className="font-medium text-accent hover:underline">
          {r.studentName}
        </Link>
      ),
      value: (r) => r.studentName,
    },
    { key: "level", header: "Level", cell: (r) => PROGRAM_LEVEL_LABELS[r.programLevel], value: (r) => r.programLevel },
    {
      key: "day", header: "Day", align: "right",
      cell: (r) => `Day ${r.dayNumber} of ${r.totalDays}`,
      value: (r) => r.dayNumber,
    },
    { key: "milestone", header: "Milestone", cell: (r) => MILESTONE_LABELS[r.currentMilestone], value: (r) => MILESTONE_LABELS[r.currentMilestone] },
    {
      key: "journey", header: "Journey", align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="tnum text-xs text-muted">{r.stageTitle} · {r.journeyXp} XP</span>
          {r.momentum && <MomentumChip momentum={r.momentum} size="sm" />}
        </span>
      ),
      value: (r) => r.journeyXp,
    },
    {
      key: "signal", header: "Signal",
      cell: (r) =>
        r.signalColour ? (
          <SignalBadge level={signalForStudent(r.signalColour)} size="sm" />
        ) : (
          <span className="text-xs text-muted">Not set</span>
        ),
      value: (r) => SIGNAL_ORDER[r.signalColour ?? ""] ?? 3,
    },
    {
      key: "session", header: "Days since session", align: "right",
      cell: (r) => (r.daysSinceLastSession === null ? "-" : r.daysSinceLastSession),
      value: (r) => r.daysSinceLastSession,
    },
    {
      key: "checkin", header: "Next check-in",
      cell: (r) => (r.nextCheckInDate ? formatDate(r.nextCheckInDate) : "-"),
      value: (r) => r.nextCheckInDate?.slice(0, 10) ?? "",
    },
    {
      key: "whatsapp", header: "WhatsApp", sortable: false,
      cell: (r) => {
        const w = waStatus[r.studentId];
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            {w && <WhatsAppStatusBadge status={w.status} kind={w.kind} at={w.at} />}
            <SendWhatsAppButton action={() => sendStudentNudge(r.enrollmentId, "CHECKIN_NUDGE")} label="Nudge" />
          </span>
        );
      },
      value: (r) => waStatus[r.studentId]?.status ?? "",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as never)}
          aria-label="Sort"
          options={[
            { value: "signal", label: "Sort: Red first" },
            { value: "session", label: "Sort: longest since session" },
            { value: "end", label: "Sort: program ends soonest" },
          ]}
        />
        <Select
          value={signalFilter}
          onChange={(e) => setSignalFilter(e.target.value)}
          aria-label="Signal filter"
          options={[
            { value: "", label: "All signals" },
            { value: "RED", label: "Red only" },
            { value: "AMBER", label: "Amber only" },
            { value: "GREEN", label: "Green only" },
          ]}
        />
        <Select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          aria-label="Level filter"
          options={[
            { value: "", label: "All levels" },
            { value: "GUIDED", label: "Guided only" },
            { value: "ELITE", label: "Elite only" },
          ]}
        />
        <span className="text-xs text-muted">{visible.length} of {rows.length} active tracked students</span>
      </div>
      <DataTable
        rows={visible}
        columns={columns}
        csvName={isAdmin ? "student-tracker" : undefined}
        rowClassName={(r) => (r.signalColour === "RED" ? "bg-risk-soft" : undefined)}
        emptyMessage="No active Guided or Elite students yet."
        filterPlaceholder="Filter by name…"
      />
    </div>
  );
}
