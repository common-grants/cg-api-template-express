import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "../openapi.js";

/**
 * `GET /openapi.json` and Swagger UI at `/docs`. The UI loads the served
 * document by URL, and `swagger-ui-express` serves its bundle from
 * `node_modules`, so no request leaves your server.
 */
export function createDocsRouter(): Router {
  const document = buildOpenApiDocument();
  const router = Router();

  router.get("/openapi.json", (_req, res) => {
    res.json(document);
  });
  router.use("/docs", swaggerUi.serve, swaggerUi.setup(undefined, { swaggerUrl: "/openapi.json" }));

  return router;
}
