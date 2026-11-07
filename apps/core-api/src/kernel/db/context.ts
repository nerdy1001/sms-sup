/**
 * Tells the database who is asking. The row-level security policies read two session settings,
 * app.user_id and app.role (migration 0001). They are set at the start of every request, inside the
 * transaction of that request, and disappear when it ends, so a pooled connection never carries one
 * person's identity over to the next request.
 *
 * Use it with one connection that you own for the whole request, not with a pool that may hand a
 * different connection to each call. `database.ts` does that (it borrows one connection, calls `runAs`
 * on it and gives it back); this file only needs something that can run a query.
 */

export interface SqlExecutor {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface Identity {
  readonly userId: string;
  readonly role: string;
}

/** The statement that sets the identity. `true` means: until the end of the transaction. */
export const SET_CONTEXT_SQL = "select set_config('app.user_id', $1, true), set_config('app.role', $2, true)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLE = /^[a-z][a-z_]{0,40}$/;

export function assertIdentity(identity: Identity): void {
  if (!UUID.test(identity.userId)) throw new Error("The user id must be a lowercase UUID.");
  if (!ROLE.test(identity.role)) throw new Error("The role must be lowercase letters and underscores.");
}

/** Runs `work` in one transaction in which the policies see this identity. Rolls back if it throws. */
export async function runAs<T>(executor: SqlExecutor, identity: Identity, work: () => Promise<T>): Promise<T> {
  assertIdentity(identity);
  await executor.query("begin");
  try {
    await executor.query(SET_CONTEXT_SQL, [identity.userId, identity.role]);
    const result = await work();
    await executor.query("commit");
    return result;
  } catch (error) {
    await executor.query("rollback");
    throw error;
  }
}
