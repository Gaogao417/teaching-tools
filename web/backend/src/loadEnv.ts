import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader. The backend reads configuration from `process.env`; this
 * loads a `.env` file (next to the backend package, i.e. `web/backend/.env`) the
 * same way at dev (`tsx watch`) and start (`node dist/...`) time, so the flags
 * documented in `.env.example` actually take effect. Existing environment
 * variables always win — a shell or process manager overrides the file. No new
 * dependency is introduced.
 *
 * Import this module before anything that reads configuration.
 */
function loadEnv(): void {
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Never overwrite a value already provided by the real environment.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();
