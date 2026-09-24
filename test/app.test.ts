import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ErrorSchema, SuccessSchema } from "@common-grants/sdk/schemas";
import { createApp } from "../src/api/index.js";
import { stubService } from "./support.js";

function app() {
  return createApp(stubService());
}

describe("createApp", () => {
  it("constructs without side effects", () => {
    // Tests and the OpenAPI export build an app without wanting a listening server.
    expect(() => app()).not.toThrow();
  });

  it("serves a health check that validates against the SDK success schema", async () => {
    const res = await request(app()).get("/health");
    expect(res.status).toBe(200);
    expect(SuccessSchema.safeParse(res.body).success).toBe(true);
  });

  it("serves an OpenAPI 3.1 document", async () => {
    const res = await request(app()).get("/openapi.json");
    expect(res.status).toBe(200);
    expect((res.body as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("serves Swagger UI at /docs, pointed at the served document", async () => {
    const page = await request(app()).get("/docs/");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");

    const init = await request(app()).get("/docs/swagger-ui-init.js");
    expect(init.status).toBe(200);
    expect(init.text).toContain('"/openapi.json"');
  });

  it("serves the Swagger UI bundle itself rather than linking a CDN", async () => {
    const page = await request(app()).get("/docs/");
    expect(page.text).toContain("./swagger-ui-bundle.js");
    expect(page.text).not.toMatch(/src=["']https?:/);

    const bundle = await request(app()).get("/docs/swagger-ui-bundle.js");
    expect(bundle.status).toBe(200);
  });

  it("redirects /docs to /docs/ so the page's relative asset paths resolve", async () => {
    const res = await request(app()).get("/docs");
    expect(res.status).toBe(301);
    expect(res.headers["location"]).toBe("/docs/");
  });

  it("answers an unrouted path with an ErrorSchema-valid 404", async () => {
    const res = await request(app()).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(ErrorSchema.parse(res.body).status).toBe(404);
  });

  it("answers a malformed JSON body with an ErrorSchema-valid 400", async () => {
    const res = await request(app())
      .post("/common-grants/opportunities/search")
      .set("Content-Type", "application/json")
      .send("{ this is not json");
    expect(res.status).toBe(400);
    // Not Express's default HTML error page.
    expect(res.headers["content-type"]).toContain("application/json");
    expect(ErrorSchema.parse(res.body).status).toBe(400);
  });

  it("answers a thrown service failure with an ErrorSchema-valid 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createApp(stubService({ throws: new Error("database is on fire") }));

    const res = await request(failing).get("/common-grants/opportunities");

    expect(res.status).toBe(500);
    expect(ErrorSchema.parse(res.body).status).toBe(500);
    // The underlying failure is logged, never returned.
    expect(JSON.stringify(res.body)).not.toContain("database is on fire");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
