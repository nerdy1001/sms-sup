# Glossary

Words used in this project and this repository.

## The business

| Word | Meaning |
|---|---|
| **MINESUP** | The Ministry of Higher Education of Cameroon, the client. |
| **Scholar** | A student on a scholarship. |
| **Attaché** | A Ministry staff member who manages the affairs of a group of scholars. |
| **Complementary bursary** | The monthly top-up the Ministry pays a scholar on top of the host country's scholarship. |
| **Commitment** | The yearly budget reservation for a scholar's complementary bursary, made in a round (usually May and June). |
| **Receipt confirmation** | The scholar (or a bank record) confirming that a payment arrived. "Paid" means the Ministry of Finance paid; it does not prove the scholar received it. |
| **Repetition** | A scholar repeating an academic year. Allowed once; a second one ends the Ministry's bursary. |
| **SRS** | Software Requirements Specification: the document that says what the system must do. |

## The architecture

| Word | Meaning |
|---|---|
| **Zone** | A part of the system with its own exposure and its own program. There are two: core (staff, internal) and portal (scholars, internet). |
| **Core** | The staff application. Never reachable from the internet. |
| **Portal** | The student portal. Reachable from the internet, holds minimal data. |
| **Egress** | Network traffic going out of a program. The staff application may only send out to the portal and the mail relay. |
| **Kernel** | The shared toolbox inside an application (configuration, logging, database helpers). Modules use it; it never uses a module. |
| **Module** | One business feature with its own code, tests and database schema. |
| **Layer** | One of four parts inside a module: `http`, `application`, `infrastructure`, `domain`. |
| **Public API** | The one file (`index.ts`) through which other modules may use a module. |
| **Composition root** | The place where a module's parts are connected (`module.ts`). |
| **Dependency injection** | Giving a piece of code what it needs as a parameter instead of letting it fetch it, so tests can pass fakes. |
| **Use case** | One action the system can perform, such as "confirm receipt". Lives in the `application` layer. |
| **Contract** | An agreed data shape shared between zones, in `packages/contracts`. |
| **Schema (database)** | A named group of tables inside PostgreSQL. Each module owns one. |
| **Audit trail** | The permanent record of who did what and when. |

## The repository and tools

| Word | Meaning |
|---|---|
| **Monorepo** | Several programs and packages kept in one repository. |
| **Workspace** | A folder npm treats as a package inside the monorepo. |
| **Lock file** | `package-lock.json`: the exact versions of every library, so everyone installs the same thing. |
| **Pinning** | Writing an exact version (`6.0.3`) instead of a range, so an update is always a visible change. |
| **Supply chain attack** | An attack that comes through a library you installed. Install scripts are a common route, which is why they are switched off. |
| **Type stripping** | Node 22.18 and later can run TypeScript by removing the types when it loads a file, with no build step. |
| **Strict mode** | TypeScript settings that make the compiler catch more mistakes. |
| **Suppression** | A comment that silences one coding rule on one line, with a written reason. |
| **ADR** | Architecture decision record: a short note saying what was decided, why, and what it costs. |
| **CI** | Continuous integration: the automatic checks that GitHub runs on every pull request. |
| **Pull request** | A proposal to merge a branch into `main`. The checks run on it. |
| **Squash merge** | Merging a branch as one commit whose message is the pull request title. |
| **Task ID** | A code from the delivery plan such as FN-01 (module FN, task 1). |
| **Delivered / Complete** | Task statuses. Delivered: handed over. Complete: accepted by you. |
