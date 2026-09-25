/**
 * An in-memory {@link OpportunityService} over the bundled JSON fixtures.
 *
 * This is the reference implementation of the data seam: it shows what real
 * filtering, sorting and paging have to do. Replace it with your own class
 * (see PORTING.md); the controllers never change.
 *
 * Two behaviors are the template's choice rather than the protocol's, and
 * `test/fixtures.test.ts` covers both:
 *
 * - Records with no value for the sort key sort last, in both directions.
 * - Equal values break the tie on ascending id, in both directions, so a page
 *   boundary never straddles two records that compare equal.
 */

import { z } from "zod";
import { OpportunitySchema, type Opportunity } from "../schemas/index.js";
import type {
  OpportunityFilters,
  OpportunityService,
  Page,
  Pagination,
  SortField,
  SortSpec,
} from "./opportunity.service.js";
// A plain import, so `tsc` emits the JSON into `dist` beside this file.
import rawFixtures from "../../data/opportunities.json" with { type: "json" };

/** The bundled data, parsed once at startup so a bad fixture fails on boot. */
export const opportunities: readonly Opportunity[] = z.array(OpportunitySchema).parse(rawFixtures);

/** `Money.amount` is a decimal string; compare it as a number, not text. */
function moneyAmount(money: { amount: string } | null | undefined): number | undefined {
  if (money == null) return undefined;
  const parsed = Number(money.amount);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** The close date of an opportunity, when it has one with a single date. */
function closeDate(opportunity: Opportunity): Date | undefined {
  const event = opportunity.keyDates?.closeDate;
  return event != null && event.eventType === "singleDate" ? event.date : undefined;
}

/**
 * Whether a value falls in (`between`) or out of (`outside`) an inclusive
 * range. A missing value matches neither operator: it is unknown, not
 * outside. An unusable bound is unknown too, whether it is an impossible date
 * that parsed to `NaN` or an inverted range with `min` above `max`.
 */
function matchesRange(
  value: number | undefined,
  operator: "between" | "outside",
  min: number,
  max: number
): boolean {
  if (value === undefined || Number.isNaN(min) || Number.isNaN(max) || min > max) return false;
  const inside = value >= min && value <= max;
  return operator === "between" ? inside : !inside;
}

type Money = { amount: string; currency: string };

/**
 * A record held in another currency matches neither operator: without a rate
 * the amounts are not comparable. This is the template's rule, not the
 * protocol's; see PORTING.md.
 */
function matchesMoneyRange(
  value: Money | null | undefined,
  filter: { operator: "between" | "outside"; value: { min: Money; max: Money } }
): boolean {
  if (
    value == null ||
    value.currency !== filter.value.min.currency ||
    value.currency !== filter.value.max.currency
  ) {
    return false;
  }

  const amount = moneyAmount(value);
  const min = moneyAmount(filter.value.min);
  const max = moneyAmount(filter.value.max);
  if (amount === undefined || min === undefined || max === undefined) return false;
  return matchesRange(amount, filter.operator, min, max);
}

/** Whether an opportunity satisfies every supplied filter. */
function matches(opportunity: Opportunity, filters: OpportunityFilters): boolean {
  const {
    status,
    closeDateRange,
    totalFundingAvailableRange,
    minAwardAmountRange,
    maxAwardAmountRange,
  } = filters;
  const funding = opportunity.funding;

  if (status != null) {
    const listed = status.value.includes(opportunity.status.value);
    if (status.operator === "in" ? !listed : listed) return false;
  }

  if (
    closeDateRange != null &&
    !matchesRange(
      closeDate(opportunity)?.getTime(),
      closeDateRange.operator,
      Date.parse(closeDateRange.value.min),
      Date.parse(closeDateRange.value.max)
    )
  ) {
    return false;
  }

  if (totalFundingAvailableRange != null) {
    if (!matchesMoneyRange(funding?.totalAmountAvailable, totalFundingAvailableRange)) return false;
  }
  if (minAwardAmountRange != null) {
    if (!matchesMoneyRange(funding?.minAwardAmount, minAwardAmountRange)) return false;
  }
  if (maxAwardAmountRange != null) {
    if (!matchesMoneyRange(funding?.maxAwardAmount, maxAwardAmountRange)) return false;
  }

  return true;
}

/** Every protocol sort key this service can execute, and how to read it. */
const SORT_KEYS: Record<SortField, (o: Opportunity) => string | number | undefined> = {
  lastModifiedAt: o => o.lastModifiedAt.getTime(),
  createdAt: o => o.createdAt.getTime(),
  title: o => o.title,
  "status.value": o => o.status.value,
  "keyDates.closeDate": o => closeDate(o)?.getTime(),
  "funding.maxAwardAmount": o => moneyAmount(o.funding?.maxAwardAmount),
  "funding.minAwardAmount": o => moneyAmount(o.funding?.minAwardAmount),
  "funding.totalAmountAvailable": o => moneyAmount(o.funding?.totalAmountAvailable),
  "funding.estimatedAwardCount": o => o.funding?.estimatedAwardCount ?? undefined,
};

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Code-unit order, not `localeCompare`, so the server's locale cannot change it.
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function sorted(items: readonly Opportunity[], { sortBy, sortOrder }: SortSpec): Opportunity[] {
  const read = SORT_KEYS[sortBy];
  const direction = sortOrder === "desc" ? -1 : 1;

  return [...items].sort((left, right) => {
    const a = read(left);
    const b = read(right);

    if (a === undefined || b === undefined) {
      if (a !== b) return a === undefined ? 1 : -1; // absent values last, always
    } else {
      const compared = compareValues(a, b);
      if (compared !== 0) return compared * direction;
    }

    return compareValues(left.id, right.id);
  });
}

function paginate(items: Opportunity[], { page, pageSize }: Pagination): Page<Opportunity> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), totalItems: items.length };
}

export class FixtureOpportunityService implements OpportunityService {
  async list(sorting: SortSpec, pagination: Pagination): Promise<Page<Opportunity>> {
    return paginate(sorted(opportunities, sorting), pagination);
  }

  async get(id: string): Promise<Opportunity | null> {
    return opportunities.find(opportunity => opportunity.id === id) ?? null;
  }

  async search(
    filters: OpportunityFilters,
    sorting: SortSpec,
    pagination: Pagination
  ): Promise<Page<Opportunity>> {
    const matched = opportunities.filter(opportunity => matches(opportunity, filters));
    return paginate(sorted(matched, sorting), pagination);
  }
}
