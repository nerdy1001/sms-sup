# Modules (student portal API)

One folder per business module of the delivery plan. Create each with:

    npm run new:module -- <CODE> [--depends a,b]

Every module has the same layout and the same rules (docs/boundaries.md):

    <module>/
      module.json     code, name, declared dependencies, database schema
      index.ts        public API: the only file other modules may import
      module.ts       composition root: wires the layers together
      internal/
        domain/         business rules, no libraries
        application/    use cases
        infrastructure/ database, files, network
        http/           routes, input validation

The planned modules and their proposed dependencies are in docs/architecture/modules.md.
