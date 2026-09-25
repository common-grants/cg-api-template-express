/**
 * Test doubles.
 *
 * The route tests never mention a bundled fixture id or count, so they keep
 * working after an adopter replaces the fixture service with their own.
 */

import { OpportunitySchema, type Opportunity } from "../src/api/schemas/index.js";
import type { OpportunityService, Page } from "../src/api/services/opportunity.service.js";

let seq = 0;

/** Builds a valid opportunity with an overridable, deterministic shape. */
export function anOpportunity(overrides: Record<string, unknown> = {}): Opportunity {
  seq += 1;
  const n = String(seq).padStart(12, "0");
  return OpportunitySchema.parse({
    id: `00000000-0000-4000-8000-${n}`,
    title: `Opportunity ${seq}`,
    description: `Description ${seq}`,
    status: { value: "open" },
    funding: { maxAwardAmount: { amount: "1000.00", currency: "USD" } },
    keyDates: {
      closeDate: { name: "Application deadline", eventType: "singleDate", date: "2026-05-01" },
    },
    createdAt: "2026-01-01T00:00:00Z",
    lastModifiedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  });
}

/**
 * An opportunity that satisfies the TypeScript type but not the schema. `id`
 * is typed `string`, so a non-UUID compiles cleanly; the controller must
 * still refuse to send it.
 */
export function aMalformedOpportunity(): Opportunity {
  return { ...anOpportunity(), id: "not-a-uuid" };
}

export interface StubCalls {
  list: unknown[];
  get: unknown[];
  search: unknown[];
}

export interface StubResponses {
  list?: Page<Opportunity>;
  get?: Opportunity | null;
  search?: Page<Opportunity>;
  throws?: Error;
}

/** A service that answers with canned values and records how it was called. */
export function stubService(responses: StubResponses = {}): {
  service: OpportunityService;
  calls: StubCalls;
} {
  const calls: StubCalls = { list: [], get: [], search: [] };

  const answer = <T>(value: T): T => {
    if (responses.throws) throw responses.throws;
    return value;
  };

  const service: OpportunityService = {
    async list(sorting, pagination) {
      calls.list.push({ sorting, pagination });
      return answer(responses.list ?? emptyPage());
    },
    async get(id) {
      calls.get.push(id);
      return answer(responses.get ?? null);
    },
    async search(filters, sorting, pagination) {
      calls.search.push({ filters, sorting, pagination });
      return answer(responses.search ?? emptyPage());
    },
  };

  return { service, calls };
}

export function emptyPage(): Page<Opportunity> {
  return { items: [], totalItems: 0 };
}

export function pageOf(items: Opportunity[], totalItems = items.length): Page<Opportunity> {
  return { items, totalItems };
}
