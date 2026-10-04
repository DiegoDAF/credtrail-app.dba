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
const prefix = `credtrail-compose-smoke-${randomBytes(5).toString("hex")}`;
const network = `${prefix}-net`;
const databaseContainer = `${prefix}-database`;
const s3Container = `${prefix}-s3`;
const s3Image = `${prefix}-s3-image`;
const directory = await mkdtemp(join(tmpdir(), "credtrail-compose-smoke-"));
const emptyEnv = join(directory, "empty.env");
const run = promisify(execFile);
// Override host credentials and Compose selection: this check never uses a real cloud account.
const env = {
  ...process.env,
  COMPOSE_PROFILES: "",
  DATABASE_URL:
    "postgres://credtrail:credtrail@external-postgres:5432/credtrail?sslmode=verify-full&sslrootcert=/run/credtrail/database-certs/server.crt",
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
const composeWithEnv = async (project, files, environment, ...args) =>
  (
    await run(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "--env-file",
        emptyEnv,
        ...files.flatMap((file) => ["-f", file]),
        ...args,
      ],
      { env: environment, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout.trim();
const poll = async (action, label) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await action()) return;
    await setTimeout(1000);
  }
  throw new Error(`Timed out: ${label}`);
};
const sqlArgs = (statement) => [
  "psql",
  "-U",
  "credtrail",
  "-d",
  "credtrail",
  "-v",
  "ON_ERROR_STOP=1",
  "-tAc",
  statement,
];

