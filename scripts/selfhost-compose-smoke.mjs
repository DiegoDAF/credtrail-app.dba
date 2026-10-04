import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const image = process.argv[process.argv.indexOf("--image") + 1];
assert(
  process.argv.includes("--image") && image && !image.startsWith("-"),
  "Usage: node scripts/selfhost-compose-smoke.mjs --image <built-image>",
);
const project = `credtrail-compose-smoke-${randomBytes(5).toString("hex")}`;
const directory = await mkdtemp(join(tmpdir(), "credtrail-compose-smoke-"));
const override = join(directory, "override.yml");
const emptyEnv = join(directory, "empty.env");
const run = promisify(execFile);
const env = { ...process.env };
delete env.JOB_PROCESSOR_TOKEN;
const compose = async (...args) => {
  let result;
  try {
    result = await run(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "--env-file",
        emptyEnv,
        "-f",
        resolve("docker-compose.selfhost.yml"),
        "-f",
        override,
        ...args,
      ],
      { env, timeout: args[0] === "build" ? 600_000 : 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    if (args[0] === "build" && typeof error.stdout === "string") process.stderr.write(error.stdout);
    throw error;
  }
  return result.stdout.trim();
};
const sql = (statement) =>
  compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "credtrail",
    "-d",
    "credtrail",
    "-v",
    "ON_ERROR_STOP=1",
    "-tAc",
    statement,
  );
const poll = async (action, label) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await action()) return;
    await setTimeout(1000);
  }
  throw new Error(`Timed out: ${label}`);
};
const health = () =>
  compose(
    "exec",
    "-T",
    "app",
    "node",
    "-e",
    "fetch('http://127.0.0.1:8787/healthz/dependencies').then(r=>{if(!r.ok)process.exit(1)})",
  );
const objectKey = "smoke/compose-persistence.txt";
const marker = randomBytes(16).toString("hex");
const storage = (command) =>
  compose(
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "/bin/sh",
    "minio-setup",
    "-ec",
    `mc alias set local http://minio:9000 minioadmin minioadmin >/dev/null; ${command}`,
  );
try {
  await writeFile(emptyEnv, "");
  // Keep service commands, dependency order and volumes from the shipped file.
  // Only the already-built app image and host-port isolation differ in this disposable project.
  await writeFile(
    override,
    `services:
  postgres:
    ports: !reset []
  minio:
    ports: !reset []
  app:
    image: ${JSON.stringify(image)}
    ports: !reset []
  migrate:
    image: ${JSON.stringify(image)}
  worker:
    image: ${JSON.stringify(image)}
`,
  );
  await compose("build", "minio", "minio-setup");
  await compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "120");
  await health();
  await sql(`CREATE TABLE compose_smoke_marker (value text NOT NULL);
INSERT INTO compose_smoke_marker VALUES ('${marker}');
INSERT INTO job_queue_messages
(id,tenant_id,job_type,payload_json,idempotency_key,available_at,status,created_at,updated_at)
VALUES ('compose-smoke-job','compose_empty_tenant','process_badge_rule_lifecycle',
json_build_object('scheduledFor','2026-08-17T00:00:00.000Z')::text,'compose-smoke-job',
CURRENT_TIMESTAMP::text,'pending',CURRENT_TIMESTAMP::text,CURRENT_TIMESTAMP::text);`);
  await poll(
    async () =>
      (await sql("SELECT status FROM job_queue_messages WHERE id='compose-smoke-job'")) ===
      "completed",
    "compiled Compose worker processing without JOB_PROCESSOR_TOKEN",
  );
  await storage(`printf %s ${marker} | mc pipe local/credtrail-badges/${objectKey}`);
  await compose("down");
  await compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "120");
  await health();
  assert.equal(await sql("SELECT value FROM compose_smoke_marker"), marker);
  assert.equal(
    await sql("SELECT status FROM job_queue_messages WHERE id='compose-smoke-job'"),
    "completed",
  );
  assert.equal(await storage(`mc cat local/credtrail-badges/${objectKey}`), marker);
  console.log(
    "Reference Compose API/compiled worker start without a queue token; Postgres and object data survive down/up.",
  );
} finally {
  // The random project owns these volumes; no existing install is addressed by this cleanup.
  try {
    await compose("down", "--volumes", "--remove-orphans");
    await run("docker", ["image", "rm", `${project}-minio`, `${project}-minio-setup`]).catch(
      () => undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
