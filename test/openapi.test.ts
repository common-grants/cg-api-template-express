import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { OkSchema, OpportunityBaseSchema, UuidSchema } from "@common-grants/sdk/schemas";
import { createApp } from "../src/api/index.js";
import { stubService } from "./support.js";

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

interface Operation {
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { required?: boolean; content: Record<string, { schema?: unknown }> };
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}
interface Document {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
}

const OPERATIONS: [path: string, method: string, statuses: string[]][] = [
  ["/health", "get", ["200"]],
  ["/common-grants/opportunities", "get", ["200", "400", "500"]],
  ["/common-grants/opportunities/{oppId}", "get", ["200", "400", "404", "500"]],
  ["/common-grants/opportunities/search", "post", ["200", "400", "500"]],
];

describe("the served OpenAPI document", () => {
  let document: Document;

  beforeAll(async () => {
    const res = await request(createApp(stubService())).get("/openapi.json");
    document = res.body as Document;
  });

  it("is OpenAPI 3.1 with an info block", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toBeTruthy();
    expect(document.info.version).toBeTruthy();
  });

  it("documents every API route and nothing else", () => {
    const documented = Object.entries(document.paths)
      .flatMap(([path, ops]) => Object.keys(ops).map(method => `${method} ${path}`))
      .sort();
    const expected = OPERATIONS.map(([path, method]) => `${method} ${path}`).sort();
    expect(documented).toEqual(expected);
  });

  it.each(OPERATIONS)(
    "gives %s %s a JSON schema for each declared status",
    (path, method, statuses) => {
      const operation = document.paths[path]?.[method];
      expect(operation, `${method} ${path} is missing`).toBeDefined();
      expect(Object.keys(operation!.responses).sort()).toEqual([...statuses].sort());

      for (const status of statuses) {
        const schema = operation!.responses[status]?.content?.["application/json"]?.schema;
        expect(schema, `${method} ${path} ${status} has no JSON schema`).toBeTypeOf("object");
        // A bare `{}` would satisfy "has a schema" while documenting nothing.
        expect(Object.keys(schema as object).length).toBeGreaterThan(0);
      }
    }
  );

  it("documents the list route's optional pagination query parameters", () => {
    const parameters = document.paths["/common-grants/opportunities"]?.["get"]?.parameters ?? [];
    expect(parameters.map(p => [p.name, p.in, p.required ?? false])).toEqual([
      ["page", "query", false],
      ["pageSize", "query", false],
    ]);
  });

  it("documents the read route's required oppId path parameter as a UUID", () => {
    const parameters =
      document.paths["/common-grants/opportunities/{oppId}"]?.["get"]?.parameters ?? [];
    expect(parameters).toEqual([
      expect.objectContaining({
        name: "oppId",
        in: "path",
        required: true,
        schema: expect.objectContaining({ type: "string", format: "uuid" }),
      }),
    ]);
  });

  it("documents an optional search body with filters, sorting and pagination", () => {
    const body = document.paths["/common-grants/opportunities/search"]?.["post"]?.requestBody;
    expect(body?.required).toBe(false);
    const schema = body?.content["application/json"]?.schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["filters", "sorting", "pagination"])
    );
  });

  it("describes the opportunity payload rather than an opaque object", () => {
    const schema = document.paths["/common-grants/opportunities"]?.["get"]?.responses["200"]
      ?.content?.["application/json"]?.schema as {
      properties: { items: { items: { properties: Record<string, unknown>; required: string[] } } };
    };
    const item = schema.properties.items.items;
    expect(item.required).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "status",
        "description",
        "createdAt",
        "lastModifiedAt",
      ])
    );
    expect(item.properties["id"]).toMatchObject({ type: "string", format: "uuid" });
    expect(item.properties["lastModifiedAt"]).toMatchObject({
      type: "string",
      format: "date-time",
    });
  });
});
