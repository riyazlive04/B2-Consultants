# Forms — Google Forms parity

Written because the builder's field types did not behave the way their names promised: picking
**Checkbox** gave a single yes/no tick rather than a list of choices you tick several of, and there
was no multiple-choice (radio) type at all. That is not a bug in one dropdown — it is a field model
with seven entries where the thing everyone has in their head has thirteen.

So this catalogues **what Google Forms actually is**, then says what we build, what we don't, and
why. The "why not" list matters more than the "why": every one of those is a decision someone will
otherwise re-open in three months.

---

## 1. What Google Forms has

### 1.1 Items you can add (the `+` toolbar)

| Item | Notes |
|---|---|
| Question | any of the 12 types in §1.2 |
| Title and description | a static heading mid-form, not a question |
| Image | with caption + alignment |
| Video | YouTube embed |
| Section | a page break, with its own title and description |
| Import questions | copy items in from another form |

### 1.2 Question types

| # | Type | Shape of the answer |
|---|---|---|
| 1 | Short answer | one line of text |
| 2 | Paragraph | multi-line text |
| 3 | Multiple choice | **one** of N (radio), optional "Other" free-text |
| 4 | Checkboxes | **many** of N, optional "Other" |
| 5 | Dropdown | one of N, in a `<select>` |
| 6 | File upload | files, into the owner's Drive |
| 7 | Linear scale | an integer between two bounds, labelled at each end |
| 8 | Rating | stars / hearts, 3–10 of them |
| 9 | Multiple-choice grid | rows × columns, one pick per row |
| 10 | Checkbox grid | rows × columns, many picks per row |
| 11 | Date | day, optionally with year and/or time |
| 12 | Time | a clock time, or a duration |

### 1.3 Per-question controls

- **Required** toggle
- **Description** (help text under the title)
- **Duplicate**, **Delete**, **drag to reorder**
- **Response validation** — number (`>`, `<`, between, whole number…), text (contains, email, URL),
  length (min/max characters), regex (matches / doesn't match) — each with **custom error text**
- **Shuffle option order**
- **Add "Other"** (multiple choice, checkboxes)
- **Select at least / at most / exactly N** (checkboxes)
- **Go to section based on answer** (multiple choice, dropdown)

### 1.4 Section controls

- Title + description
- **After section N →** continue to next / go to section / submit the form
- Duplicate, move, merge with above

### 1.5 Settings

| Group | Setting |
|---|---|
| Quiz | make it a quiz, point values, answer key, release grades, show missed/correct answers |
| Responses | collect email addresses (verified / respondent input / off); send respondents a copy; allow editing after submit; limit to 1 response |
| Presentation | show progress bar; shuffle question order; confirmation message; link to submit another; view results summary; disable autosave |
| Defaults | make new questions required by default |

### 1.6 Responses

- **Accepting responses** on/off
- **Summary** — a chart per question (bars for choice, pie, histogram for scale, a list for text)
- **Question** view — one question at a time across all respondents
- **Individual** view — one respondent at a time
- Link to Sheets · **download CSV** · delete all · print · email me on new response

### 1.7 Form-level

Header image, theme colour, background, font · templates · duplicate · preview · undo/redo ·
collaborators · add-ons.

---

## 2. What we build

Everything in this table now exists. **No migration was needed** — `Form.fields` and
`Form.settings` are already `Json` columns, so the whole model change is a shape change plus a
normaliser that upgrades old rows on read.

| Google feature | Ours |
|---|---|
| Short answer / Paragraph | `text` / `textarea` |
| Multiple choice | **`radio`** — new, with "Other" and option shuffle |
| Checkboxes | **`checkboxes`** — new, multi-select, "Other", select-at-least/at-most/exactly |
| Dropdown | `select` |
| Linear scale | **`scale`** — new, bounds + end labels |
| Rating | **`rating`** — new, 3–10 stars |
| Date / Time | **`date`** (optionally with time) / **`time`** — new |
| Title and description | **`heading`** — new, a static block |
| Image | **`image`** — new, by URL |
| Section (page break) | **`section`** — new; the public form becomes multi-page with Back/Next |
| Required · description · duplicate · reorder | all present, per item |
| Response validation | number range / integer, length, regex — each with custom error text |
| Select at least / at most / exactly | on `checkboxes` |
| Shuffle option order | per question |
| Shuffle question order | per form |
| Go to section based on answer | per option on `radio` and `select`, plus per-section "after this section" |
| Progress bar | per form |
| Confirmation message / redirect | already existed; kept |
| Limit to 1 response | per form (see the honesty note in §3) |
| Submit another response | per form |
| Accepting responses | this is our existing **Publish / Unpublish** |
| Summary with charts | **Responses → Summary**, one chart per question, on the shared chart layer |
| Individual responses | **Responses → Individual** |
| Download CSV | via the shared streaming export |
| Preview | live preview pane in the builder |

We also keep three types Google doesn't have, because this is a CRM and not a survey tool:
`email`, `phone` and `number` are first-class rather than "short answer with validation", since
their keys map straight onto the contact record and their input modes matter on a phone.

`checkbox` (the old single yes/no) is **kept and unchanged**, relabelled "Checkbox — single /
consent". Redefining it as multi-select would have silently changed the behaviour of every form
already published. New multi-select work goes to `checkboxes`.

## 3. What we do not build, and why

| Not built | Why not |
|---|---|
| **File upload** | Needs object storage. The app container runs `read_only: true` with no volume and no S3 credentials — this is a hosting decision, not a form feature, and pretending otherwise would ship an upload button that 500s. |
| **Grids** (multiple-choice / checkbox) | The answer is a map per row, and every downstream consumer here — the contact's `customFields`, the CSV export, the automation triggers — is flat `key → value`. Adding grids means changing that contract, which is a data-model decision that should be taken on its own merits. |
| **Quiz mode** | Points and answer keys have no meaning for lead capture. |
| **Themes, fonts, header images** | The public form inherits the design system. A per-form colour and font picker is a licence for a form to drift out of brand, and it is the single most common way these builders end up looking cheap. |
| **Respondent email receipts** | The seam exists, but email is disarmed on live (`EMAIL_ENABLED=false`). Shipping a "send a copy" toggle that silently does nothing is exactly the built-but-off trap the Not-armed panel was built to end. It goes in the day Resend is armed. |
| **Response editing after submit** | Requires respondent identity. See below. |

**The honesty note on "limit to 1 response":** Google enforces it with a Google account. We have no
sign-in on a public lead-capture page, so ours is a browser cookie plus a same-IP check — it stops
the accidental double-submit it is actually there for, and it does not stop someone determined.
The toggle's help text says exactly that, rather than implying a guarantee we cannot make.

## 4. Notes for whoever changes this next

- **`lib/sites-types.ts` is isomorphic and pure.** The builder, the public renderer and the server
  action all import the same `normaliseItems`, `reachableItems` and `validateAnswer`. If validation
  disagrees between the browser and the server, that is a bug in one caller, not two rulesets.
- **Branch targets may only point forwards** (a later section, or "submit"). That is a deliberate
  restriction Google does not have: it makes an infinite loop unconstructable rather than merely
  unlikely, and no one has yet wanted a form that goes backwards.
- **Skipped sections do not block submission.** The server re-runs `reachableItems` against the
  submitted answers, so a `required` question inside a branch the respondent never saw is not
  enforced. Getting this wrong is the classic branching bug: an unreachable required field that
  makes the form permanently unsubmittable.
