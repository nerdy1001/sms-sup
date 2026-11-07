import { z } from "zod";

/** The answer of GET /health: the application is running. It never touches the database. */
export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  /** The commit the running build was made from. The deploy script looks for it. */
  version: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

/** The answer of GET /ready: the application can reach its database. */
export const readySchema = z.object({
  status: z.literal("ready"),
});
export type Ready = z.infer<typeof readySchema>;
