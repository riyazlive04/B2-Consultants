/**
 * Chart maths - the geometry every chart in the app now shares.
 *
 * These are worth testing precisely because they are invisible: a wrong scale doesn't throw,
 * it draws a plausible picture of the wrong number. The cases below pin the three ways that
 * actually happens - an axis labelled with unrecognisable numbers, a baseline that floats and
 * exaggerates a difference, and a "+100%" growth figure invented out of a zero denominator.
 *
 * Run: npm test
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  areaPath,
  attainmentPct,
  bandPath,
  barPath,
  bandScale,
  splitAtCrossings,
  compactInrMinor,
  compactNumber,
  domainFor,
  linePath,
  linearScale,
  niceTicks,
  pctChange,
  pointScale,
  rollUpLongTail,
  seriesColor,
  tickIndices,
} from "../chart";

describe("niceTicks", () => {
  test("lands on the 1/2/5 ladder, not on the data's own edges", () => {
    // The whole point: 347912 must NOT become a gridline label.
    const ticks = niceTicks(0, 347912, 4);
    assert.ok(ticks.every((t) => Number.isInteger(t / 100000) || Number.isInteger(t / 50000)));
    assert.equal(ticks[0], 0);
    assert.ok(ticks[ticks.length - 1] >= 347912, "domain must cover the max");
  });

  test("covers the full range outward", () => {
    const ticks = niceTicks(3, 47, 5);
    assert.ok(ticks[0] <= 3);
    assert.ok(ticks[ticks.length - 1] >= 47);
  });

  test("a flat series gets one line at its own value, not an invented range", () => {
    assert.deepEqual(niceTicks(500, 500), [500]);
  });

  test("fractional steps do not leak float noise into labels", () => {
    // 0.1-sized steps are where `v += step` accumulation classically produces
    // 0.30000000000000004 as an axis label.
    const ticks = niceTicks(0, 0.5, 5);
    for (const t of ticks) {
      assert.equal(t, Number(t.toFixed(6)), `tick ${t} carries float noise`);
    }
  });

  test("handles a reversed range and non-finite input without throwing", () => {
    assert.deepEqual(niceTicks(10, 0, 2)[0], 0);
    assert.deepEqual(niceTicks(NaN, 5), [0]);
  });

  test("negative ranges keep round steps", () => {
    const ticks = niceTicks(-80, 20, 4);
    assert.ok(ticks.includes(0), "zero must be a gridline when the data crosses it");
  });
});

describe("domainFor", () => {
  test("bars baseline at zero - a floating baseline exaggerates every difference", () => {
    const { min } = domainFor([420, 440, 460]);
    assert.equal(min, 0);
  });

  test("zeroBased:false lets a line chart show movement in a narrow band", () => {
    const { min } = domainFor([420000, 440000, 460000], { zeroBased: false });
    assert.ok(min > 0, "a cash line hovering near ₹4.4L must not be flattened against zero");
  });

  test("negative data extends below zero even when zero-based", () => {
    const { min, max } = domainFor([-500, 200]);
    assert.ok(min <= -500);
    assert.ok(max >= 200);
  });

  test("all-zero data still yields a drawable box", () => {
    const { min, max } = domainFor([0, 0, 0]);
    assert.ok(max > min, "a zero-span domain would divide by zero in every scale");
  });

  test("empty input is safe", () => {
    const d = domainFor([]);
    assert.ok(d.max > d.min);
  });
});

describe("scales", () => {
  test("linearScale inverts for a y-axis (bigger value → smaller y)", () => {
    const y = linearScale([0, 100], [200, 0]);
    assert.equal(y(0), 200);
    assert.equal(y(100), 0);
    assert.equal(y(50), 100);
  });

  test("a zero-span domain does not divide by zero", () => {
    const y = linearScale([5, 5], [0, 100]);
    assert.ok(Number.isFinite(y(5)));
  });

  test("bandScale keeps bars inside the plot and evenly gapped", () => {
    const { band, width, center } = bandScale(4, [0, 400], 0.3);
    assert.ok(band(0) >= 0);
    assert.ok(band(3) + width <= 400.001);
    assert.equal(Math.round(center(0)), 50);
  });

  test("pointScale centres a lone datum instead of pinning it to the left edge", () => {
    assert.equal(pointScale(1, [0, 300])(0), 150);
    const x = pointScale(3, [0, 300]);
    assert.equal(x(0), 0);
    assert.equal(x(2), 300);
  });
});

describe("path builders", () => {
  test("linePath starts with a move and continues with lines", () => {
    const d = linePath([
      { x: 0, y: 10 },
      { x: 5, y: 2 },
    ]);
    assert.match(d, /^M0\.0 10\.0 L5\.0 2\.0$/);
  });

  test("areaPath closes down to the baseline", () => {
    const d = areaPath([{ x: 0, y: 10 }, { x: 5, y: 2 }], 20);
    assert.ok(d.endsWith("Z"), "the fill must be a closed shape");
    assert.ok(d.includes("20.0"), "the baseline must appear in the path");
  });

  test("barPath rounds only the leading corners so a bar sits on its baseline", () => {
    const d = barPath(0, 10, 20, 40, 4, false);
    // Two arcs = two rounded corners (the top pair). Four would lift the bar off the axis.
    assert.equal((d.match(/A/g) ?? []).length, 2);
  });

  test("a zero-height bar draws nothing rather than a floating lozenge", () => {
    assert.equal(barPath(0, 10, 20, 0), "");
  });

  test("radius never exceeds the bar it is rounding", () => {
    // A 2px-tall bar with a 4px radius would otherwise produce an inverted arc.
    const d = barPath(0, 0, 20, 2, 4);
    assert.ok(d.length > 0);
    assert.ok(!d.includes("NaN"));
  });
});

describe("label formatting", () => {
  test("uses the Indian scale, matching every money figure in the app", () => {
    assert.equal(compactNumber(350000), "3.5L");
    assert.equal(compactNumber(12500000), "1.3Cr");
    assert.equal(compactNumber(4200), "4.2k");
    assert.equal(compactNumber(42), "42");
  });

  test("keeps the sign", () => {
    assert.equal(compactNumber(-350000), "-3.5L");
  });

  test("money labels come off minor units", () => {
    assert.equal(compactInrMinor(35000000), "₹3.5L");
  });

  test("tickIndices always anchors both ends", () => {
    const idx = tickIndices(12, 5);
    assert.equal(idx[0], 0);
    assert.equal(idx[idx.length - 1], 11);
    assert.ok(idx.length <= 6);
  });

  test("tickIndices returns every index when they all fit", () => {
    assert.deepEqual(tickIndices(3, 5), [0, 1, 2]);
  });
});

describe("pctChange", () => {
  test("computes an ordinary change", () => {
    assert.equal(pctChange(120, 100), 20);
    assert.equal(pctChange(80, 100), -20);
  });

  test("growth from zero is undefined, not +100% and not infinity", () => {
    // The failure this guards: a card confidently printing "▲ 100.0%" next to a real number.
    assert.equal(pctChange(50, 0), null);
  });

  test("uses the magnitude of the base so a negative base keeps its direction", () => {
    assert.equal(pctChange(-50, -100), 50, "a loss halving is an improvement");
  });
});

describe("rollUpLongTail", () => {
  const other = (value: number, count: number) => ({ label: `Other (${count})`, value });

  test("leaves a short list alone", () => {
    const rows = [{ label: "a", value: 3 }];
    assert.deepEqual(rollUpLongTail(rows, 10, other), rows);
  });

  test("folds the tail into one row, ranked", () => {
    const rows = [
      { label: "a", value: 1 },
      { label: "b", value: 9 },
      { label: "c", value: 5 },
      { label: "d", value: 2 },
    ];
    const out = rollUpLongTail(rows, 2, other);
    assert.deepEqual(out.map((r) => r.label), ["b", "c", "Other (2)"]);
    assert.equal(out[2].value, 3);
  });

  test("never hides a single row behind 'Other'", () => {
    const rows = [
      { label: "a", value: 9 },
      { label: "b", value: 5 },
      { label: "c", value: 1 },
    ];
    const out = rollUpLongTail(rows, 2, other);
    assert.deepEqual(out.map((r) => r.label), ["a", "b", "c"]);
  });
});

describe("splitAtCrossings", () => {
  // Pixel space: SMALLER y is a HIGHER value, so aY <= bY means "A is ahead".
  test("a series that never crosses yields one segment", () => {
    const segs = splitAtCrossings([
      { x: 0, aY: 10, bY: 50 },
      { x: 10, aY: 20, bY: 60 },
    ]);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].ahead, true);
  });

  test("interpolates the crossing rather than flipping at the next point", () => {
    // A goes from ahead (10 vs 50) to behind (60 vs 20); they cross midway-ish, NOT at x=10.
    const segs = splitAtCrossings([
      { x: 0, aY: 10, bY: 50 },
      { x: 10, aY: 60, bY: 20 },
    ]);
    assert.equal(segs.length, 2);
    assert.equal(segs[0].ahead, true);
    assert.equal(segs[1].ahead, false);
    const cross = segs[0].points[segs[0].points.length - 1];
    assert.ok(cross.x > 0 && cross.x < 10, `crossing should be inside the span, got ${cross.x}`);
    // This is the whole point of interpolating: the red wedge must not poke into ahead territory.
    assert.equal(cross.aY, cross.bY, "both series must meet exactly at the crossing");
  });

  test("the two segments share the crossing point, leaving no hairline gap", () => {
    const segs = splitAtCrossings([
      { x: 0, aY: 10, bY: 50 },
      { x: 10, aY: 60, bY: 20 },
    ]);
    const endOfFirst = segs[0].points[segs[0].points.length - 1];
    const startOfSecond = segs[1].points[0];
    assert.deepEqual(endOfFirst, startOfSecond);
  });

  test("touching exactly counts as ahead - on target is met, not missed", () => {
    const segs = splitAtCrossings([
      { x: 0, aY: 30, bY: 30 },
      { x: 10, aY: 30, bY: 30 },
    ]);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].ahead, true);
  });

  test("handles multiple crossings", () => {
    const segs = splitAtCrossings([
      { x: 0, aY: 10, bY: 50 },
      { x: 10, aY: 60, bY: 20 },
      { x: 20, aY: 10, bY: 50 },
    ]);
    assert.deepEqual(segs.map((s) => s.ahead), [true, false, true]);
  });

  test("never emits NaN on a degenerate span", () => {
    const segs = splitAtCrossings([
      { x: 0, aY: 10, bY: 10 },
      { x: 0, aY: 50, bY: 5 },
    ]);
    for (const s of segs) {
      for (const p of s.points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.aY) && Number.isFinite(p.bY));
      }
    }
  });

  test("empty input is safe", () => {
    assert.deepEqual(splitAtCrossings([]), []);
  });
});

describe("bandPath", () => {
  test("closes the polygon between the two series", () => {
    const d = bandPath([
      { x: 0, aY: 10, bY: 50 },
      { x: 10, aY: 20, bY: 60 },
    ]);
    assert.ok(d.startsWith("M0.0 10.0"), "starts along series A");
    assert.ok(d.endsWith("Z"), "must be closed or the fill leaks");
    assert.ok(d.includes("50.0"), "returns along series B");
  });

  test("a single point has no area", () => {
    assert.equal(bandPath([{ x: 0, aY: 1, bY: 2 }]), "");
  });
});

describe("attainmentPct", () => {
  test("normalises different targets onto one comparable scale", () => {
    // The failure it prevents: 25/30 and 25/100 rendering as identical progress bars.
    assert.equal(attainmentPct(25, 30)?.toFixed(1), "83.3");
    assert.equal(attainmentPct(25, 100), 25);
  });

  test("does not cap - overshooting a target is information", () => {
    assert.equal(attainmentPct(42, 30), 140);
  });

  test("null value stays null, so 'nothing measured yet' never reads as zero", () => {
    assert.equal(attainmentPct(null, 30), null);
  });

  test("a zero target is undefined, not infinity", () => {
    assert.equal(attainmentPct(5, 0), null);
  });
});

describe("seriesColor", () => {
  test("is a token reference, never a hex - dark mode depends on it", () => {
    assert.match(seriesColor(0), /^var\(--/);
  });

  test("wraps past the end of the palette, including for negative indices", () => {
    assert.equal(seriesColor(6), seriesColor(0));
    assert.equal(seriesColor(-1), seriesColor(5));
  });
});
