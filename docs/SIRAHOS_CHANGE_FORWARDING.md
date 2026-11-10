# SirahOS change-request forwarding

Every improvement report filed in this app is **copied** to SirahOS (the company OS at
os.sirahagents.com), where the bugs and change requests of every client CRM land in one list.

It is a copy, not a move. The report, its recording, its attachments and its triage stay here,
where the reporter can see them. SirahOS stores only a title and a description.

## How it is wired

There is no second reporting UI. The existing Improvements module
(`src/server/improvement-actions.ts` → `submitImprovement`) is the only front door, and the
forward hangs off it:

```
submitImprovement
  └─ report saved (transaction)
      ├─ afterResponse("improvement:sirahos")  → forwardToSirahos()
      └─ afterResponse("improvement:notify")   → notifyDeveloper()
```

`src/server/sirahos-forward.ts` is the whole integration. It runs through `afterResponse`, the
same fire-and-forget seam every outbound send in this app uses, so:

- the reporter never waits on a network call to SirahOS
- a SirahOS outage can never cost somebody their report — the row is already committed
- it never throws and never rejects; a failure logs a warning and is reported to Sentry
- the request is capped at a 10 second timeout

All seven report kinds are forwarded, bugs included.

## Config

Read from the environment, never hardcoded:

| Variable | Meaning |
| --- | --- |
| `SIRAHOS_URL` | API origin, e.g. `https://api.os.sirahagents.com` |
| `SIRAHOS_PROJECT_ID` | This client's project id on SirahOS |
| `SIRAHOS_SECRET` | Sent as the `X-Sirahos-Signature` header |

**If `SIRAHOS_PROJECT_ID` or `SIRAHOS_SECRET` is unset, forwarding is silently off** — no errors,
no retries, no log noise. That is what keeps a dev copy or a local checkout from posting into the
client's live queue. The secret is never logged.

## The payload

`POST {SIRAHOS_URL}/api/change-intake/{SIRAHOS_PROJECT_ID}`

```json
{
  "title": "[Bug] Save button does nothing",
  "description": "I pressed Save and the spinner ran forever.\n\nExpected: ...\n\nPage: /students/[id]\nSeverity: Blocking\nB2 Consultants report: IMP-0042",
  "requestedBy": "Sita R (TELECALLER)",
  "reference": "IMP-0042",
  "source": "b2-consultants"
}
```

The internal kind maps to a readable label in the title: `NOT_WORKING` → `[Bug]`,
`NEW_FEATURE` → `[New feature]`, `CONFUSING` → `[UI issue]`, and so on.

**Severity and page are folded into the description on purpose.** SirahOS has nowhere else to put
them, so without this the queue cannot tell an urgent report from a cosmetic one.

`reference` is the local report's ref (`IMP-0042`). It is what makes a retry safe: re-sending the
same reference answers `200 {"duplicate": true}` instead of filing a second request.

Responses: `201` created · `200 {"duplicate":true}` already filed · `401` bad signature ·
`404` unknown project · `400` validation.

## Tests

`src/server/__tests__/sirahos-forward.test.ts` covers the skip-when-unconfigured paths, the
payload shape, and that neither a network error nor a non-2xx response ever throws.

Verified against the live endpoint on 10 Nov 2026: `201` on a fresh reference, `200` with
`duplicate: true` on a repeat.
