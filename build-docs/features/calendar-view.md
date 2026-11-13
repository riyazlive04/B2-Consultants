# Feature 2: Calendar view (Week / Day / Month)

## Purpose
The Synamate calendar grid the team already knows: same toolbar, same views, same event cards.

## Architecture (measured from Synamate, 1440px viewport)
- Page header: title "Calendars" + underline tabs **Calendar view · Appointment list view ·
  ⚙ Calendar settings** (tab state in `?tab=`, house `Tabs` urlKey pattern).
- Toolbar row: `[Today]` `[‹ Nov 8 – 14, 2026 ›]` (label opens month date picker) `[Week view ▾]`
  (Day/Week/Month) … right: `[⚲ Manage view]` `[⋮]` (Calendar view settings only) `[+ New]` primary.
- Grid: left gutter 72px with tz label "GMT +05:30", "All day" row, hour rows **72px (two 36px
  half-hour lanes)**, labels "09:00 AM" 14px muted; day headers "08 Sun" 14px/600, past days muted,
  **today in accent**; red now-line (0.8px) with a dot; grid scrolls to 08:00 on load.
- Week: 7 columns, events packed by `layoutDay`. Day: **one column per selected team member**.
  Month: 7×N cells, date top-right, events as single-line chips, "+N more" → popover list.
- Event card (from captured CSS): radius 4px, border 2px, **left border 5px = owner colour**,
  fill = calendar colour; text 12px: bold title line, time range line; cancelled = surface fill,
  calendar-colour border + text, line-through; blocked = grey fill, "Busy"-style label "Blocked".
- Hover → dark tooltip: title, kind, "06:30 PM – 06:50 PM (IST)". Click → drawer (feature 4).
  Click empty lane → Book modal prefilled with that date/owner (feature 5).
- URL state: `?view=week|day|month&date=YYYY-MM-DD&users=a,b&cal=disco:x,…` so refresh/back keep it.
- Files: `src/app/(app)/bookings/_components/calendar/{CalendarView,TimeGrid,MonthGrid,EventCard,
  Toolbar}.tsx`; server data from `getCalendarEvents`.

## Impact map
- `bookings/page.tsx`: body replaced; KPI cards + Next-call move per decision 3.
- `SssCalendar.tsx` + `SlotManager.tsx`: their grid UIs retire; their **actions stay** and are
  called from the drawer/modal. Generate-slots UI stays at `/bookings/availability`.
- `sections.ts` label "Bookings" → "Calendars"; App Guide `manual-sales.ts` + shot manifest.
- `loading.tsx` skeleton → grid shape.
- e2e helpers referencing "Booking requests" tab text.

## Edge cases
- 0 events → empty grid (Synamate shows no empty-state card); Day view with 0 users selected →
  "Select a team member in Manage view".
- 40+ events in a month cell → capped list + "+N more".
- Narrow screens (<768px): Week falls back to Day; Month chips become dots + count.
- Keyboard: events are buttons (Enter opens drawer), grid cells focusable for "book here";
  tooltip also on focus; `aria-label` carries the full event text (cards truncate).
- Invalid `date` param → today. Server render in IST; client clock never decides "today".

## Acceptance criteria
- AC1 Week view of a week with 3 bookings shows 3 cards at correct IST time/height.
- AC2 Overlapping bookings render side by side, none hidden.
- AC3 Day view shows one column per selected owner, in Manage-view order.
- AC4 Month cell with more events than fit shows "+N more" and the popover lists all.
- AC5 Today/‹/› and the view dropdown update the URL; reload restores the same view.
- AC6 Cancelled card is hollow and struck through; blocked card is grey.
- AC7 Works for ADMIN, HEAD, USER; axe check has no new violations.
