import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import type { Config } from "../config/load.ts";
import { errorFields, type Logger } from "../logging/logger.ts";
import { runAs, type Identity } from "./context.ts";

/** What a module can do with the database inside a request. Rows come back as plain objects. */
export interface Queryable {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: Row[]; readonly rowCount: number }>;
}

export interface Database {
  /**
   * Runs `work` in one transaction in which the row-level security policies see this staff member.
   * The transaction commits when `work` returns and rolls back when it throws. Every request that
   * touches data goes through here.
   */
  asUser<T>(identity: Identity, work: (database: Queryable) => Promise<T>): Promise<T>;
  /**
   * Runs `work` in one transaction with no identity. The policies then show nothing and allow nothing,
   * so this is only useful to call the few functions that are written to run before sign-in.
   */
  withoutIdentity<T>(work: (database: Queryable) => Promise<T>): Promise<T>;
  /** True when the database answers a trivial query within the limit. Never throws. */
  isReachable(limitMilliseconds?: number): Promise<boolean>;
  /** Waits for running work, then closes every connection. */
  close(): Promise<void>;
}

export type DatabaseSettings = Config["database"];

const MAX_CONNECTIONS = 10;
const CONNECT_TIMEOUT_MILLISECONDS = 5_000;
const IDLE_TIMEOUT_MILLISECONDS = 30_000;
/** A query that runs longer than this is cancelled by the server, so one slow query cannot hold a connection for ever. */
const STATEMENT_TIMEOUT_MILLISECONDS = 15_000;

export function createDatabase(settings: DatabaseSettings, logger: Logger): Database {
  const pool = new Pool({
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: settings.user,
    // The only place where the secret is read. It is passed to the driver and kept nowhere else.
    ...(settings.password === undefined ? {} : { password: settings.password.reveal() }),
    max: MAX_CONNECTIONS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MILLISECONDS,
    idleTimeoutMillis: IDLE_TIMEOUT_MILLISECONDS,
    statement_timeout: STATEMENT_TIMEOUT_MILLISECONDS,
    application_name: "sms-core-api",
  });

  // A connection that is idle in the pool can break (the server restarts). Without a listener Node would crash.
  pool.on("error", (error) => {
    logger.error(errorFields(error), "An idle database connection failed.");
  });

  async function inTransaction<T>(identity: Identity | undefined, work: (database: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    // While we hold the connection the pool does not listen to it. Without a listener, a connection that
    // dies in the middle of a request (the database restarts) would be an uncaught error that ends the program.
    const onConnectionError = (error: Error): void => {
      broken = true;
      logger.warn(errorFields(error), "A database connection failed while it was in use.");
    };
    client.on("error", onConnectionError);
    try {
      const queryable: Queryable = {
        async query<Row extends object>(text: string, values?: readonly unknown[]) {
          const result = await client.query<Row>(text, values === undefined ? undefined : [...values]);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
      };
      if (identity === undefined) {
        await client.query("begin");
        try {
          const result = await work(queryable);
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      }
      return await runAs(client, identity, () => work(queryable));
    } catch (error) {
      // If even the rollback failed the connection is in an unknown state: do not return it to the pool.
      broken = isConnectionFailure(error);
      throw error;
    } finally {
      client.off("error", onConnectionError);
      client.release(broken);
    }
  }

  return {
    asUser: (identity, work) => inTransaction(identity, work),
    withoutIdentity: (work) => inTransaction(undefined, work),
    async isReachable(limitMilliseconds = 2_000) {
      const cancel = new AbortController();
      try {
        const answer = pool.query("select 1").then(() => true);
        const timeout = delay(limitMilliseconds, false, { signal: cancel.signal });
        // If the timeout wins, the pending query is left to finish or fail on its own: its result is ignored.
        answer.catch(() => undefined);
        return await Promise.race([answer, timeout]);
      } catch {
        return false;
      } finally {
        cancel.abort();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function isConnectionFailure(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  // 08xxx: connection exception; the socket errors that Node reports before the server can answer.
  return code.startsWith("08") || ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"].includes(code);
}
