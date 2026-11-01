import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads `.env` for CLI scripts without adding a dependency. Node's `loadEnvFile` never
 * overrides variables that are already set, so CI and shell exports win over a local file.
 *
 * Candidates are checked in order: the package directory (how npm workspaces run
 * scripts) and the repository root.
 */
export function loadDotenv(cwd: string = process.cwd()): string | null {
  for (const candidate of [resolve(cwd, ".env"), resolve(cwd, "../../.env")]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return null;
}
