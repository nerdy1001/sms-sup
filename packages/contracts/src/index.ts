// The only code shared by the staff application (core) and the student portal.
// It holds data shapes and nothing else: no behaviour, no database, no network.
// Rules: docs/boundaries.md (contracts-purity).
export {
  ERROR_CODES,
  errorCodeSchema,
  fieldProblemSchema,
  problemSchema,
  type ErrorCode,
  type FieldProblem,
  type Problem,
} from "./errors.ts";
export { healthSchema, readySchema, type Health, type Ready } from "./health.ts";
