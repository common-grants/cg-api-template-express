/**
 * The application factory.
 *
 * `createApp()` builds the whole API from one dependency, an
 * {@link OpportunityService}, and never opens a socket. Tests drive it in
 * process with supertest; `src/index.ts` is the only file that listens.
 */

import express, { type Express } from "express";
import { createOpportunityRouter } from "./controllers/opportunity.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import type { OpportunityService } from "./services/opportunity.service.js";

/** Where the opportunities router is mounted, per the CommonGrants base API. */
export const OPPORTUNITIES_BASE_PATH = "/common-grants/opportunities";

export interface CreateAppOptions {
  service: OpportunityService;
}

export function createApp({ service }: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: 200, message: "ok" });
  });

  app.use(OPPORTUNITIES_BASE_PATH, createOpportunityRouter(service));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
