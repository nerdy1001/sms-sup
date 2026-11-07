# 1. The big picture

This page explains what the system is, what problem the repository structure solves, and how the
pieces fit. Read it first. It assumes you can write code but have not seen this project.

## What the system is

The Ministry of Higher Education sends young Cameroonians to study abroad on scholarships. Today the
Ministry tracks them in spreadsheets, WhatsApp groups and paper files. This system replaces that with
one place where staff can:

- register each scholar and keep their record,
- collect the documents scholars must send (proof of enrolment, results),
- plan the yearly payment of the Ministry's complementary bursary (a "commitment"),
- record payments and whether the scholar confirmed receiving them,
- see reports, and keep a trace of who did what.

Scholars get a small website, the **student portal**, where they upload documents, confirm payments
and update their phone number. The full list of requirements is the SRS (version 1.2). The plan for
building it, task by task, is the delivery plan. This repository is the code.

## Why security shapes everything

The records contain bank account numbers and identity numbers, some of them for minors. A leak would
harm real people and the Ministry. The system therefore has a rule that decides almost every
technical choice:

> The internal system is never reachable from the internet. The only part on the internet is the
> student portal, and it holds only the minimum data scholars need.

That gives **two zones**:

```
   Internet                     Ministry network
  +----------------+          +-----------------------+
  |  student       |          |  staff application    |
  |  portal        | <------- |  (core)               |
  |  (portal zone) |   core   |  (core zone)          |
  |                |   calls  |                       |
  +----------------+   out    +-----------------------+
   scholars use it             Ministry staff use it
                               nothing from outside can call in
```

The staff application only ever **calls out** (to push data to the portal, and to send email). Nothing
calls in. The two zones are two separate programs, `core-api` and `portal-api`, deployed to different
places.

## The problem the repository solves

With one developer and many months of work, the danger is not an attacker. The danger is a tired
afternoon in month five when a shortcut seems reasonable: import a staff function into the portal
"just this once", read another module's table "because it is faster". Each shortcut quietly weakens
the zone rule or makes the code harder to change. Nobody reviews your pull requests, so nobody notices.

The repository answers this in two ways:

1. **A fixed structure.** Every part of the system has a place, and every module has the same shape.
2. **A robot that enforces it.** A set of automatic checks fails the build when the structure is
   broken. The reasons are written down, so the rules are explained, not just imposed.

That robot, and the folders it protects, are what task FN-01 delivered. Task FN-02 added the security scans around it: dependencies, insecure code and secrets.

## How a change travels

```
you write code  ->  npm run check (on your machine)
                ->  open a pull request on GitHub
                ->  GitHub runs the same checks, plus a title check
                ->  all green: you merge (squash), the branch is deleted
```

If a check fails, the merge button stays blocked. That is the point.

## Where to go next

- A tour of every folder and file: [02-repository-tour.md](02-repository-tour.md)
- How a module is built, and the four layers: [03-modules.md](03-modules.md)
- What each check does and how to read its messages: [04-checks.md](04-checks.md)
- Day-to-day working: [05-working-here.md](05-working-here.md)
- Adding a route to the API: [06-writing-a-route.md](06-writing-a-route.md)
- The web framework, Fastify, explained: [07-fastify.md](07-fastify.md)
- Staging and Tailscale explained from zero: [08-staging-explained.md](08-staging-explained.md)
- Words you may not know: [glossary.md](glossary.md)
- What has been done so far: [../progress.md](../progress.md)
