/**
 * The application factory.
 *
 * `createApp()` builds the whole API from one dependency, an
 * {@link OpportunityService}, and never opens a socket. Tests drive it in
 * process with supertest; `src/index.ts` is the only file that listens.
 */

import express, { type Express } from "express";
import { createDocsRouter } from "./controllers/docs.controller.js";
import {
  OPPORTUNITIES_BASE_PATH,
  createOpportunityRouter,
} from "./controllers/opportunity.controller.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { JSON_TYPES } from "./middleware/validation.middleware.js";
import type { OpportunityService } from "./services/opportunity.service.js";

export interface CreateAppOptions {
  service: OpportunityService;
}

export function createApp({ service }: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ type: JSON_TYPES }));

  app.get("/health", (_req, res) => {
    res.json({ status: 200, message: "ok" });
  });

  app.use(OPPORTUNITIES_BASE_PATH, createOpportunityRouter(service));
  app.use(createDocsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
