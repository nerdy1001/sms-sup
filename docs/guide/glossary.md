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
| **Advisory** | A published report of a security flaw in a library, usually with an id like GHSA-xxxx-xxxx-xxxx and the version that fixes it. |
| **Audit** | `npm audit`: comparing the libraries in the lock file with the list of advisories. |
| **Accepted risk** | A known problem you decided to live with for a limited time. It is written in `security/accepted-risks.json` with a reason and an expiry date. |
| **Secret scan** | A search for keys, tokens and passwords in the files and in every commit of the history. |
| **Entropy** | A measure of how random a text looks. Keys and tokens score high, ordinary words score low. The secret scan uses it to avoid flagging normal text. |
| **Dependabot** | A GitHub service that opens pull requests when a library has a new version. |
| **Cooldown** | A delay before Dependabot proposes a new release, so that a broken or malicious version is noticed by others first. |
| **ReDoS** | A pattern that can freeze a server when it receives a crafted input. The rule `dynamic-regexp` guards against building patterns from input. |
| **CI** | Continuous integration: the automatic checks that GitHub runs on every pull request. |
| **Pull request** | A proposal to merge a branch into `main`. The checks run on it. |
| **Squash merge** | Merging a branch as one commit whose message is the pull request title. |
| **Task ID** | A code from the delivery plan such as FN-01 (module FN, task 1). |
| **In progress / Delivered / Complete** | Task statuses. In progress: handed over, but a step only you can do is pending. Delivered: handed over and ready to check. Complete: accepted by you. |
| **Staging** | A copy of the system that is not the real one, where new versions are tried first, with synthetic data only. |
| **Droplet** | DigitalOcean's word for a rented virtual server. |
| **cloud-init** | A file given to a new server that sets it up on its first start. |
| **Docker, container, image** | A container is a program packaged with everything it needs and kept apart from the others. An image is the packaged form it starts from. |
| **Compose** | A file that lists the containers of one system and how they connect. |
| **Reverse proxy** | A front door program that receives requests, handles HTTPS, and passes each request to the right container behind it. Here: Caddy. |
| **Tailscale, tailnet** | A service that links your machines into a private network (the tailnet). Staging is reachable only from it. |
| **Forced command** | An SSH key setting that makes the key run one fixed command whatever it asks. The deploy key can only run the deploy script. |
| **Health check** | A request to `/health` that proves the application is running, and which version. |
| **Rollback** | Going back to the previous version after a bad deployment. |
| **Mail catcher** | A fake mail server (Mailpit) that keeps every email the system sends so nothing reaches a real mailbox and sign-in codes can be read. |
| **PostgreSQL** | The database system used by the application. |
| **Schema** | A named group of tables inside a database. The kernel owns `platform`; each module owns the schema called after it. |
| **Migration** | A numbered SQL file that changes the structure of the database. It is applied once and never edited afterwards. |
| **Seed** | A SQL file that adds synthetic data for development. It can be run again without changing anything. |
| **Row-level security (RLS)** | A PostgreSQL feature that makes the database itself hide or refuse rows according to rules called policies, whatever the application asks. |
| **Policy** | One rule of row-level security, for example "a staff member reads only their own row". |
| **Application role (`sms_app`)** | The database login the application uses. It is deliberately weak: it cannot create anything or skip the policies. |
| **Session setting** | A value attached to a database connection. The application sets `app.user_id` and `app.role` for each request so that the policies know who is asking. |
| **Append-only** | A table that can be added to but not changed or emptied, like the audit log. |
| **Synthetic data** | Invented data that looks like real data but belongs to no one. The addresses end in `.invalid`. |
| **psql** | PostgreSQL's command-line program. The migration runner sends SQL through it. |
