import { checkNodeEmail } from "./runtime/node-email-check";

const result = await checkNodeEmail(process.env, process.argv.slice(2));
process.stdout.write(`${result.message}\n`);
process.exitCode = result.exitCode;
