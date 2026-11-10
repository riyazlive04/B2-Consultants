import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { forwardToSirahos, type SirahosForwardPayload } from "../sirahos-forward";

const PAYLOAD: SirahosForwardPayload = {
  id: "ctest123",
  ref: "IMP-0042",
  kind: "NOT_WORKING",
  severity: "BLOCKING",
  title: "Save button does nothing",
  description: "I pressed Save and the spinner ran forever.",
  expectedBehaviour: "Should save and close the dialog",
  route: "/students/[id]",
  reporterName: "Sita R",
  reporterRole: "TELECALLER",
};

describe("forwardToSirahos", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.SIRAHOS_URL = "https://api.os.sirahagents.com";
    process.env.SIRAHOS_PROJECT_ID = "proj123";
    process.env.SIRAHOS_SECRET = "sec456";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    mock.restoreAll();
  });

  it("silently skips when PROJECT_ID is unset", async () => {
    delete process.env.SIRAHOS_PROJECT_ID;
    let called = false;
    mock.method(globalThis, "fetch", async () => {
      called = true;
      return new Response(null, { status: 201 });
    });
    await forwardToSirahos(PAYLOAD);
    assert.equal(called, false);
  });

  it("silently skips when SECRET is unset", async () => {
    delete process.env.SIRAHOS_SECRET;
    let called = false;
    mock.method(globalThis, "fetch", async () => {
      called = true;
      return new Response(null, { status: 201 });
    });
    await forwardToSirahos(PAYLOAD);
    assert.equal(called, false);
  });

  it("sends the right shape to the right URL", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ id: "cr1" }), { status: 201 });
    });

    await forwardToSirahos(PAYLOAD);

    assert.equal(capturedUrl, "https://api.os.sirahagents.com/api/change-intake/proj123");
    assert.equal((capturedInit.headers as Record<string, string>)["X-Sirahos-Signature"], "sec456");

    const body = JSON.parse(capturedInit.body as string);
    assert.equal(body.title, "[Bug] Save button does nothing");
    assert.equal(body.reference, "IMP-0042");
    assert.equal(body.source, "b2-consultants");
    assert.ok(body.description.includes("Expected: Should save and close the dialog"));
    assert.ok(body.description.includes("Severity: Blocking"));
    assert.ok(body.description.includes("B2 Consultants report: IMP-0042"));
    assert.ok(body.requestedBy.includes("Sita R"));
  });

  it("never throws on network error", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new Error("DNS resolution failed");
    });
    await assert.doesNotReject(() => forwardToSirahos(PAYLOAD));
  });

  it("never throws on non-2xx", async () => {
    mock.method(globalThis, "fetch", async () => new Response("nope", { status: 500 }));
    await assert.doesNotReject(() => forwardToSirahos(PAYLOAD));
  });
});
