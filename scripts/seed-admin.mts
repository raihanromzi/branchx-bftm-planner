// Creates or updates the Admin (ADR 0002). There is no sign-up route; rerun this to reset a password.
//
//   npm run admin:seed -- admin@example.com
//
// The password is read from ADMIN_PASSWORD when it is set, otherwise from a hidden prompt. It is never
// taken from the command line, so it cannot end up in shell history or CI logs. Updating an existing
// Admin's password also ends all of their sessions.
import nextEnv from "@next/env";
import postgres from "postgres";
import { isEmail, normalizeEmail } from "../src/server/auth/email.ts";
import { hashPassword } from "../src/server/auth/password.ts";

const PASSWORD_MIN = 8;
// Same limit as the sign-in form (SIGN_IN_PASSWORD_MAX), so the Admin can always sign in with it.
const PASSWORD_MAX = 200;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        } else if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        } else if (char === "\u007f" || char === "\b") {
          value = [...value].slice(0, -1).join("");
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    fail("Set ADMIN_PASSWORD or run this in a terminal to type the password. It is never read from the arguments.");
  }
  const first = await promptHidden("Kata sandi Admin: ");
  const second = await promptHidden("Ulangi kata sandi: ");
  if (first !== second) fail("The two passwords do not match. Nothing was changed.");
  return first;
}

nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
if (args.length !== 1) fail("Usage: npm run admin:seed -- <email>   (password from ADMIN_PASSWORD or a prompt)");
const email = normalizeEmail(args[0]);
if (!isEmail(email)) fail(`Not a valid email address: ${JSON.stringify(args[0])}`);

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set. Add it to .env.local (see .env.example).");

const password = await readPassword();
if ([...password].length < PASSWORD_MIN) fail(`The password must have at least ${PASSWORD_MIN} characters.`);
if ([...password].length > PASSWORD_MAX) fail(`The password must have at most ${PASSWORD_MAX} characters.`);

const passwordHash = await hashPassword(password);
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const created = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; created: boolean }[]>`
      insert into admin (email, password_hash) values (${email}, ${passwordHash})
      on conflict (email) do update set password_hash = excluded.password_hash, updated_at = now()
      returning id, (xmax = 0) as created`;
    // A new password ends every existing session of this Admin.
    if (!row.created) await tx`delete from session where admin_id = ${row.id}`;
    return row.created;
  });
  console.log(created ? `Admin ${email} created.` : `Admin ${email} updated; their sessions were ended.`);
} catch (error) {
  const reason = (error as { code?: string })?.code ?? (error instanceof Error ? error.name : "unknown");
  fail(`Could not save the Admin (${reason}). Run \`npm run db:migrate\` first if the tables are missing.`);
} finally {
  await sql.end();
}
