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
| **Tailscale** | The private network that makes staging reachable only from machines you approved. Explained in [8. Staging](08-staging-explained.md). |
| **Fastify** | The web framework that receives requests for the staff application. Explained in [7. Fastify](07-fastify.md). |
| **Hook** | A function that Fastify calls at a fixed moment of every request, such as before the handler runs. Used for the sign-in check and the request log. |
| **Plugin (Fastify)** | A function that adds routes and hooks to the application, registered with `register`. Each module's routes are one. What it adds stays inside it. |
| **Handler** | The function that answers one route. |
| **Lifecycle** | The fixed order of steps one request goes through in Fastify, from `onRequest` to `onResponse`. |
| **Route** | One address and method that the API answers, for example `GET /health`, together with who may call it and what it accepts and returns. |
| **Access declaration** | The line `config: { access: ... }` that every route must have. It says who may call the route. Without it the application does not start. |
| **Identity** | The signed-in staff member (their id and role) that a request carries once sign-in exists. The database policies read it. |
| **Problem details** | The standard format (RFC 9457) of every error answer: a stable code, a title, a sentence for developers and the request identifier. |
| **Error code** | The stable name of a kind of failure, such as `not_found`. The front end translates by code, so the wording can be French or English. |
| **Request identifier** | A number given to each request. It appears in the log line, in the error answer and in the `x-request-id` header, so one request can be followed. |
| **Redaction** | Replacing a sensitive field in a log line by `[redacted]` before it is written. A safety net for logging by mistake. |
| **Health and ready** | Two questions a machine asks. `/health`: is the program running? `/ready`: can it reach its database? |
| **Connection pool** | A set of open database connections that requests borrow one at a time. |
| **Secret file** | A file that holds a password, whose path is given to the application (`DATABASE_PASSWORD_FILE`), so the secret never sits in an environment variable. |
| **OpenAPI** | A standard way to describe an API in a file. Ours is generated from the routes (`docs/api/openapi.json`). |
| **Rate limit** | A cap on how many requests one address can make in a minute. |
| **Schema (zod)** | A description of the shape of some data, used to check it, to give it a TypeScript type and to describe it in the API document. Not the same as a database schema. |

## The repository and tools

| Word | Meaning |
|---|---|
| **Monorepo** | Several programs and packages kept in one repository. |
| **Workspace** | A folder npm treats as a package inside the monorepo. |
| **Lock file** | `package-lock.json`: the exact versions of every library, so everyone installs the same thing. |
| **Dependency register** | `docs/dependencies.md`: one row for every library, saying what it is for, why it was not written by hand, what to do if it is abandoned and where it may be imported. A check enforces it. |
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
| **psql** | PostgreSQL's command-line program. `npm run db:psql` opens it inside the local container. The migration runner no longer uses it (it uses the `pg` driver). |
| **Audit log** | The table that records who did what to which record and when. It only grows, and holds identifiers, never personal data. |
| **Audit action** | The name of what was done, written as object and verb, for example `scholar.update`. A route declares it in its configuration. |
| **Front end** | The part of the system that runs in the browser. Here: `apps/staff-web`. |
| **Static files** | Files sent as they are, with no program running to make them. The built front end is a folder of them. |
| **Component (React)** | A function that returns a piece of the screen. Screens are built by placing components inside each other. |
| **Vite** | The tool that builds the front end into static files and runs the development page. |
| **Vitest** | The test runner for the front end. It pretends to be a browser (jsdom). |
| **Content Security Policy** | A header that tells the browser which addresses a page may load scripts and data from. Staging allows only its own address. |
| **i18n (internationalisation)** | Making a page usable in several languages. Here done with the i18next library. |
| **Message catalogue** | The list of texts of the screens, once per language, found by a key. |
| **Synthetic data** | Invented people, schools and payments that look like a real caseload and cannot be mistaken for one (identifiers start with SYN-, e-mail addresses end in .invalid). The only kind of data allowed outside production. |
| **Edge case label** | A tag on a synthetic scholar that says it has a deliberately awkward case, such as a repeated year or a rejected payment. Tests use it to ask for that case. |
| **Reference date** | The fixed "today" inside the synthetic data (2026-11-05), so the data does not change with the clock. |
