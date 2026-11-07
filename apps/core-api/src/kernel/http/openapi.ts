import { problemSchema } from "@minesup/contracts";
import type { SwaggerOptions } from "@fastify/swagger";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import { z } from "zod";

/** The description of an error answer, added to every route so that nobody has to repeat it. */
const problemResponse = {
  description: "Any failure. The `code` is stable; the front end translates it.",
  content: { "application/problem+json": { schema: z.toJSONSchema(problemSchema, { target: "draft-2020-12" }) } },
} as const;

/** Settings of the generated API description (docs/api/openapi.json, made by `npm run api:docs`). */
export function openApiOptions(): SwaggerOptions {
  return {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Scholarship management system, staff API",
        description:
          "The API of the staff application of the Ministry of Higher Education. Generated from the route definitions: do not edit by hand.",
        version: "0.1.0",
      },
    },
    transform(input) {
      const result = jsonSchemaTransform(input);
      const access = input.route.config?.access;
      const schema: Record<string, unknown> = { ...(result.schema as Record<string, unknown> | undefined) };
      schema["x-access"] = access;
      schema["x-audit"] = input.route.config?.audit;
      schema["response"] = { ...(schema["response"] as object | undefined), default: problemResponse };
      return { ...result, schema };
    },
  };
}
