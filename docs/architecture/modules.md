# Module map

The modules of the delivery plan, where each lives, and the dependencies proposed for each. The
dependencies are a proposal: confirm or change them when the first task of each module starts, in
that module's `module.json`. The boundary checks enforce whatever is declared there.

A dependency means "calls the public API of". It never means "reads the tables of".

## Staff application (`apps/core-api`)

| Code | Folder | Responsibility | May depend on |
|---|---|---|---|
| AC | `access` | Staff accounts, sign-in, sessions, roles | none |
| CF | `configuration` | Scholarship parameters per host country | none |
| RG | `registry` | Scholar records, statuses, attaché assignment | configuration |
| IM | `import` | Import of the Ministry's spreadsheets with a validation report | registry, configuration |
| AU | `audit` | Reading the audit trail, administration screens | access |
| SA | `scholar-accounts` | Issuing and recovering scholar access | registry, sync |
| DM | `documents` | Uploads, review, document status | registry |
| AM | `monitoring` | Academic progress, repetition decisions | registry, documents |
| CM | `commitments` | Yearly commitment rounds, eligibility | registry, configuration, documents, monitoring |
| PY | `payments` | Allocations, payment status, receipt confirmation | commitments, registry |
| TR | `tracking` | Year-end review, completion | registry, monitoring |
| NT | `notifications` | Emails to staff and scholars | none |
| RP | `reports` | Reports and dashboards, reading through public APIs only | registry, configuration, documents, monitoring, commitments, payments, tracking |
| SY | `sync` | Pushing the minimum data to the portal, pulling submissions | registry, documents |

## Student portal API (`apps/portal-api`)

| Code | Folder | Responsibility | May depend on |
|---|---|---|---|
| PT | `student-portal` | Scholar sign-in, own data, uploads | sync |
| SY | `sync` | Receiving what the staff application pushes | none |

## Not modules

FN (foundations), PL (platform and compliance), QS (quality and security testing), DT
(documentation and go-live) and DP (demo preparation) are work packages. FN becomes the `kernel`
folder of each application and the tooling in this repository.

## Open points on the module graph

1. **Notifications.** Many modules want to send an email (a document approved, a payment marked
   paid). If each one depends on `notifications`, the graph gets crowded. A small in-process event
   mechanism in the kernel would let modules announce what happened and `notifications` listen.
   Decide it when the first notification is built.
2. **Reports.** `reports` depends on almost everything, which is acceptable for a read-only
   module, as long as it uses the public APIs. If that becomes slow, the right answer is read
   models owned by each module, not direct reads of their tables.
3. **Who owns the portal's copy of the data.** The proposal is that `sync` (portal side) owns the
   projection tables and `student-portal` reads them through its public API.
