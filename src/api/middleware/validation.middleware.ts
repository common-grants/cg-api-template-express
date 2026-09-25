import type { z } from "zod";
import { ApiError } from "./error.middleware.js";

/** The media types `express.json()` parses, including `+json` types. */
export const JSON_TYPES = ["application/json", "application/*+json"];

/**
 * Parses one part of a request with its schema, or throws an SDK-shaped 400
 * carrying the Zod issues. Handlers call it first thing; Express 5 forwards
 * the throw to the error handler.
 *
 * A parser rather than route middleware: Express 5 makes `req.query`
 * read-only, and stashing results on `res.locals` would lose their types.
 */
export function parseRequest<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, "Invalid request", result.error.issues);
  return result.data;
}
