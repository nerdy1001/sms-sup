/**
 * The architecture rules, as data. Changing a rule here is an architectural decision:
 * explain it in the pull request and, when it changes a principle, in a decision record
 * (docs/adr). Everything that the checks enforce is explained in docs/boundaries.md.
 */

export interface PlannedModule {
  readonly code: string;
  readonly name: string;
  readonly app: "core-api" | "portal-api";
  readonly title: string;
}

/** The modules of the delivery plan. A module folder can only be created for a module listed here. */
export const plannedModules: readonly PlannedModule[] = [
  { code: "AC", name: "access", app: "core-api", title: "Staff access and security" },
  { code: "CF", name: "configuration", app: "core-api", title: "Programme configuration" },
  { code: "RG", name: "registry", app: "core-api", title: "Scholar registry" },
  { code: "IM", name: "import", app: "core-api", title: "Data import" },
  { code: "AU", name: "audit", app: "core-api", title: "Audit and administration" },
  { code: "SA", name: "scholar-accounts", app: "core-api", title: "Scholar accounts" },
  { code: "DM", name: "documents", app: "core-api", title: "Document management" },
  { code: "AM", name: "monitoring", app: "core-api", title: "Academic monitoring and repetition" },
  { code: "CM", name: "commitments", app: "core-api", title: "Annual commitments" },
  { code: "PY", name: "payments", app: "core-api", title: "Payments and receipts" },
  { code: "TR", name: "tracking", app: "core-api", title: "Tracking and completion" },
  { code: "NT", name: "notifications", app: "core-api", title: "Notifications" },
  { code: "RP", name: "reports", app: "core-api", title: "Reports and dashboards" },
  { code: "SY", name: "sync", app: "core-api", title: "Portal sync and integrations" },
  { code: "PT", name: "student-portal", app: "portal-api", title: "Student portal" },
  { code: "SY", name: "sync", app: "portal-api", title: "Portal sync (receiving side)" },
];

export const rules = {
  /** Applications on the staff side and on the scholar side never import each other. */
  zones: {
    core: ["core-api", "staff-web"],
    portal: ["portal-api", "portal-web"],
  },
  apiApps: ["core-api", "portal-api"],
  webApps: ["staff-web", "portal-web"],

  /** The only code both zones share. It holds data shapes, never behaviour that touches data. */
  contracts: {
    packageName: "@minesup/contracts",
    allowedExternal: ["zod"],
  },

  /** Node modules that application code must never load. */
  forbiddenBuiltins: ["child_process", "vm", "cluster", "repl", "inspector", "wasi"],

  /** The domain and application layers stay free of external libraries and Node modules. */
  pureLayerAllowedExternal: [] as readonly string[],

  /**
   * Network access. The staff application only ever calls out (to the portal and to the mail
   * relay); nothing may reach into it. Code that opens or uses a network connection is therefore
   * limited to a few places.
   */
  egress: {
    builtins: ["http", "https", "http2", "net", "tls", "dgram", "dns"],
    packages: ["axios", "got", "node-fetch", "undici", "ky", "superagent", "nodemailer", "ws", "fastify", "express"],
    globals: ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"],
    allowedPaths: {
      "core-api": [
        /^apps\/core-api\/src\/main\.ts$/,
        /^apps\/core-api\/src\/kernel\/(http|net)\//,
        /^apps\/core-api\/src\/modules\/(sync|notifications)\/internal\/infrastructure\//,
      ],
      "portal-api": [
        /^apps\/portal-api\/src\/main\.ts$/,
        /^apps\/portal-api\/src\/kernel\/(http|net)\//,
        /^apps\/portal-api\/src\/modules\/(sync|student-portal)\/internal\/infrastructure\//,
      ],
    } as Readonly<Record<string, readonly RegExp[]>>,
  },

  /** Database drivers appear only where data access lives. */
  database: {
    drivers: ["pg", "pg-pool", "postgres", "slonik", "kysely", "knex", "drizzle-orm", "sequelize", "typeorm", "@prisma/client", "mikro-orm"],
    allowedPaths: [/^apps\/[^/]+\/src\/modules\/[^/]+\/internal\/infrastructure\//, /^apps\/[^/]+\/src\/kernel\/db\//],
    /** Schemas that every module may use besides its own (owned by the kernel). */
    sharedSchemas: ["platform"],
  },

  /** Where configuration may be read from the environment. */
  processEnvAllowedPaths: [/^apps\/[^/]+\/src\/kernel\/config\//, /^apps\/[^/]+\/src\/main\.ts$/],

  /** Scopes accepted in pull request titles, besides the module codes. */
  extraCommitScopes: ["fn", "pl", "qs", "dt", "dp", "repo", "deps", "docs"],
} as const;

export function modulesOf(app: string): PlannedModule[] {
  return plannedModules.filter((planned) => planned.app === app);
}
