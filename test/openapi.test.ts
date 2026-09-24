import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { OkSchema, OpportunityBaseSchema, UuidSchema } from "@common-grants/sdk/schemas";

// The SDK ships CommonJS, so its schemas are built by a different copy of Zod
// than this ESM project imports. These tests pin what does and does not work
// across that boundary; PORTING.md documents the same caveat.
describe("SDK schemas and zod-to-openapi", () => {
  it("generates a document from SDK schemas used by reference in a route", () => {
    const registry = new OpenAPIRegistry();
    registry.registerPath({
      method: "get",
      path: "/probe",
      responses: {
        200: {
          description: "probe",
          content: { "application/json": { schema: OkSchema(OpportunityBaseSchema) } },
        },
      },
    });

    const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: "3.1.0",
      info: { title: "probe", version: "0" },
    });

    const schema = document.paths?.["/probe"]?.get?.responses?.["200"] as {
      content: { "application/json": { schema: { properties: Record<string, unknown> } } };
    };
    const data = schema.content["application/json"].schema.properties["data"] as {
      properties: Record<string, unknown>;
    };
    expect(data.properties["id"]).toEqual({ type: "string", format: "uuid" });
    expect(data.properties["lastModifiedAt"]).toEqual({ type: "string", format: "date-time" });
  });

  it("cannot call .openapi() on an SDK schema, even after extending this project's zod", () => {
    extendZodWithOpenApi(z);

    expect(() => z.uuid().openapi({ example: "local" })).not.toThrow();
    expect(() => (UuidSchema as unknown as typeof z.ZodType.prototype).openapi({})).toThrow(
      TypeError
    );
  });

  it("cannot name an SDK schema with registry.register(), which calls .openapi()", () => {
    extendZodWithOpenApi(z);
    const registry = new OpenAPIRegistry();

    expect(() => registry.register("Opportunity", OpportunityBaseSchema)).toThrow(TypeError);
  });
});
