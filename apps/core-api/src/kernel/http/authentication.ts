import type { FastifyRequest } from "fastify";
import type { Identity } from "../db/context.ts";

/**
 * Finds out who is calling. It returns the staff member, or null when the request carries no valid
 * credentials. The real one arrives with task AC-01 (sessions, sign-in, second factor).
 */
export type Authenticator = (request: FastifyRequest) => Promise<Identity | null>;

/**
 * What runs until AC-01 exists: nobody is signed in, so every route that is not public answers 401.
 * There is deliberately no development login and no shared test password. A test that needs a signed-in
 * user passes its own Authenticator, in the test file.
 */
export const rejectEveryone: Authenticator = () => Promise.resolve(null);
