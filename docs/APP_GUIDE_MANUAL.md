# The App Guide manual - how it is built

The App Guide has three layers. Each answers a different question, and they are deliberately
separate.

| Layer | Lives in | Answers |
| --- | --- | --- |
| Thirty-second cards | `lib/guide-content.ts` (`GUIDES`) | "What is this screen for?" |
| Start-to-finish walkthroughs | `lib/guide-content.ts` (`GUIDE_JOURNEYS`) | "How do I onboard a student?" (crosses screens) |
| **The manual** | `lib/guide/manual-*.ts` (`MANUALS`) | "How does each part of this screen work, and where do I change the rule behind it?" |

## Routes

| Route | What it is | Who |
| --- | --- | --- |
| `/guide` | The index: search over every manual, cards grouped like the sidebar, then the walkthroughs | Everyone |
| `/guide/<section>` | One section's full manual | Anyone who can open that section |
| `/guide/rules` | Every configurable rule in the app, grouped by where it is changed | Admin |

A "?" button in the top bar (`ScreenGuideButton`) maps the screen you are on to its section and
opens that manual.

## Writing a manual entry

One `GuideManual` per sidebar section, one `GuideFeature` per **tab or sub-area of the screen**.
The types are in `lib/guide/manual-types.ts`; the structure is the contract, so a feature must say:

- `use` - how to use it, imperative steps.
- `logic` - how numbers are computed, what triggers what, derived vs stored, automatic vs manual.
- `controls` - where the rule is changed, with its `default`, its `effect` on records that already
  exist, and how to `reset` it. This is the half people come back for, and it is what the Rules
  map is built from.

Rules that hold:

- **No em or en dash in anything a reader sees.** The PDF writer encodes win-ansi, and the house
  style spells an aside with `" - "`. Enforced by `guide-manual.test.ts`.
- **No file, function or table names in reader-facing text.** Also enforced.
- **Console links go through `consoleHref(area, panel)`**, never a hand-typed query string. The
  panel ids are shared with the Console page itself, so a renamed panel breaks the build rather
  than the link.
- **A `?tab=N` link only works on a strip that opted into the URL** (`urlKey="tab"`). The test
  counts the tabs on the target page and fails a link past the end.

## Console deep links

`Tabs` takes an optional stable `id` per tab. With one, the address holds a slug rather than an
index, so reordering a strip never re-points a link:

```
/console?area=money&panel=payment-types
```

The outer strip clears `panel` when the area changes (`resetKeys`), so a stale panel never
follows you into an area that has no such tab.

## Screenshots

The manual names its shots; it does not contain them. `GuideFeature.shot` is a **recipe**: a
route, a caption, and the visible text of the one control to box.

```
npm run guide:shots -- --manual              # every manual shot
npm run guide:shots -- --manual --only=payments
```

The script opens each route on the **local** stack, finds that control, measures its box in
percent of the image, and writes:

- `public/guide/manual/<name>.jpg` - the picture (JPEG at 1x: there are ~200 of these in the
  image the VPS pulls).
- `src/lib/guide/shots.generated.ts` - the manifest, with each shot's size and measured box.

So no coordinate is ever typed, and a re-capture after a redesign moves every box with its button.
A shot named in a manual but absent from the manifest is simply not drawn - the guide never shows
a broken image while a capture is pending.

It **refuses to run against production**: these images ship inside the app, so a capture against
live data would publish real clients' names and fees into `public/`. Student-only screens
(Dashboard, My Journey, My Classroom) are captured in a second pass as the seeded demo student.

Known trap: every Claude session on this machine shares one Chrome profile directory, so a run can
fail with a profile lock while another session has a browser open.

## Tests

`src/lib/__tests__/guide-manual.test.ts` holds all of the above: one manual per section, no
orphans, unique anchors, real engine keys, every link resolving, every console panel wired, no long
dashes, and the Rules map losing nothing it was given.
