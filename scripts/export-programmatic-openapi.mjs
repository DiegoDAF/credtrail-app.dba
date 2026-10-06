import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { programmaticApiDescription } from "../apps/api-worker/src/programmatic-api/service-description.ts";

const outputPath = resolve(process.argv[2] ?? "docs/openapi/programmatic.openapi.json");
const publicOrigin = process.argv[3] ?? "https://credtrail.org";
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(programmaticApiDescription(publicOrigin), null, 2)}\n`);
process.stdout.write(`Wrote programmatic API description to ${outputPath}\n`);
