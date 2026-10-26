# Documentation

Start here. Everything is in plain Markdown, next to the code, so a change and its explanation travel
together in the same pull request.

## Reading order

1. [guide/01-big-picture.md](guide/01-big-picture.md): what the system is and why the repository is built this way.
2. [guide/02-repository-tour.md](guide/02-repository-tour.md): every folder and file, and what it is for.
3. [guide/03-modules.md](guide/03-modules.md): how a module is built, and the four layers.
4. [guide/04-checks.md](guide/04-checks.md): what the automatic checks do and how to read their messages.
5. [guide/05-working-here.md](guide/05-working-here.md): the daily routine, from one task to the next.
6. [guide/glossary.md](guide/glossary.md): the words.

## What has been done

- [progress.md](progress.md): the list of tasks, with their status.
- [tasks/](tasks/): one record per task. Each says what was asked, what was built, how it works, why,
  how to check it, what was left out and what comes next. Start with [tasks/FN-01.md](tasks/FN-01.md); the latest is [tasks/FN-02.md](tasks/FN-02.md).

## Reference

- [boundaries.md](boundaries.md): every enforced rule and the reason for it.
- [architecture/modules.md](architecture/modules.md): the planned modules and their allowed dependencies.
- [adr/](adr/): decision records (why one repository, why no framework, why custom checks).
- [github-setup.md](github-setup.md): GitHub settings to apply once.

## How this documentation is kept up to date

The documentation is part of "done". When a task is marked complete, these things happen in this order:

1. **The task record** in `tasks/<ID>.md` is written or corrected (copy `tasks/_template.md`). It describes
   what the task delivered as it actually turned out, including what was left out and what is still open.
2. **The progress log** (`progress.md`) gets the row, or the row changes status. A task is
   **Delivered** when the work is handed over and **Complete** when you accept it.
3. **The guide** pages that the task changed are updated: a new building block goes in the repository
   tour, a new rule in the checks page, a new routine in the working page. New words go in the glossary.
4. **The reference** pages (`boundaries.md`, `architecture/modules.md`, an ADR) are updated if a rule,
   a module or a decision changed.
5. `npm run check` runs. The documentation check fails if a progress row has no task record, if a task
   record has no progress row or lacks a required section, or if a link in any Markdown file is dead.
6. The updated repository is delivered, with a short summary of what changed in the documentation.

What the check can verify is structure: records exist, sections exist, links work. Whether the words are
true and clear is verified by a person. If you find something in the documentation that is unclear or no
longer true, say so; that is a defect like any other.
