# Contracts

The data shapes exchanged between the staff application (core zone) and the student portal
(portal zone). Both applications depend on this package; neither depends on the other.

Keep it small. Anything with behaviour, any access to data and any Node module belongs elsewhere.
The only external library allowed is the schema validation library listed in `tools/rules.config.ts`.
