/**
 * The data seam.
 *
 * `createApp()` accepts any {@link OpportunityService}, so connecting a
 * database or an upstream API means writing one class that implements this
 * interface. Nothing HTTP-shaped crosses it: no envelopes, no `req` or `res`,
 * no status codes. The controller owns defaults, pagination metadata and
 * error reporting.
 */

import type { z } from "zod";
import type { OppDefaultFiltersSchema, OppSortByEnum, Opportunity } from "../schemas/index.js";

/** Pagination normalized by the controller: always present, always positive. */
export interface Pagination {
  page: number;
  pageSize: number;
}

/** One page of results plus the total number of matches across all pages. */
export interface Page<T> {
  items: T[];
  totalItems: number;
}

/** The filters this API implements: the protocol's default set. */
export type OpportunityFilters = z.output<typeof OppDefaultFiltersSchema>;

/**
 * A sort key the service can execute. `"custom"` never reaches the service:
 * the controller falls back to the default order and reports it.
 */
export type SortField = Exclude<z.output<typeof OppSortByEnum>, "custom">;

/** A fully resolved sort instruction. The controller supplies both halves. */
export interface SortSpec {
  sortBy: SortField;
  sortOrder: "asc" | "desc";
}

export interface OpportunityService {
  /** Every opportunity, in the requested order. */
  list(sorting: SortSpec, pagination: Pagination): Promise<Page<Opportunity>>;

  /** One opportunity by id, or `null` when no record has that id. */
  get(id: string): Promise<Opportunity | null>;

  /** Opportunities matching every supplied filter, in the requested order. */
  search(
    filters: OpportunityFilters,
    sorting: SortSpec,
    pagination: Pagination
  ): Promise<Page<Opportunity>>;
}
