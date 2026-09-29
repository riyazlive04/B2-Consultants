import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterResponse, flushAfterResponse, pendingAfterResponse } from "../after-response";

/**
 * The contract this file protects is narrow but load bearing: `afterResponse` is now the thing
 * standing between a person pressing Submit and every WhatsApp send, workflow run and audit write
 * that used to happen while they waited. Two properties have to hold, or the fix trades a slow
 * form for a broken one.
 */
describe("afterResponse - the caller is never made to wait", () => {
  it("returns before the work has run", async () => {
    let ran = false;
    afterResponse("test:ordering", async () => {
      ran = true;
    });

    // The whole point: control is back here with the work still outstanding.
    assert.equal(ran, false, "work ran synchronously - the caller was blocked after all");

    await flushAfterResponse();
    assert.equal(ran, true, "work never ran at all");
  });

  it("runs slow work to completion after the caller has moved on", async () => {
    const order: string[] = [];
    afterResponse("test:slow", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("deferred");
    });
    order.push("responded");

    await flushAfterResponse();
    assert.deepEqual(order, ["responded", "deferred"]);
  });
});

describe("afterResponse - a failure stays contained", () => {
  it("swallows a rejection instead of turning it into an unhandled one", async () => {
    // A rejection escaping here would take the whole Node process down, since by construction
    // nobody is holding this promise. That is strictly worse than the side effect being missed.
    afterResponse("test:throws", async () => {
      throw new Error("WATI is down");
    });

    await assert.doesNotReject(flushAfterResponse());
  });

  it("lets the tasks either side of a failing one still run", async () => {
    const done: string[] = [];
    afterResponse("test:ok-before", async () => void done.push("before"));
    afterResponse("test:boom", async () => {
      throw new Error("boom");
    });
    afterResponse("test:ok-after", async () => void done.push("after"));

    await flushAfterResponse();
    assert.deepEqual(done.sort(), ["after", "before"]);
  });
});

describe("flushAfterResponse - waiting on the queue", () => {
  it("drains work that is queued by other queued work", async () => {
    // A deferred task that defers more (an enrollment scheduling its next step) must not be
    // left half-finished by a flush that only looked at the queue once.
    let inner = false;
    afterResponse("test:outer", async () => {
      afterResponse("test:inner", async () => {
        await new Promise((r) => setTimeout(r, 5));
        inner = true;
      });
    });

    await flushAfterResponse();
    assert.equal(inner, true, "flush returned while nested work was still pending");
    assert.equal(pendingAfterResponse(), 0);
  });
});
