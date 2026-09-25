import type { ErrorRequestHandler, RequestHandler } from "express";
import type { z } from "zod";
import type { ErrorSchema } from "../schemas/index.js";

/**
 * Every non-2xx body this API sends. Error bodies carry only literals and Zod
 * issues, never service output, so the type plus the `ErrorSchema.parse`
 * assertions in the tests are the check.
 */
export type ErrorBody = z.output<typeof ErrorSchema>;

export function errorBody(status: number, message: string, errors: unknown[] = []): ErrorBody {
  return { status, message, errors };
}

/** An error the handlers throw on purpose; the error handler sends it as-is. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors: unknown[] = []
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Express's own 4xx errors: a body that is not valid JSON, which `http-errors`
 * marks `expose`, and a path that is not valid percent-encoding, a `URIError`
 * the router gives a 400. A service error that merely carries a `status`, as
 * HTTP-client errors often do, is a 500.
 */
function isClientHttpError(err: unknown): err is { status: number; message: string } {
  if (typeof err !== "object" || err === null) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  const fromExpress = expose === true || err instanceof URIError;
  return fromExpress && typeof status === "number" && status >= 400 && status < 500;
}

/** Unrouted paths get a body a CommonGrants client can parse. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody(404, "Not found"));
};

/** Shapes every failure as an SDK `ErrorSchema` body. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(errorBody(err.statusCode, err.message, err.errors));
    return;
  }
  if (isClientHttpError(err)) {
    res.status(err.status).json(errorBody(err.status, err.message));
    return;
  }
  console.error("Unhandled error while serving a request", err);
  res.status(500).json(errorBody(500, "Internal server error"));
};
