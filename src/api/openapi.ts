/**
 * The OpenAPI 3.1 document, generated from the same schemas the handlers use.
 *
 * SDK schemas are passed by reference and inlined. They cannot be named with
 * `registry.register()` or `.openapi()`, both of which throw on them; see the
 * `.openapi()` caveat in PORTING.md.
 */

import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { ErrorSchema, NotFoundSchema, SuccessSchema } from "./schemas/index.js";
import type { z } from "zod";
import {
  ListQuerySchema,
  OPPORTUNITIES_BASE_PATH,
  OppIdParamsSchema,
  OpportunitiesListSchema,
  OpportunitiesSearchSchema,
  OpportunityDetailSchema,
  SearchBodySchema,
} from "./controllers/opportunity.controller.js";

const json = (description: string, schema: z.ZodType) => ({
  description,
  content: { "application/json": { schema } },
});

const ERROR_RESPONSES = {
  400: json("The request did not match the schema", ErrorSchema),
  500: json("The server could not produce a valid response", ErrorSchema),
};

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["Operations"],
    summary: "Health check",
    description: "Returns 200 while the service is able to handle requests.",
    responses: { 200: json("The service is healthy", SuccessSchema) },
  });

  registry.registerPath({
    method: "get",
    path: OPPORTUNITIES_BASE_PATH,
    tags: ["Opportunities"],
    summary: "List opportunities",
    description:
      "Get a paginated list of opportunities, sorted by `lastModifiedAt` with most recent first.",
    request: { query: ListQuerySchema },
    responses: {
      200: json("A paginated list of opportunities", OpportunitiesListSchema),
      ...ERROR_RESPONSES,
    },
  });

  registry.registerPath({
    method: "get",
    path: `${OPPORTUNITIES_BASE_PATH}/{oppId}`,
    tags: ["Opportunities"],
    summary: "View opportunity details",
    description: "View details about an opportunity.",
    request: { params: OppIdParamsSchema },
    responses: {
      200: json("The requested opportunity", OpportunityDetailSchema),
      404: json("No opportunity has that id", NotFoundSchema),
      ...ERROR_RESPONSES,
    },
  });

  registry.registerPath({
    method: "post",
    path: `${OPPORTUNITIES_BASE_PATH}/search`,
    tags: ["Opportunities"],
    summary: "Search opportunities",
    description: "Search for opportunities based on the provided filters.",
    request: {
      body: { content: { "application/json": { schema: SearchBodySchema } }, required: false },
    },
    responses: {
      200: json("A filtered, sorted, paginated list of opportunities", OpportunitiesSearchSchema),
      ...ERROR_RESPONSES,
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    // Retitle this for your API.
    info: {
      title: "CommonGrants API",
      version: "0.1.0",
      description:
        "A CommonGrants API generated from the Express template. " +
        "Requests and responses are validated with the published CommonGrants TypeScript SDK schemas.",
    },
    tags: [
      { name: "Opportunities", description: "Endpoints related to funding opportunities" },
      { name: "Operations", description: "Endpoints for operating the service" },
    ],
  });
}
