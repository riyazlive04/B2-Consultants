import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  stageFor,
  channelFor,
  daysPastDue,
  dunningCopy,
  DUNNING_STAGES,
  type DunningStage,
} from "../dunning-ladder";
import { DEFAULT_DUNNING_CONFIG, type DunningConfig } from "../config-schema";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DUE = d("2026-08-10");

/** Defaults: UPCOMING at -3, MISSED at +1, FINAL at +7. */
const cfg = DEFAULT_DUNNING_CONFIG;

function at(dayOffset: number, sent: DunningStage[] = [], config: DunningConfig = cfg) {
  return stageFor(
    { dueDate: DUE, today: new Date(DUE.getTime() + dayOffset * 86_400_000), sent },
    config,
  );
}

describe("days past due", () => {
  test("is negative before the due date and zero on it", () => {
    assert.equal(daysPastDue(DUE, d("2026-08-07")), -3);
    assert.equal(daysPastDue(DUE, DUE), 0);
    assert.equal(daysPastDue(DUE, d("2026-08-17")), 7);
  });

  test("ignores the time of day", () => {
    assert.equal(daysPastDue(DUE, new Date("2026-08-10T23:59:00.000Z")), 0);
  });
});

describe("which rung fires", () => {
  test("nothing before the first offset", () => {
    assert.equal(at(-10), null);
    assert.equal(at(-4), null);
  });

  test("UPCOMING from three days before", () => {
    assert.equal(at(-3), "UPCOMING");
    assert.equal(at(-2), "UPCOMING");
    assert.equal(at(0), "UPCOMING", "on the due date itself, MISSED hasn't been reached yet");
  });

  test("MISSED from one day after", () => {
    assert.equal(at(1, ["UPCOMING"]), "MISSED");
    assert.equal(at(5, ["UPCOMING"]), "MISSED");
  });

  test("FINAL from seven days after", () => {
    assert.equal(at(7, ["UPCOMING", "MISSED"]), "FINAL");
    assert.equal(at(30, ["UPCOMING", "MISSED"]), "FINAL");
  });

  test("a stage never fires twice", () => {
    assert.equal(at(-1, ["UPCOMING"]), null);
    assert.equal(at(3, ["UPCOMING", "MISSED"]), null);
    assert.equal(at(60, ["UPCOMING", "MISSED", "FINAL"]), null);
  });
});

describe("non-skipping - the thing that makes this feel human", () => {
  /**
   * THE FAILURE MODE THIS PREVENTS. On the first armed run the engine meets a backlog of
   * instalments that are already weeks overdue. Every offset is satisfied for all of them. A
   * naive implementation sends all three rungs at once, and the student receives "just a
   * reminder, due in three days", "you missed it" and "final notice" within the same minute -
   * which tells them immediately that they are talking to a broken machine.
   */
  test("an instalment first seen ten days overdue gets ONLY the final notice", () => {
    assert.equal(at(10, []), "FINAL");
  });

  test("and the skipped rungs are dead, not queued", () => {
    // Having sent FINAL, the engine must never circle back for UPCOMING or MISSED. A rung whose
    // moment has passed has nothing left to say.
    assert.equal(at(11, ["FINAL"]), null);
    assert.equal(at(40, ["FINAL"]), null);
  });

  test("an instalment first seen three days overdue gets MISSED, not UPCOMING", () => {
    assert.equal(at(3, []), "MISSED");
    assert.equal(at(4, ["MISSED"]), null, "UPCOMING is not retried afterwards");
  });

  test("only ever one stage per run", () => {
    // Walking every day of the ladder from -10 to +30 must produce at most one send per day and
    // never more than three in total.
    const sent: DunningStage[] = [];
    for (let day = -10; day <= 30; day++) {
      const stage = at(day, [...sent]);
      if (stage) sent.push(stage);
    }
    assert.deepEqual(sent, ["UPCOMING", "MISSED", "FINAL"]);
  });
});

