import { inspect } from "node:util";

/**
 * Holds a secret so that it cannot reach a log by accident. Printing it, converting it to text,
 * turning it into JSON or inspecting it all give "[redacted]". The value comes out only through
 * reveal(), which makes every use of the real value easy to find in a review.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }

  [inspect.custom](): string {
    return "[redacted]";
  }
}
