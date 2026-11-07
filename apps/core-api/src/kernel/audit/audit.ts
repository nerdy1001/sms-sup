import type { Identity } from "../db/context.ts";
import type { Queryable } from "../db/database.ts";
import { SENSITIVE_KEYS } from "../logging/logger.ts";

/**
 * The audit log answers "who did what, to which record, when". This file holds the parts that need no web
 * server: what a route declares, what an entry may contain, and how entries are written.
 *
 * An entry holds identifiers and action names, never personal data (see migration 0003). The rules for the
 * `detail` of an entry are enforced here, so that a careless module cannot put a name or a phone number
 * into a table that can never be corrected.
 */

/** What a route declares: the action to record and the kind of object it acts on. Both are lowercase words. */
export interface AuditDeclaration {
  /** For example "scholar.update" or "scholar.read": the object, a dot, the verb. */
  readonly action: string;
  /** For example "scholar". */
  readonly objectType: string;
}

export type AuditValue = string | number | boolean | null;
/** A few facts about what happened, as identifiers, counts and codes. Never names, numbers or contact details. */
export type AuditDetail = Readonly<Record<string, AuditValue>>;

export interface AuditEntry {
  readonly action: string;
  readonly objectType: string;
  readonly objectId?: string | undefined;
  readonly detail?: AuditDetail | undefined;
}

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const OBJECT_TYPE = /^[a-z][a-z0-9_]*$/;
const DETAIL_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,119}$/;
const MAX_DETAIL_KEYS = 20;
const MAX_DETAIL_TEXT = 200;
/** One request cannot write more entries than this (a bulk export of identifiers, for example). */
export const MAX_ENTRIES_PER_REQUEST = 1000;

export const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isValidDeclaration(value: unknown): value is AuditDeclaration {
  if (typeof value !== "object" || value === null) return false;
  const { action, objectType } = value as { action?: unknown; objectType?: unknown };
  return typeof action === "string" && ACTION.test(action) && typeof objectType === "string" && OBJECT_TYPE.test(objectType);
}

function looksSensitive(key: string): boolean {
  return SENSITIVE_KEYS.some((word) => key === word || key.startsWith(`${word}_`) || key.endsWith(`_${word}`));
}

/** Refuses what must never reach the log. Throws a plain Error: this is a mistake in the code, not in the request. */
export function assertSafeDetail(detail: AuditDetail): void {
  const keys = Object.keys(detail);
  if (keys.length > MAX_DETAIL_KEYS) throw new Error(`An audit detail holds at most ${MAX_DETAIL_KEYS} facts.`);
  for (const key of keys) {
    if (!DETAIL_KEY.test(key)) throw new Error(`The audit detail key "${key}" must be lowercase words joined by underscores.`);
    if (looksSensitive(key)) throw new Error(`The audit detail key "${key}" names personal data. Record an identifier instead.`);
    const value = detail[key];
    if (typeof value === "string") {
      if (value.length > MAX_DETAIL_TEXT) throw new Error(`The audit detail "${key}" is longer than ${MAX_DETAIL_TEXT} characters.`);
      if (value.includes("@")) throw new Error(`The audit detail "${key}" looks like an e-mail address. Record an identifier instead.`);
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`The audit detail "${key}" is not a finite number.`);
    } else if (typeof value !== "boolean" && value !== null) {
      throw new Error(`The audit detail "${key}" must be a text, a number, true, false or null.`);
    }
  }
}

export function assertValidEntry(entry: AuditEntry): void {
  if (!ACTION.test(entry.action)) throw new Error(`The audit action "${entry.action}" must look like "scholar.update".`);
  if (!OBJECT_TYPE.test(entry.objectType)) throw new Error(`The audit object type "${entry.objectType}" must be lowercase words.`);
  if (entry.objectId !== undefined && !OBJECT_ID.test(entry.objectId)) {
    throw new Error("The audit object id must be an identifier of at most 120 characters, not free text.");
  }
  if (entry.detail !== undefined) assertSafeDetail(entry.detail);
}

/**
 * Appends entries, in the caller's transaction and in the caller's name. The policy of the table refuses an
 * entry written in someone else's name, so this cannot be used to blame another person.
 */
export async function writeAuditEntries(database: Queryable, identity: Identity, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  if (entries.length > MAX_ENTRIES_PER_REQUEST) throw new Error(`One request may write at most ${MAX_ENTRIES_PER_REQUEST} audit entries.`);
  for (const entry of entries) assertValidEntry(entry);
  await database.query(
    `insert into platform.audit_log (actor_id, actor_role, action, object_type, object_id, detail)
     select $1::uuid, $2::text, entry.action, entry.object_type, entry.object_id, entry.detail::jsonb
     from unnest($3::text[], $4::text[], $5::text[], $6::text[]) as entry(action, object_type, object_id, detail)`,
    [
      identity.userId,
      identity.role,
      entries.map((entry) => entry.action),
      entries.map((entry) => entry.objectType),
      entries.map((entry) => entry.objectId ?? null),
      entries.map((entry) => JSON.stringify(entry.detail ?? {})),
    ],
  );
}

/** What a handler uses, inside `request.transaction`, to say which records the request touched. */
export interface AuditTrail {
  /** Records that this request acted on one more record. Call it once per record (a list of ten calls it ten times). */
  object(id: string, detail?: AuditDetail): void;
}

/** Collects what the handler reports, and turns it into the entries of the route's declared action. */
export function createTrail(): { readonly trail: AuditTrail; readonly entriesFor: (declaration: AuditDeclaration) => AuditEntry[] } {
  const touched: { id: string; detail?: AuditDetail }[] = [];
  return {
    trail: {
      object(id, detail) {
        if (touched.length >= MAX_ENTRIES_PER_REQUEST) throw new Error(`One request may touch at most ${MAX_ENTRIES_PER_REQUEST} records.`);
        touched.push(detail === undefined ? { id } : { id, detail });
      },
    },
    entriesFor: (declaration) => {
      // A request that touched no particular record (a search, for example) still leaves one entry.
      if (touched.length === 0) return [{ action: declaration.action, objectType: declaration.objectType }];
      return touched.map((item) => ({
        action: declaration.action,
        objectType: declaration.objectType,
        objectId: item.id,
        ...(item.detail === undefined ? {} : { detail: item.detail }),
      }));
    },
  };
}
