# ADR 0009: Audit hooks for writes and reads

Status: accepted (2026-11-05, task FN-07)

## Context

The audit table exists since FN-04: append-only, readable only by auditors and administrators, holding
identifiers and action names and never personal data. Nothing wrote to it. The system keeps scholarship and
payment records of real people, and the Ministry must be able to answer who changed or looked at a record.
With one developer and a Ministry that has no IT team, the mechanism must work without anyone remembering to
call it.

## Decisions

1. **A route declares its audit action, like it declares who may call it.** `config: { audit: { action,
   objectType } }`, for example `scholar.update` on `scholar`. A route that changes data (POST, PUT, PATCH,
   DELETE) and is not public must declare one, or the application does not start. The declaration also appears
   in the API description (`x-audit`).
2. **The kernel writes the entry, in the same transaction as the change.** Modules work through
   `request.transaction(async (database, audit) => ...)`. The change and its entry are committed together or
   not at all. If the entry cannot be written, the change is not kept: a change without a record is worse than
   a refused change. The alternative, modules calling an audit function themselves, was refused because a
   forgotten call is a silent gap that no one finds until an inquiry.
3. **Declared reads are recorded; other reads are not.** A route that shows personal data declares an action
   and uses the same helper. Recording every read was refused: the log would fill with page loads and
   auditors would stop reading it. Recording only exports was refused: it misses someone browsing records one
   after another. Which routes count as "personal data" is decided per route when each module is built.
4. **Refused attempts are recorded.** A signed-in person who is refused (wrong role) leaves an `access.denied`
   entry, with the route as written (never the address as sent, which can hold identifiers) and the roles that
   would have been allowed. A request with no signed-in person (401) is not recorded in the table, because the
   table needs an actor; it stays in the application log. A failure to write the refusal is logged and the
   refusal stands.
5. **The detail of an entry is restricted by code.** Only text, numbers, flags and null. A key that names
   personal data (the same list that the logger redacts) or a value that looks like an e-mail address stops the
   request. This is a safety net, not permission: modules record identifiers and codes.
6. **A declared route that answers success without recording is a bug, and says so.** The success is replaced
   by an error and the log names the action. This catches a module that declared an action but did its work
   outside `request.transaction`.
7. **A request that touches several records leaves one entry per record,** written in one statement, up to
   1000 per request. A request that touches none in particular (a search) leaves one entry without an object.
8. **Failed work leaves no entry.** If the transaction rolls back, nothing happened, so nothing is recorded.
   What was attempted and refused is covered by decision 4; what failed by accident is in the application log.

## Consequences

- Every module task from now on declares audit actions in its routes. The cost is one line per route, and
  `request.transaction` instead of `database.asUser`.
- A write by `database.asUser` inside a route that is not declared (a GET that writes, say) is not detected.
  A GET route must not change data; this is a rule of review, not of the code.
- A read that is audited writes to the table, so its transaction is not read-only. The cost is small
  and is paid only by the reads of personal data.
- Entries are written as the application role under row-level security: an entry can only be in the name of
  the person making the request. Nobody can be blamed for an action they did not take.
- The audit table grows without limit. Retention and archiving are not decided here.

## When to revisit

- When AC-01 defines sign-in: failed sign-ins and password resets happen before anyone is signed in and
  need `withoutIdentity` entries with a different shape.
- When the first module declares its reads: check that the log stays readable and the choice of routes is sound.
- When a screen for auditors is built (a later task), to see which filters they need from the columns.
- If the table gets large: partitioning by month, or archiving, with the ministry's retention rules.
