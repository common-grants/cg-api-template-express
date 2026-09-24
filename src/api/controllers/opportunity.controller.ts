/**
 * The `/common-grants/opportunities` routes.
 *
 * Every request and response schema comes from `@common-grants/sdk/schemas`;
 * the only local additions are the numeric coercion a query string needs and
 * the shared {@link OpportunitySchema}. `src/api/openapi.ts` documents the
 * same schemas exported here, so the document cannot drift from the handlers.
 *
 * The handlers own what the service deliberately does not: defaults,
 * envelopes, pagination metadata, and a full parse of every response.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import {
  FilteredSchema,
  OkSchema,
  OppFiltersSchema,
  OppSortingSchema,
  OpportunitySchema,
  PaginatedBodyParamsSchema,
  PaginatedQueryParamsSchema,
  PaginatedSchema,
  UuidSchema,
} from "../schemas/index.js";
import { ApiError, errorBody } from "../middleware/error.middleware.js";
import { parseRequest } from "../middleware/validation.middleware.js";
import type {
  OpportunityFilters,
  OpportunityService,
  Page,
  Pagination,
  SortSpec,
} from "../services/opportunity.service.js";

// ############################################################################
// Request and response schemas
// ############################################################################

/**
 * Query strings arrive as strings, so they are coerced here and then validated
 * by the SDK's `PaginatedQueryParamsSchema`. No maximum page size: the
 * protocol sets none.
 */
export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
  pageSize: z.coerce.number().int().min(1).optional().meta({ example: 25 }),
});

export const OppIdParamsSchema = z.object({ oppId: UuidSchema });

/**
 * Not `.strict()`: like the SDK's own schemas, unknown keys are stripped, so a
 * client on a newer protocol version is still served. The cost is that a
 * misspelled key (`filter` for `filters`) is ignored rather than rejected.
 */
export const SearchBodySchema = z.object({
  search: z.string().optional(),
  filters: OppFiltersSchema.optional(),
  sorting: OppSortingSchema.optional(),
  pagination: PaginatedBodyParamsSchema.optional(),
});

export const OpportunitiesListSchema = PaginatedSchema(OpportunitySchema);
export const OpportunityDetailSchema = OkSchema(OpportunitySchema);
export const OpportunitiesSearchSchema = FilteredSchema(OpportunitySchema, OppFiltersSchema);

// ############################################################################
// Request normalization
// ############################################################################

/** The list route's order, and the order of a search that asks for none. */
const DEFAULT_SORT: SortSpec = { sortBy: "lastModifiedAt", sortOrder: "desc" };

/** Applies the SDK's pagination defaults and flattens its nullable output. */
function normalizePagination(input: {
  page?: number | null;
  pageSize?: number | null;
}): Pagination {
  const { page, pageSize } = parseRequest(PaginatedQueryParamsSchema, input);
  return { page: page ?? 1, pageSize: pageSize ?? 100 };
}

type Sorting = z.output<typeof OppSortingSchema>;
type SortInfo = z.output<typeof OpportunitiesSearchSchema>["sortInfo"];

/**
 * Resolves a sort request into a {@link SortSpec} plus a truthful `sortInfo`.
 * An explicit `sortBy` defaults to ascending. This API advertises no custom
 * sort keys, so `"custom"` falls back to the default order and says so in
 * `sortInfo.errors`, per ADR-0013.
 */
function resolveSorting(sorting: Sorting | undefined): { spec: SortSpec; info: SortInfo } {
  if (sorting === undefined || sorting.sortBy === "custom") {
    const errors =
      sorting === undefined
        ? undefined
        : [
            `Custom sort keys are not supported by this API${
              sorting.customSortBy ? ` (received "${sorting.customSortBy}")` : ""
            }. Results are sorted by lastModifiedAt descending instead.`,
          ];
    return {
      spec: DEFAULT_SORT,
      info: { ...DEFAULT_SORT, customSortBy: sorting?.customSortBy, errors },
    };
  }

  const spec: SortSpec = { sortBy: sorting.sortBy, sortOrder: sorting.sortOrder ?? "asc" };
  return { spec, info: { ...spec } };
}

type Filters = z.output<typeof OppFiltersSchema>;
type FilterInfo = z.output<typeof OpportunitiesSearchSchema>["filterInfo"];

/**
 * Splits a filter request into the filters this API implements and a report
 * of what it ignored, per ADR-0012. Ignored filters stay out of
 * `filterInfo.filters`, which describes only what was applied.
 */
function resolveFilters(
  filters: Filters | undefined,
  search: string | undefined
): { applied: OpportunityFilters; info: FilterInfo } {
  const { customFilters, ...applied } = filters ?? {};
  const errors = Object.keys(customFilters ?? {}).map(
    name => `Custom filter "${name}" is not supported by this API and was ignored.`
  );
  if (search !== undefined && search !== "") {
    errors.push("Free-text search is not implemented by this API and was ignored.");
  }
  return { applied, info: { filters: applied, errors: errors.length > 0 ? errors : undefined } };
}

/** `pageSize` is the requested size, not the item count on this page. */
function paginationInfo({ totalItems }: Page<unknown>, { page, pageSize }: Pagination) {
  return { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}

/**
 * Parses a complete envelope before sending it. A service that returns data
 * off the published schema becomes a 500 with the Zod issues logged here,
 * never a 200.
 */
function sendParsed<T extends z.ZodType>(res: Response, schema: T, payload: unknown): void {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    console.error("Service returned data that does not match the published schema", {
      issues: parsed.error.issues,
    });
    throw new ApiError(500, "The server could not produce a valid response");
  }
  res.status(200).json(parsed.data);
}

// ############################################################################
// Router
// ############################################################################

export function createOpportunityRouter(service: OpportunityService): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const pagination = normalizePagination(parseRequest(ListQuerySchema, req.query));
    const page = await service.list(DEFAULT_SORT, pagination);

    sendParsed(res, OpportunitiesListSchema, {
      status: 200,
      message: "Opportunities fetched successfully",
      items: page.items,
      paginationInfo: paginationInfo(page, pagination),
    });
  });

  router.get("/:oppId", async (req, res) => {
    const { oppId } = parseRequest(OppIdParamsSchema, req.params);
    const opportunity = await service.get(oppId);

    if (opportunity === null) {
      res.status(404).json(errorBody(404, "Opportunity not found"));
      return;
    }

    sendParsed(res, OpportunityDetailSchema, {
      status: 200,
      message: "Opportunity fetched successfully",
      data: opportunity,
    });
  });

  router.post("/search", async (req, res) => {
    // `express.json()` leaves `req.body` undefined when no body was sent.
    const body = parseRequest(SearchBodySchema, req.body ?? {});
    const pagination = normalizePagination(body.pagination ?? {});
    const { spec, info: sortInfo } = resolveSorting(body.sorting);
    const { applied, info: filterInfo } = resolveFilters(body.filters, body.search);

    const page = await service.search(applied, spec, pagination);

    sendParsed(res, OpportunitiesSearchSchema, {
      status: 200,
      message: "Opportunities searched successfully",
      items: page.items,
      paginationInfo: paginationInfo(page, pagination),
      sortInfo,
      filterInfo,
    });
  });

  return router;
}
