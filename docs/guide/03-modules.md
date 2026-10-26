# 3. Modules and layers

A **module** is one business feature with its own code, tests and database tables: scholar registry,
payments, documents. The list comes from the delivery plan and is in
[../architecture/modules.md](../architecture/modules.md).

## Why every module looks the same

When twenty modules each have their own style, reading a new one costs an hour. When they all have the
same shape, you know where to look before you open the folder. The generator creates the shape so
nobody has to remember it.

## The files of a module

```
modules/registry/
  module.json     identity card: code, name, database schema, which modules it may use
  index.ts        front door: the ONLY file other modules may import
  module.ts       wiring: connects the layers to each other
  module.test.ts  a first test
  README.md       what this module owns
  internal/       everything private
    domain/
    application/
    infrastructure/
    http/
```

- **`module.json`** looks like this:
  ```json
  {
    "code": "RG",
    "name": "registry",
    "title": "Scholar registry",
    "dependsOn": ["configuration"],
    "database": { "schema": "registry", "extraSchemas": [] }
  }
  ```
  `dependsOn` is the list of other modules this one is allowed to call. If you import a module that is
  not on the list, the build fails. Adding to the list is one line, but it is a visible decision.
- **`index.ts`** exports only what other modules need, typically a function that creates the module and
  its types. Everything else stays in `internal/`.
- **`module.ts`** is where the layers are connected. Everything the module needs from outside (for
  example another module's API) arrives as a parameter of `createRegistryModule(...)`. In tests you pass
  fakes. This is called **dependency injection**, done by hand with no special library.

## The four layers

Picture a restaurant.

| Layer | Restaurant | In the code | May import |
|---|---|---|---|
| `http` | The dining room: takes orders | Routes, checking that input is valid | `domain`, `application`, `http` |
| `application` | The head waiter: decides what to do | One **use case** per action, such as "confirm receipt": checks permission, calls the pantry, writes the audit trail | `domain`, `application` |
| `infrastructure` | Pantry and fridge: where things are stored | Database queries, files, email, calls to other systems | `domain`, `application`, `infrastructure` |
| `domain` | The recipes | Pure business rules, for example "a second repetition ends the bursary" | `domain` only |

Two consequences you will feel:

1. **The dining room cannot walk into the pantry.** The `http` layer may not import `infrastructure`.
   A request must pass through a use case, because that is where permissions and the audit trail live.
   There is no way to read the database and forget to check who is asking.
2. **Recipes need no kitchen.** The `domain` layer may import no library and no Node module. That is why
   business rules can be tested in milliseconds, with no database and no network.

An example of a request, to make it concrete (this is an illustration, not code that exists yet):

```
Scholar presses "I received my payment"
   http          checks the input has a payment id and a period
   application   confirmReceipt: is this scholar the owner? record it, write the audit trail
   domain        rule: a receipt can be confirmed only for a payment marked Paid
   infrastructure  saves the confirmation in the payments schema
```

## Database ownership

Each module owns one PostgreSQL **schema** (a named group of tables) called after the module, in snake
case: `registry`, `scholar_accounts`. Only that module reads or writes its tables. If registry needs
something from payments, it calls the payments module's public API. The reason: when module A reads
module B's tables directly, B can never change its tables without breaking A, and the two become one
tangled thing.

## Creating a module

```
npm run new:module -- RG --depends configuration
```

- The code (`RG`) must exist in the plan (`tools/rules.config.ts`). You cannot invent modules by accident.
- `--depends` lists modules that must already exist.
- It creates all the files above and a passing test.
- Run `npm run check` straight after. It should pass before you add any code.
