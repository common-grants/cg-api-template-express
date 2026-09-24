# Connect your own data

The starter runs against bundled sample data. This is how you replace it.

The data access lives behind one interface in `src/api/services/`. The
controllers, the request and response validation, the OpenAPI document and
Swagger UI are all derived from the schemas — they do not need to know where
the data came from.

---

## 1. Implement the service interface

`src/api/services/opportunity.service.ts` defines the seam:

```ts
export interface OpportunityService {
  list(sorting: SortSpec, pagination: Pagination): Promise<Page<Opportunity>>;
  get(id: string): Promise<Opportunity | null>;
  search(
    filters: OpportunityFilters,
    sorting: SortSpec,
    pagination: Pagination
  ): Promise<Page<Opportunity>>;
}
```

Three things are worth knowing before you write your implementation:

- **Nothing HTTP-shaped crosses this boundary.** No envelopes, no status
  codes, no `req` or `res`. Return domain objects and a total count; the
  controller builds the response.
- **`pagination` is already normalized.** `page` and `pageSize` are positive
  integers by the time they reach you — the controller applied the protocol's
  defaults and flattened its nullable types.
- **`sorting` is already resolved.** `sortBy` is a key you can execute and
  `sortOrder` is `"asc"` or `"desc"`. Implementation-defined sort keys never
  reach you; the controller falls back to the default order and reports that
  in `sortInfo.errors`. The list route hands `list` its default order the same
  way, so your service never has to know what that default is.

`src/api/services/fixture-opportunity.service.ts` is the reference
implementation. Read it before you write yours — it shows what real filtering,
sorting and paging have to handle, including the parts that are easy to get
wrong (see §4 and §5).

Write your implementation as one class:

```ts
import type { Opportunity } from "../schemas/index.js";
import type {
  OpportunityFilters,
  OpportunityService,
  Page,
  Pagination,
  SortSpec,
} from "./opportunity.service.js";

export class PostgresOpportunityService implements OpportunityService {
  constructor(private readonly pool: Pool) {}

  async list(sorting: SortSpec, pagination: Pagination): Promise<Page<Opportunity>> {
    /* ... */
  }
  async get(id: string): Promise<Opportunity | null> {
    /* ... */
  }
  async search(
    filters: OpportunityFilters,
    sorting: SortSpec,
    pagination: Pagination
  ): Promise<Page<Opportunity>> {
    /* ... */
  }
}
```

Then wire it up in `src/index.ts`:

```diff
-import { FixtureOpportunityService } from "./api/services/fixture-opportunity.service.js";
+import { PostgresOpportunityService } from "./api/services/postgres-opportunity.service.js";

-const app = createApp({ service: new FixtureOpportunityService() });
+const app = createApp({ service: new PostgresOpportunityService(pool) });
```

Read the connection string from the environment, the way `src/index.ts` reads
`PORT`, and fail at startup when it is missing rather than on the first query.
Put it in `.env`, which is already gitignored (`.env.example` shows the shape),
and load it with `node --env-file=.env dist/index.js`; no dotenv dependency is
needed.

Delete `src/api/services/fixture-opportunity.service.ts` and
`src/data/opportunities.json` once nothing imports them.

## 2. Map your ids onto stable UUIDs

`Opportunity.id` is a UUID, and it is the public identity of the record: it
appears in `GET /common-grants/opportunities/{oppId}`, so consumers will store
it, bookmark it and use it as a foreign key.

**The same source record must always produce the same UUID.** If your system
uses integer or string keys, do not generate a random UUID per request or per
import. Either:

- store a generated UUID alongside each record the first time you see it, and
  read it back afterwards, or
- derive one deterministically from your key — a UUIDv5 over a namespace you
  own is the usual choice.

Keep the original key too. `customFields` is a good home for it (see §6), and
it is what lets you trace a CommonGrants id back to your own system.

## 3. Return parsed values, not raw rows

Your service returns `Opportunity`, which is
`z.output<typeof OpportunitySchema>` — the _parsed_ type. Date fields are real
`Date` objects, not strings.

The simplest correct implementation parses your rows through the schema:

