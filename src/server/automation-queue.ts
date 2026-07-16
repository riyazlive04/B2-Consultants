import "server-only";

import { Queue } from "bullmq";

/**
 * BullMQ/Redis wiring for the Automation engine's WAIT steps (§5 of BUILD_CHECKLIST.md).
 *
 * Why this shape, not a persistent `Worker`:
 * This app has no separate worker process in its actual deployment. `package.json` has no
 * `worker`/`start:worker` script; the Dockerfile's only runtime command is `CMD ["node",
 * "server.js"]` (the Next.js standalone server); `docker-compose.yml` defines exactly three
 * services (`app`, `db`, `redis`) with no fourth worker service. The sibling WhatsApp cron route
 * (`src/app/api/cron/whatsapp/route.ts`) documents this as a deliberate choice: "The app
 * deliberately has no long-running worker — this endpoint IS the scheduler seam." A BullMQ
 * `Worker` is designed to run forever inside a supervised process; spawning one as a side effect
 * of importing this module would mean an unsupervised loop living inside the web server itself
 * (crash blast radius shared with request handling, no restart supervision, uncertain behavior
 * across Next.js's module graph / hot reload in `next dev`) — exactly the kind of "forced,
 * fragile architecture" this workstream was told to avoid.
 *
 * So BullMQ is used here as a durable, precisely-timestamped "due at" store instead of a live
 * consumer: `scheduleWaitJob` enqueues a delayed job when an enrollment parks on WAIT, and
 * `drainDueWaitJobs` — called from `runDueWorkflows()`, which both `/api/cron/workflows` and the
 * admin "Run now" action already invoke — reaps whatever has come due and resumes it through the
 * exact same `advanceEnrollment` path. See automation.ts's `runDueWorkflows` for the call site,
 * and BUILD_CHECKLIST.md §5 / the final report for the honest limitation this implies: this is
 * NOT an in-process fallback that fires on its own if the external cron stops hitting the route.
 * Nothing here can wake itself up without an HTTP request landing on this process. A true
 * cron-independent fallback needs a real persistent worker (a second Docker Compose service /
 * dyno running a small script that `new Worker("workflow-wait", ...)`s against this same queue)
 * — that's an infra change outside this pass's scope, not something safe to half-add here.
 *
 * Postgres (`WorkflowEnrollment.nextRunAt`, polled in `runDueWorkflows`) remains the source of
 * truth and catches every enrollment regardless of Redis health. Every function here is
 * best-effort and swallows its own errors — matching automation.ts's "SAFE BY DESIGN" rule that
 * the engine must never let a scheduling side-channel take down the primary path.
 */

const QUEUE_NAME = "workflow-wait";

type WaitJobData = { enrollmentId: string };

/**
 * Connection options (not a live `ioredis.Redis` instance) parsed from `REDIS_URL`, so BullMQ
 * constructs its own client internally. Deliberate: this repo's top-level `ioredis` (5.11.1) and
 * the `ioredis` bullmq bundles as its own dependency (5.10.1) are two separate installs under
 * `node_modules`, and TypeScript treats their classes as structurally incompatible (private/
 * protected members differ) even though they're runtime-compatible — passing a `new Redis(...)`
 * built from the top-level package into BullMQ's `connection` option fails `tsc`. A plain options
 * object sidesteps that: it's checked structurally, not against either package's class identity.
 */
function connectionOptionsFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ's blocking commands
    lazyConnect: true,
  };
}

let queue: Queue<WaitJobData> | null = null;

function getWorkflowQueue(): Queue<WaitJobData> | null {
  const url = process.env.REDIS_URL;
  if (!url) return null; // not configured — callers fall back to Postgres-only polling
  if (!queue) {
    queue = new Queue<WaitJobData>(QUEUE_NAME, { connection: connectionOptionsFromUrl(url) });
    queue.on("error", (e) => console.error("[automation-queue] redis connection error", e));
  }
  return queue;
}

/** Stable per-(enrollment, step) id so re-adding the same wait (shouldn't normally happen) doesn't duplicate. */
const jobIdFor = (enrollmentId: string, step: number) => `wf-wait-${enrollmentId}-${step}`;

/** Enqueue a delayed job for a WAIT step. Best-effort — `nextRunAt` in Postgres is authoritative. */
export async function scheduleWaitJob(enrollmentId: string, step: number, delayMs: number): Promise<void> {
  try {
    const q = getWorkflowQueue();
    if (!q) return;
    await q.add(
      "resume",
      { enrollmentId },
      {
        jobId: jobIdFor(enrollmentId, step),
        delay: Math.max(0, delayMs),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch (e) {
    console.error("[automation-queue] failed to schedule WAIT job", e);
  }
}

/**
 * Reap every delayed job whose time has come and resume it via `resume`. There is no persistent
 * `Worker` consuming this queue — see the module doc above — so due jobs only get processed when
 * something calls this function. Currently that's `runDueWorkflows()`, i.e. whenever the external
 * cron hits `/api/cron/workflows` or an admin clicks "Run now". Safe to call at any frequency:
 * `resume` (== `advanceEnrollment`) always re-reads the enrollment's current state from Postgres,
 * so a job that's already been resumed via the Postgres poll is a harmless no-op here.
 */
export async function drainDueWaitJobs(resume: (enrollmentId: string) => Promise<void>): Promise<number> {
  try {
    const q = getWorkflowQueue();
    if (!q) return 0;
    const delayed = await q.getJobs(["delayed"], 0, 500);
    const now = Date.now();
    let count = 0;
    for (const job of delayed) {
      const dueAt = job.timestamp + (job.delay ?? 0);
      if (dueAt > now) continue;
      try {
        await resume(job.data.enrollmentId);
      } catch (e) {
        console.error("[automation-queue] resume failed for drained job", job.id, e);
      } finally {
        await job.remove().catch(() => {});
      }
      count++;
    }
    return count;
  } catch (e) {
    console.error("[automation-queue] failed to drain WAIT jobs", e);
    return 0;
  }
}
