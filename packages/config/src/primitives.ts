import { z } from "zod";

/** Deployment regions. Keep in sync with docs/architecture.md §6. */
export const REGIONS = [
  "iad",
  "sfo",
  "lhr",
  "fra",
  "bom",
  "sin",
  "syd",
  "gru",
  "jnb",
  "nrt",
] as const;

export type Region = (typeof REGIONS)[number];

export const region = z.enum(REGIONS);

export const nodeEnv = z.enum(["development", "test", "production"]).default("development");

/** A secret that must be long enough to be meaningful and not an obvious placeholder. */
const PLACEHOLDERS = new Set([
  "changeme",
  "change-me",
  "secret",
  "password",
  "test",
  "development",
  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
]);

export function secret(minLength = 32) {
  return z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((value) => !PLACEHOLDERS.has(value.toLowerCase()), {
      message: "is a placeholder value; generate a real secret",
    });
}

export const url = z.string().url();

export const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "must be a postgres:// or postgresql:// connection string",
  });

export const redisUrl = z
  .string()
  .min(1)
  .refine((value) => /^rediss?:\/\//.test(value), {
    message: "must be a redis:// or rediss:// connection string",
  });

export const port = z.coerce.number().int().min(1).max(65_535);

export const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

/**
 * Booleans from env strings with a default. Implemented as optional+transform rather than
 * `.default()`, because Zod returns a default value without running downstream transforms.
 */
export function booleanDefault(defaultValue: boolean) {
  return z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === "true" || value === "1"));
}

export const positiveInt = z.coerce.number().int().positive();

export const csv = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );

/** Parses "10s", "500ms", "2m" into milliseconds. */
export const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h)$/, "must be a duration such as 500ms, 10s, 2m or 1h")
  .transform((value) => {
    const match = /^(\d+)(ms|s|m|h)$/.exec(value);
    if (!match) throw new Error("unreachable: regex validated");
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
    return amount * multiplier;
  });

/**
 * Requires that either all of a group is present or none of it is, so a half-configured
 * provider fails at boot instead of at the first request.
 */
export function requireTogether(keys: readonly string[]) {
  return (env: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const present = keys.filter((key) => env[key] !== undefined && env[key] !== "");
    if (present.length > 0 && present.length < keys.length) {
      for (const key of keys) {
        if (!present.includes(key)) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `must be set because ${present.join(", ")} is set`,
          });
        }
      }
    }
  };
}