```ts
import { OpportunitySchema } from "../schemas/index.js";

const rows = await db.query(/* ... */);
const items = rows.map(row => OpportunitySchema.parse(toCommonGrants(row)));
```

If a row cannot be parsed you find out at the source, with a Zod issue path
pointing at the field. If you skip this step and hand back a hand-built object,
the controller's response validation catches it instead and answers `500` —
correct, but much harder to debug.

## 4. Date-valued fields in filters and sorts

Two date shapes appear in the protocol and they behave differently:

| Field                                     | Schema              | Serializes as              |
| ----------------------------------------- | ------------------- | -------------------------- |
| `createdAt`, `lastModifiedAt`             | `UTCDateTimeSchema` | `2026-02-12T14:30:00.000Z` |
| `keyDates.*.date`, `startDate`, `endDate` | `ISODateSchema`     | `2026-03-31`               |

`ISODateSchema` produces a `Date` subclass whose `toJSON()` emits the date-only
form. **Copying that value turns it back into an ordinary `Date`** —
`structuredClone(d)` and `new Date(d)` both lose the date-only serialization and
start emitting a full timestamp on the wire. Pass the parsed value through
untouched, or re-parse with `ISODateSchema` after transforming.

A shallow spread such as `{ ...opp }` is safe: it copies the reference to the
same `Date` instance rather than cloning it. It is deep copies and explicit
reconstruction that lose the behavior.

For sorting and range filters, compare the underlying instants
(`date.getTime()`), not the strings. `closeDateRange` values arrive as ISO
strings and both ends of a `between` range are inclusive.

## 5. Money is a decimal string

`Money.amount` is a `string`, not a number, so that no precision is lost in
transit. Comparing those strings directly gives you lexical order:
`"9000.00" > "10000.00"`. Convert before you compare or sort — see
`moneyAmount()` in `src/api/services/fixture-opportunity.service.ts`, or push
the comparison into SQL with a numeric cast.

The same applies to `funding.estimatedAwardCount` and friends, which _are_
numbers — mixing the two is the easy mistake.

Currency is part of the comparison. A money-range filter names a currency on
both bounds, and the fixtures never match a record held in a different
currency, for `outside` as well as `between`: without a rate the amounts are
not comparable, so the record is unknown relative to the range, like a missing
value, rather than outside it. The protocol does not prescribe this. If your
data holds several currencies, decide whether to convert or keep this rule, and
test it either way.

## 6. Add custom fields in one file

`src/api/schemas/opportunity.ts` is the single definition of the opportunity
model. The response envelopes, the service's types and the OpenAPI document
all read from it, so extending it extends all of them at once.

It does not change this template's request schemas: the list, get and search
requests carry pagination, filters, sorting and an id, none of which embed the
opportunity model. Custom fields reach the wire through opportunity **response**
data, its types, and its OpenAPI definitions.

```ts
import { OpportunityBaseSchema } from "@common-grants/sdk/schemas";
import { withCustomFields } from "@common-grants/sdk/extensions";
import { z } from "zod";

const LegacyIdValueSchema = z.object({
  system: z.string(),
  id: z.number().int(),
});

export const OpportunitySchema = withCustomFields(OpportunityBaseSchema, {
  legacyId: {
    fieldType: "object",
    value: LegacyIdValueSchema,
    description: "Maps to the opportunity_id in the legacy system",
  },
  category: {
    fieldType: "string",
    description: "Grant category",
  },
} as const);

export type Opportunity = z.output<typeof OpportunitySchema>;
```

That is the whole change. Afterwards:

- `opp.customFields?.legacyId?.value.id` is typed `number`, with no cast.
- A custom field of the wrong type is rejected at parse time, with the issue
  path pointing into `customFields`.
- The custom fields appear in the opportunity response definitions in
  `/openapi.json`, and in Swagger UI, with their real value schemas.
- Controllers, handlers and the service interface are untouched.

Keep `as const` on the specs object — without it the literal `fieldType` values
widen to `string` and the typed inference is lost.

### One caveat: `.openapi()` on SDK schemas

