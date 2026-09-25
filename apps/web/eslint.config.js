//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
      // Runtime-necessary guards (e.g. `if (!row)` after drizzle `.limit(1)`
      // destructuring, optional chaining on zod-inferred optionals) are typed
      // as non-nullable by TS, so this rule reports them as dead code. The
      // guards are real; disable rather than weaken them.
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    ignores: ["eslint.config.js", ".prettierrc"],
  },
]
