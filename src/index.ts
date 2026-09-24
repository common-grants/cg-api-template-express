/**
 * The Node entrypoint: composes the fixture service with {@link createApp}
 * and listens. The only file that opens a socket.
 */

import type { AddressInfo } from "node:net";
import { createApp } from "./api/index.js";
import { FixtureOpportunityService } from "./api/services/fixture-opportunity.service.js";

/** The documented local default. Override with `PORT`. */
export const DEFAULT_PORT = 3000;

// `||`, not `??`: an empty PORT would coerce to 0 and bind a random port.
const port = Number(process.env.PORT || DEFAULT_PORT);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT must be an integer between 0 and 65535, received "${process.env.PORT}"`);
  process.exit(1);
}

const app = createApp({ service: new FixtureOpportunityService() });

const server = app.listen(port, error => {
  if (error) {
    console.error("Could not start the server", error);
    process.exit(1);
  }
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  console.log(`CommonGrants API listening on ${url}`);
  console.log(`  Opportunities  ${url}/common-grants/opportunities`);
  console.log(`  Docs           ${url}/docs`);
  console.log(`  OpenAPI        ${url}/openapi.json`);
  console.log(`  Health         ${url}/health`);
});