const checkCloudConfig = async (files) => {
  const config = async (values) =>
    JSON.parse(await composeWithEnv(prefix, files, values, "config", "--format", "json"));
  const awsConfig = await config({
    ...env,
    S3_ENDPOINT: "",
    S3_FORCE_PATH_STYLE: "",
    AWS_SESSION_TOKEN: "disposable-session-token",
  });
  assert.deepEqual(Object.keys(awsConfig.services).sort(), ["app", "migrate", "worker"]);
  assert.equal(Object.keys(awsConfig.volumes ?? {}).length, 0);
  for (const service of ["app", "migrate", "worker"]) {
    assert.equal(awsConfig.services[service].environment.DATABASE_URL, env.DATABASE_URL);
  }
  for (const service of ["app", "worker"]) {
    assert.equal(awsConfig.services[service].environment.S3_ENDPOINT, "");
    assert.equal(awsConfig.services[service].environment.S3_FORCE_PATH_STYLE, "false");
    assert.equal(
      awsConfig.services[service].environment.AWS_SESSION_TOKEN,
      "disposable-session-token",
    );
  }
  const r2Endpoint = "https://example-account.r2.cloudflarestorage.com";
  const r2Config = await config({
    ...env,
    S3_REGION: "auto",
    S3_ENDPOINT: r2Endpoint,
    S3_FORCE_PATH_STYLE: "false",
  });
  for (const service of ["app", "worker"]) {
    assert.equal(r2Config.services[service].environment.S3_REGION, "auto");
    assert.equal(r2Config.services[service].environment.S3_ENDPOINT, r2Endpoint);
  }
  for (const name of [
    "DATABASE_URL",
    "S3_BUCKET",
    "S3_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]) {
    await assert.rejects(
      composeWithEnv(prefix, files, { ...env, [name]: "" }, "config", "--quiet"),
      (error) => typeof error.stderr === "string" && error.stderr.includes(name),
    );
  }
};

const checkDatabaseScenario = async (local) => {
  const project = `${prefix}-${local ? "local" : "external"}`;
  const override = join(directory, `${local ? "local" : "external"}.yml`);
  const environment = {
    ...env,
    DATABASE_URL: local
      ? "postgres://credtrail:credtrail@postgres:5432/credtrail"
      : env.DATABASE_URL,
  };
  const files = [
    resolve("docker-compose.selfhost.yml"),
    ...(local ? [resolve("docker-compose.selfhost-postgres.yml")] : []),
    override,
  ];
  const compose = (...args) => composeWithEnv(project, files, environment, ...args);
  const sql = (statement) =>
    local
      ? compose("exec", "-T", "postgres", ...sqlArgs(statement))
      : docker("exec", databaseContainer, ...sqlArgs(statement));
  const health = () =>
    compose(
      "exec",
      "-T",
      "app",
      "node",
      "-e",
      "fetch('http://127.0.0.1:8787/healthz/dependencies').then(r=>{if(!r.ok)process.exit(1)})",
    );
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
const object = {Bucket:process.env.S3_BUCKET,Key:'smoke/compose-persistence.txt'};
try { ${command} } finally { client.destroy(); }`,
    );
  const marker = randomBytes(16).toString("hex");
  // Keep shipped commands, dependency ordering and persistence. Override only the built image,
  // host-port isolation, test network and read-only certificate mount for the external database.
  const certificates = local
    ? ""
    : `
    volumes:
      - ${JSON.stringify(`${directory}:/run/credtrail/database-certs:ro`)}`;
  await writeFile(
    override,
    `services:
  app:
    image: ${JSON.stringify(image)}
    ports: !reset []${certificates}
  migrate:
    image: ${JSON.stringify(image)}${certificates}
  worker:
    image: ${JSON.stringify(image)}${certificates}
networks:
  default:
    external: true
    name: ${network}
`,
  );
  if (!local) await checkCloudConfig(files);
  try {
    await compose("up", "--detach", "--no-build", "--wait", "--wait-timeout", "120");
    await health();
    if (!local) {
      // The default stack must not create a Postgres container or database volume.
      assert.deepEqual(
        JSON.parse(await compose("config", "--format", "json")).services.postgres,
        undefined,
      );
      assert.equal(
        await docker(
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ),
        "",
      );
      // Both long-running processes must really connect over TLS, not just interpolate the URL.
      await poll(
        async () =>
          Number(
            await sql(`SELECT count(*) FROM pg_stat_ssl s
JOIN pg_stat_activity a USING (pid) WHERE a.usename='credtrail' AND s.ssl`),
          ) >= 2,
        "API and worker database TLS connections",
      );
      // A mismatched host must fail even when the certificate issuer is trusted.
      const wrongHost = environment.DATABASE_URL.replace("external-postgres", "wrong-postgres");
      await assert.rejects(
        compose(
          "exec",
          "-T",
          "app",
          "node",
          "--input-type=module",
          "-e",
          `import {createRequire} from 'node:module';
const pg = createRequire('/app/node_modules/@credtrail/db/package.json')('pg');
const client = new pg.Client({connectionString:${JSON.stringify(wrongHost)}});
try { await client.connect(); } finally { await client.end(); }`,
        ),
        (error) =>
          typeof error.stderr === "string" && error.stderr.includes("ERR_TLS_CERT_ALTNAME_INVALID"),
      );
    }
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
      `Reference Compose ${local ? "local Postgres" : "external Postgres with verified TLS"}: startup, worker processing and down/up retention passed.`,
    );
  } finally {
    // This unique project owns any local database volume.
    await compose("down", "--volumes", "--remove-orphans");
  }
};

try {
  await writeFile(emptyEnv, "");
  await docker("network", "create", network);
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    join(directory, "server.key"),
    "-out",
    join(directory, "server.crt"),
    "-subj",
    "/CN=external-postgres",
    "-addext",
    "subjectAltName=DNS:external-postgres",
  ]);
  // Keep external test data outside the Compose project, like a managed database.
  await docker(
    "run",
    "--detach",
    "--name",
    databaseContainer,
    "--network",
    network,
    "--network-alias",
    "external-postgres",
    "--network-alias",
    "wrong-postgres",
    "--env",
    "POSTGRES_USER=credtrail",
    "--env",
    "POSTGRES_PASSWORD=credtrail",
    "--env",
    "POSTGRES_DB=credtrail",
    "--volume",
    `${directory}:/test-tls:ro`,
    "postgres:17-alpine",
    "/bin/sh",
    "-ec",
    "cp /test-tls/server.key /tmp/server.key; cp /test-tls/server.crt /tmp/server.crt; chown postgres /tmp/server.key /tmp/server.crt; chmod 600 /tmp/server.key; exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key",
  );
  await poll(async () => {
    try {
      return (
        await docker("exec", databaseContainer, "pg_isready", "-h", "127.0.0.1", "-U", "credtrail")
      ).includes("accepting connections");
    } catch {
      return false;
    }
  }, "external test Postgres readiness");
  // The S3 emulator belongs only to this check, outside the shipped Compose stack.
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
  await checkDatabaseScenario(false);
  await checkDatabaseScenario(true);
} finally {
  await docker("rm", "--force", "--volumes", databaseContainer).catch(() => undefined);
  await docker("rm", "--force", s3Container).catch(() => undefined);
  await docker("network", "rm", network).catch(() => undefined);
  await docker("image", "rm", s3Image).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