`@common-grants/sdk` publishes CommonJS, so in this ESM project its schemas are
built by Zod's CommonJS copy while your own `import { z } from "zod"` gets the
ESM copy. Composing, parsing and OpenAPI generation all work across that
boundary. What does not work is `zod-to-openapi`'s `.openapi()` helper:
`extendZodWithOpenApi(z)` attaches it to the ESM copy only, so calling it on a
schema imported from the SDK throws a `TypeError` at runtime. So does
`registry.register("Name", SdkSchema)`, which calls `.openapi()` internally.

This template never calls `.openapi()`. `src/api/openapi.ts` passes SDK schemas
by reference, which inlines them, and uses Zod's own `.meta()` for examples,
which works on both copies:

```ts
// Throws at runtime, even after extendZodWithOpenApi(z):
UuidSchema.openapi({ example: "..." });

// Works on any schema, SDK or local:
UuidSchema.meta({ example: "..." });
```

`test/openapi.test.ts` pins this behavior, so a future SDK release that changes
it will fail a test rather than surprise you.

### And one more: import from the subpaths

`@common-grants/sdk` has no root entrypoint. Its public surface is the subpath
exports — `/schemas`, `/extensions`, `/types`, `/constants` and `/client` — and
a bare package import is rejected on purpose:

```ts
// TypeScript: Cannot find module. Node: ERR_PACKAGE_PATH_NOT_EXPORTED.
import { OpportunityBaseSchema } from "@common-grants/sdk";

// Works:
import { OpportunityBaseSchema } from "@common-grants/sdk/schemas";
import { withCustomFields } from "@common-grants/sdk/extensions";
```

This template only imports from the subpaths. Do the same in your own code.

## 7. Tests

The four suites divide along the seam:

| Suite                        | Keep or replace                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `test/app.test.ts`           | **Keep.** Health, OpenAPI, `/docs`, 404 and error shaping — no fixture data involved.                         |
| `test/opportunities.test.ts` | **Keep.** Drives the routes with stub services through supertest, so it never mentions a fixture id or count. |
| `test/openapi.test.ts`       | **Keep**, and extend the operation list if you add routes.                                                    |
| `test/fixtures.test.ts`      | **Replace.** Every assertion is about the bundled sample data.                                                |

Write the replacement for your service against the same checklist the fixture
suite covers, because these are the cases that break in production:

- an empty page past the end, and the total staying correct
- both ends of a `between` range, inclusive
- records with **no value** for a filtered or sorted field
- ties on the sort key — pick a deterministic tie-break and test it, otherwise
  paging can show or skip a record
- money compared numerically rather than lexically
- both sort directions, including on date-valued keys

Then add at least one integration test that runs your real service against a
real (test) data store. The route tests prove the contract; only an integration
test proves your mapping.

## 8. Keeping up to date

Two different things, often confused:

**Your dependencies.** Your project's problem, on your schedule. The
`@common-grants/sdk` releases are the ones to watch, because they carry
protocol changes: <https://github.com/HHS/simpler-grants-protocol/releases>.
Review SDK updates separately from routine tooling and framework updates so the
protocol-relevant change stays visible. The `sdk-range` job in
`.github/workflows/ci.yml` runs the tests against the newest SDK release your
declared range allows, so a breaking release shows up there before you bump.

**The template itself.** A project created from a GitHub template has no
ongoing link to its source. There is no automatic synchronization, no
backports, and no obligation on the template's maintainers toward your
application. If you want a later improvement, look at the template's commit
history and cherry-pick it deliberately:
<https://github.com/common-grants/cg-api-template-express/commits/main>.

## 9. Before you ship

- Replace the issue templates and the pull-request
  template with your own — the ones you inherited point at this template's
  maintainers.
- Review `.github/workflows/ci.yml` and adapt it to your own branch and
  dependency policies.
- Update `name`, `description` and `license` in `package.json`, and the
  `info` block in `src/api/openapi.ts` that titles your OpenAPI document.
- `swagger-ui-express` serves the UI bundle locally from `node_modules`, and
  the online validator badge, which would send your document's URL to
  swagger.io, is turned off in `src/api/controllers/docs.controller.ts`. No CDN
  or third-party request is involved, so `/docs` works in a locked-down
  deployment as it is. Remove the docs router from `src/api/index.ts` if you do
  not want to expose it.
