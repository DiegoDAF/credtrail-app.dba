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
const network = `${project}-net`;
const s3Container = `${project}-s3`;
const s3Image = `${project}-s3-image`;
const directory = await mkdtemp(join(tmpdir(), "credtrail-compose-smoke-"));
const override = join(directory, "override.yml");
const emptyEnv = join(directory, "empty.env");
const run = promisify(execFile);
// Always use disposable credentials and storage, even when the host has cloud credentials.
const env = {
  ...process.env,
  S3_ENDPOINT: "http://s3:9000",
  S3_BUCKET: "credtrail-badges",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  AWS_ACCESS_KEY_ID: "disposable",
  AWS_SECRET_ACCESS_KEY: "disposable",
  AWS_SESSION_TOKEN: "",
};
delete env.JOB_PROCESSOR_TOKEN;
const docker = async (...args) =>
  (await run("docker", args, { timeout: 600_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const composeWithEnv = async (environment, ...args) => {
  const result = await run(
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
    { env: environment, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return result.stdout.trim();
};
const compose = (...args) => composeWithEnv(env, ...args);
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
    "exec",
    "-T",
    "app",
    "node",
    "--input-type=module",
    "-e",
    `import {S3Client, PutObjectCommand, GetObjectCommand} from '@aws-sdk/client-s3';
const client = new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,
forcePathStyle:process.env.S3_FORCE_PATH_STYLE === 'true',credentials:{
accessKeyId:process.env.AWS_ACCESS_KEY_ID,secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY}});
const object = {Bucket:process.env.S3_BUCKET,Key:${JSON.stringify(objectKey)}};
try { ${command} } finally { client.destroy(); }`,
  );
try {
  await writeFile(emptyEnv, "");
  // Keep service commands, dependency order and volumes from the shipped file.
  // Supply an isolated network so test storage can stay outside the Compose lifecycle.
  await writeFile(
    override,
    `services:
  postgres:
    ports: !reset []
  app:
    image: ${JSON.stringify(image)}
    ports: !reset []
  migrate:
    image: ${JSON.stringify(image)}
  worker:
    image: ${JSON.stringify(image)}
networks:
  default:
    external: true
    name: ${network}
`,
  );
  // Check how Compose interpolates both cloud providers without making network requests.
  const awsConfig = JSON.parse(
    await composeWithEnv(
      {
        ...env,
        S3_ENDPOINT: "",
        S3_FORCE_PATH_STYLE: "",
        AWS_SESSION_TOKEN: "disposable-session-token",
      },
      "config",
      "--format",
      "json",
    ),
  );
  assert.deepEqual(Object.keys(awsConfig.services).sort(), [
    "app",
    "migrate",
    "postgres",
    "worker",
  ]);
  for (const service of ["app", "worker"]) {
    assert.equal(awsConfig.services[service].environment.S3_ENDPOINT, "");
    assert.equal(awsConfig.services[service].environment.S3_FORCE_PATH_STYLE, "false");
    assert.equal(
      awsConfig.services[service].environment.AWS_SESSION_TOKEN,
      "disposable-session-token",
    );
  }
  const r2Endpoint = "https://example-account.r2.cloudflarestorage.com";
  const r2Config = JSON.parse(
    await composeWithEnv(
      { ...env, S3_REGION: "auto", S3_ENDPOINT: r2Endpoint, S3_FORCE_PATH_STYLE: "false" },
      "config",
      "--format",
      "json",
    ),
  );
  for (const service of ["app", "worker"]) {
    assert.equal(r2Config.services[service].environment.S3_REGION, "auto");
    assert.equal(r2Config.services[service].environment.S3_ENDPOINT, r2Endpoint);
  }
  for (const name of ["S3_BUCKET", "S3_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
    await assert.rejects(
      composeWithEnv({ ...env, [name]: "" }, "config", "--quiet"),
      (error) => typeof error.stderr === "string" && error.stderr.includes(name),
    );
  }
  await docker("network", "create", network);
  // This emulator belongs only to the test; the shipped Compose file uses external S3/R2.
  await docker("build", "-f", "Dockerfile.gofakes3", "-t", s3Image, ".");
  await docker(
    "run",
    "--detach",
    "--name",
    s3Container,
    "--network",
    network,
    "--network-alias",
    "s3",
    s3Image,
  );
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
  await storage(
    `await client.send(new PutObjectCommand({...object,Body:${JSON.stringify(marker)}}));`,
  );
  await compose("down");
  await compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "120");
  await health();
  assert.equal(await sql("SELECT value FROM compose_smoke_marker"), marker);
  assert.equal(
    await sql("SELECT status FROM job_queue_messages WHERE id='compose-smoke-job'"),
    "completed",
  );
  assert.equal(
    await storage(`const result = await client.send(new GetObjectCommand(object));
console.log(await result.Body.transformToString());`),
    marker,
  );
  console.log(
    "Reference Compose API/compiled worker start with external S3 and no queue token; Postgres and external objects survive down/up.",
  );
} finally {
  // The random project owns these volumes; no existing install is addressed by this cleanup.
  try {
    await compose("down", "--volumes", "--remove-orphans");
  } finally {
    await docker("rm", "--force", s3Container).catch(() => undefined);
    await docker("network", "rm", network).catch(() => undefined);
    await docker("image", "rm", s3Image).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}
