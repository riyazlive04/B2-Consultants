import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildStorageKey, publicUrl, storageConfig } from "../supabase-storage";

const NOW = new Date("2026-08-04T10:00:00Z");

describe("buildStorageKey", () => {
  test("date-prefixes and slugifies", () => {
    assert.equal(buildStorageKey("Hero Photo.JPG", "abc123", NOW), "202608/hero-photo-abc123.jpg");
  });

  test("neutralises a traversal attempt in the filename", () => {
    // The filename is attacker-controlled and this string becomes a URL path. Slashes and dots
    // must not survive into it, or an upload could be steered outside its prefix.
    const key = buildStorageKey("../../etc/passwd.png", "r1", NOW);
    assert.ok(!key.includes(".."), key);
    assert.equal(key.split("/").length, 2, `expected exactly one path segment under the date: ${key}`);
    assert.equal(key, "202608/etc-passwd-r1.png");
  });

  test("strips characters that would need URL-encoding", () => {
    const key = buildStorageKey("my photo (1)+final#2.png", "r2", NOW);
    assert.match(key, /^202608\/[a-z0-9-]+-r2\.png$/, key);
  });

  test("a name that slugifies to nothing still yields a key", () => {
    assert.equal(buildStorageKey("###.png", "r3", NOW), "202608/file-r3.png");
  });

  test("an extensionless file gets a placeholder rather than a bare name", () => {
    assert.equal(buildStorageKey("logo", "r4", NOW), "202608/logo-r4.bin");
  });

  test("a very long name is truncated", () => {
    const key = buildStorageKey(`${"a".repeat(300)}.png`, "r5", NOW);
    assert.ok(key.length < 80, `key too long: ${key.length}`);
    assert.ok(key.endsWith("-r5.png"), key);
  });

  test("the random suffix is what separates two uploads of the same name", () => {
    assert.notEqual(
      buildStorageKey("logo.png", "aaa", NOW),
      buildStorageKey("logo.png", "bbb", NOW),
    );
  });

  test("months are zero-padded so keys sort", () => {
    assert.ok(buildStorageKey("a.png", "r", new Date("2026-01-09T00:00:00Z")).startsWith("202601/"));
  });
});

describe("storageConfig", () => {
  const saved = { ...process.env };
  const reset = () => {
    process.env.SUPABASE_URL = saved.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_STORAGE_BUCKET = saved.SUPABASE_STORAGE_BUCKET;
  };

  test("returns null when unconfigured — the fail-closed contract", () => {
    // Callers must be able to answer 503 with a clear message rather than throw. A blank key is
    // the state this ships in.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(storageConfig(), null);

    process.env.SUPABASE_URL = "https://x.supabase.co";
    assert.equal(storageConfig(), null, "a URL without a key must not count as configured");
    reset();
  });

  test("trims a trailing slash so URLs never double up", () => {
    process.env.SUPABASE_URL = "https://x.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.SUPABASE_STORAGE_BUCKET = "site-media";
    const cfg = storageConfig();
    assert.ok(cfg);
    assert.equal(
      publicUrl(cfg, "202608/a-r.png"),
      "https://x.supabase.co/storage/v1/object/public/site-media/202608/a-r.png",
    );
    reset();
  });
});
