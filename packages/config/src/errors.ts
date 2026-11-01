/**
 * Raised when an application's environment is missing or malformed.
 *
 * The message lists variable *names* and the reason they failed. It never includes the
 * received value, because environment values are secrets and error text ends up in logs,
 * CI output and crash reporters.
 */
export class EnvValidationError extends Error {
  readonly app: string;
  readonly issues: readonly string[];

  constructor(app: string, issues: readonly string[]) {
    super(`Invalid environment for "${app}":\n- ${issues.join("\n- ")}`);
    this.name = "EnvValidationError";
    this.app = app;
    this.issues = issues;
  }
}

/** A public (NEXT_PUBLIC_*) variable that is not on the reviewed allowlist. */
export class PublicEnvViolationError extends Error {
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(
      `Refusing to start: NEXT_PUBLIC_ variables are compiled into the client bundle and must be on the allowlist. Unexpected: ${keys.join(", ")}`,
    );
    this.name = "PublicEnvViolationError";
    this.keys = keys;
  }
}
