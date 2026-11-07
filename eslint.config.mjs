import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * ESLint finds mistakes that the repository checks (tools/checks) do not look for: unused variables,
 * promises that nobody waits for, wrong use of React hooks. The repository checks keep their own rules
 * (architecture, security, coding standards); this file does not repeat them. Formatting belongs to
 * Prettier alone, so the last entry switches off every ESLint rule that would argue about layout.
 */
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "eslint.config.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Fastify plugins and test callbacks must be async by their type even when they never wait.
      "@typescript-eslint/require-await": "off",
      // A parameter or variable that starts with an underscore is unused on purpose.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // A promise that is deliberately not awaited is marked with `void`. The test runner collects the
      // promises of test() and describe() by itself, so those calls are not reported.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreVoid: true,
          allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "it", "describe", "suite"] }],
        },
      ],
    },
  },
  {
    files: ["apps/staff-web/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
  prettier,
);