describe("disabled stages", () => {
  test("a disabled rung is skipped and does not block the ones after it", () => {
    const noUpcoming: DunningConfig = {
      ...cfg,
      stages: { ...cfg.stages, upcoming: { ...cfg.stages.upcoming, enabled: false } },
    };
    assert.equal(at(-3, [], noUpcoming), null);
    assert.equal(at(1, [], noUpcoming), "MISSED");
  });

  test("with every rung disabled nothing ever fires", () => {
    const off: DunningConfig = {
      ...cfg,
      stages: {
        upcoming: { ...cfg.stages.upcoming, enabled: false },
        missed: { ...cfg.stages.missed, enabled: false },
        final: { ...cfg.stages.final, enabled: false },
      },
    };
    for (let day = -10; day <= 30; day++) assert.equal(at(day, [], off), null);
  });
});

describe("configurable offsets", () => {
  test("moving an offset moves the rung", () => {
    const patient: DunningConfig = {
      ...cfg,
      stages: {
        upcoming: { enabled: true, dayOffset: -7, channel: "EMAIL" },
        missed: { enabled: true, dayOffset: 5, channel: "EMAIL" },
        final: { enabled: true, dayOffset: 21, channel: "EMAIL" },
      },
    };
    assert.equal(at(-7, [], patient), "UPCOMING");
    assert.equal(at(-6, [], patient), "UPCOMING");
    assert.equal(at(1, ["UPCOMING"], patient), null, "MISSED isn't due until +5");
    assert.equal(at(5, ["UPCOMING"], patient), "MISSED");
    assert.equal(at(21, ["UPCOMING", "MISSED"], patient), "FINAL");
  });

  test("channels are read per stage", () => {
    const mixed: DunningConfig = {
      ...cfg,
      stages: {
        upcoming: { enabled: true, dayOffset: -3, channel: "EMAIL" },
        missed: { enabled: true, dayOffset: 1, channel: "WHATSAPP" },
        final: { enabled: true, dayOffset: 7, channel: "BOTH" },
      },
    };
    assert.equal(channelFor("UPCOMING", mixed), "EMAIL");
    assert.equal(channelFor("MISSED", mixed), "WHATSAPP");
    assert.equal(channelFor("FINAL", mixed), "BOTH");
  });
});

describe("the copy", () => {
  const base = {
    firstName: "Priya",
    amountLabel: "₹25,000",
    dueDateLabel: "10 Aug 2026",
    daysPastDue: 0,
    studentCode: "B2-0042",
  };

  test("every rung states the amount and the date", () => {
    for (const stage of DUNNING_STAGES) {
      const copy = dunningCopy({ ...base, stage });
      const body = copy.lines.join(" ");
      assert.ok(body.includes("₹25,000"), `${stage} must state the amount`);
      assert.ok(body.includes("10 Aug 2026"), `${stage} must state the due date`);
      assert.ok(copy.subject.includes("₹25,000"), `${stage} subject must state the amount`);
    }
  });

  test("every rung offers a way out if the record is wrong", () => {
    // Without this, an automated chase becomes an accusation whenever the ledger is behind.
    for (const stage of DUNNING_STAGES) {
      assert.match(dunningCopy({ ...base, stage }).lines.join(" "), /already paid/i);
    }
  });

  test("the tone escalates rather than repeating", () => {
    const upcoming = dunningCopy({ ...base, stage: "UPCOMING" }).lines.join(" ");
    const missed = dunningCopy({ ...base, stage: "MISSED" }).lines.join(" ");
    const final = dunningCopy({ ...base, stage: "FINAL" }).lines.join(" ");

    assert.match(upcoming, /heads-up/i);
    assert.doesNotMatch(upcoming, /outstanding|final|haven't received/i,
      "stage one must not imply anything is wrong yet");

    assert.match(missed, /haven't received/i);
    assert.doesNotMatch(missed, /final notice/i);

    assert.match(final, /final|last automatic/i);
  });

  test("the three rungs are genuinely different messages", () => {
    const bodies = DUNNING_STAGES.map((stage) => dunningCopy({ ...base, stage }).lines.join(" "));
    assert.equal(new Set(bodies).size, 3);
    const subjects = DUNNING_STAGES.map((stage) => dunningCopy({ ...base, stage }).subject);
    assert.equal(new Set(subjects).size, 3);
  });
});
