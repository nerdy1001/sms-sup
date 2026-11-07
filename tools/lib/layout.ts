export type Layer = "domain" | "application" | "infrastructure" | "http";

export const LAYERS: readonly Layer[] = ["domain", "application", "infrastructure", "http"];

export type Where =
  | {
      readonly kind: "module";
      readonly app: string;
      readonly module: string;
      readonly layer: Layer | "root" | "other";
      readonly test: boolean;
    }
  | { readonly kind: "kernel"; readonly app: string; readonly test: boolean }
  | { readonly kind: "app"; readonly app: string; readonly test: boolean }
  | { readonly kind: "package"; readonly name: string; readonly test: boolean }
  | { readonly kind: "tools"; readonly test: boolean }
  | { readonly kind: "other"; readonly test: boolean };

const MODULE_PATH = /^apps\/([^/]+)\/src\/modules\/([^/]+)\/(.*)$/;
const KERNEL_PATH = /^apps\/([^/]+)\/src\/kernel\//;
const APP_PATH = /^apps\/([^/]+)\/src\//;
const PACKAGE_PATH = /^packages\/([^/]+)\/src\//;

/**
 * Test files: `*.test.ts` (run by node:test), `*.spec.ts` and `*.spec.tsx` (run by vitest in the web
 * applications, whose `*.test.ts` pattern belongs to node:test), and the helpers that tests share, which
 * live in a folder called test-support.
 */
export function isTestFile(file: string): boolean {
  return /\.(test\.tsx?|spec\.tsx?)$/.test(file) || /(^|\/)test-support\//.test(file);
}

export function locate(file: string): Where {
  const test = isTestFile(file);
  const inModule = MODULE_PATH.exec(file);
  if (inModule !== null) {
    const [, app = "", module = "", rest = ""] = inModule;
    const layerMatch = /^internal\/([^/]+)\//.exec(rest);
    let layer: Layer | "root" | "other" = "other";
    if (!rest.includes("/")) {
      layer = "root";
    } else if (layerMatch !== null) {
      const name = layerMatch[1] ?? "";
      layer = (LAYERS as readonly string[]).includes(name) ? (name as Layer) : "other";
    }
    return { kind: "module", app, module, layer, test };
  }
  const inKernel = KERNEL_PATH.exec(file);
  if (inKernel !== null) return { kind: "kernel", app: inKernel[1] ?? "", test };
  const inApp = APP_PATH.exec(file);
  if (inApp !== null) return { kind: "app", app: inApp[1] ?? "", test };
  const inPackage = PACKAGE_PATH.exec(file);
  if (inPackage !== null) return { kind: "package", name: inPackage[1] ?? "", test };
  if (file.startsWith("tools/")) return { kind: "tools", test };
  return { kind: "other", test };
}

export function snakeCase(kebab: string): string {
  return kebab.replaceAll("-", "_");
}

export function pascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
