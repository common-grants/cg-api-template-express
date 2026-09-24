/**
 * The single opportunity schema this API serves.
 *
 * The service interface, fixture parsing, response envelopes, the OpenAPI
 * document and the tests all read {@link OpportunitySchema} from here, so this
 * is the one file to edit to add custom fields. See "Add custom fields in one
 * file" in PORTING.md.
 */

import { OpportunityBaseSchema } from "@common-grants/sdk/schemas";
import type { z } from "zod";

/** The opportunity model this API serves. */
export const OpportunitySchema = OpportunityBaseSchema;

/** A parsed opportunity. `Date`-valued fields are real `Date`s, not strings. */
export type Opportunity = z.output<typeof OpportunitySchema>;
