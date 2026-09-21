# Findings - Finance (PRD1 §A) + Cash Health (PRD3 §F)
Last full run (loaded server): 47 passed, 22 failed (12 real findings, 10 load timeouts), 1 skipped, 12 not run (serial skip after setup timeout). All load failures passed in earlier solo runs.

| ID | Sev | Finding | Root cause | Status |
|---|---|---|---|---|
| FIN-02 | High | Founder bug A: form default date is IST "today"; for a Berlin user after 20:30 CEST that is tomorrow -> saving default stores tomorrow. Picked dates themselves never shift (tested IST + Berlin, list/edit/DB/month bucket) | finance/page.tsx:103; record-form-data.ts:39 (istToday) vs DatePicker.tsx:132,259 | Confirmed |
| FIN-05 | High | Founder bug B: Finance > Income asks due dates for Instalment, but top-bar Record > Income has no due dates -> no receivable, no reminders | QuickRecordModal.tsx:168-183 | Confirmed |
| FIN-06 | High | Paying instalment 2 lowers balance but Next due + EMI count don't advance; paid overdue row stays red/Overdue | income never updates Instalment/nextDueDate | Confirmed |
| FIN-08 | High | Paid student still in dunning preview at FINAL stage -> would be chased once dunning armed | dunning.ts:84,148-155 | Confirmed |
| FIN-09 | High | Receivable from Pending payments form (past due) never reaches dunning ladder | dunning.ts:81-110; createPendingPayment creates no Instalment | Confirmed |
| FIN-12 | High | "Collected" sums all income from the student at any level (old Solo payment credited to new Guided plan) | finance-metrics.ts:48-62,84-86 | Confirmed |
| FIN-13 | High | Cash Health receivables exclude OVERDUE (Finance 5,48,500 vs Cash Health 4,49,500) | cash-metrics.ts:103 | Confirmed |
| FIN-01 | High | Finance writes exceed Prisma 5s transaction under load (P2028): edit lost, "Finance couldn't load"; worse in prod (Mumbai app, Singapore DB) | finance-actions.ts:276,413,486,621,683,744 | Confirmed, intermittent |
| FIN-04 | Med | "Generate EMI schedule" ignores money already collected | emi-actions.ts generateInstalmentPlan | Code |
| FIN-07 | Med | Balance reaches 0 but status never becomes Paid in full | PAID_IN_FULL never written | Confirmed |
| FIN-10 | Med | Pending payment is free-text name, not linked to student -> reminders can't reach them | PendingSection.tsx:605; whatsapp.ts:689 | Confirmed/code |
| FIN-11 | Med | Last-month period: KPIs follow, but Top 5 payments / category / COGS breakdown stay current month | finance/page.tsx:104,202,230,248 | Confirmed |
| FIN-03 | Low | No server date validation (crafted date -> 500); picker no min/max | finance-actions.ts:47,593 | Code |
| FIN-14 | Low | Rs 0 pending payment fee and Rs 0 payable accepted | finance-actions.ts:152; cash-actions.ts:106 | Confirmed |
| FIN-15 | Low | Business-line gross profit popup mixes combined revenue with line COGS | finance/page.tsx:305 | Code |
| FIN-16 | Low | Cash position can't be edited/deleted; negative balance can't be typed; Monday not enforced | CashClient.tsx | Code/UI |
| FIN-17 | Low | Divergence: burn divides by months with data, not 3 | cash-metrics.ts:53-59 | Divergence |
| FIN-18 | Low | Divergence: CSV dates YYYY-MM-DD; FX = ECB rate at entry, not live | export route :148 | Divergence |

Verified OK: income/expense round-trip (all fields, INR/EUR), dashboard metrics exact deltas, Indian/German formats, tooltips, CSV, instalment balance maths, red overdue rows, bell count, overdue sweep, payables + break-even, 7-day red highlight, stale badge, runway formula + colours + top bar, target bar colours, required fields, no double-submit duplicates.
Prod notes: 02 posts last-month/31-12 entries (check period locks); 06 creates overdue plans while dunning ARMED in prod -> run 99 immediately; 04 deltas break if founder records money concurrently; cleanup must run separately with E2E_FIN_CLEAN_TAGS.
