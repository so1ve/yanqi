import { so1ve } from "@so1ve/eslint-config";

export default so1ve(
  {
    vue: true,
    ignores: [
      "**/.devenv/**",
      "**/.direnv/**",
      "**/.nuxt/**",
      "**/.output/**",
      "data/**",
    ],
    typescript: {
      overrides: {
        // Empty names, titles and URLs intentionally fall back to another string.
        "ts/prefer-nullish-coalescing": [
          "error",
          { ignorePrimitives: { string: true } },
        ],
      },
    },
  },
  {
    files: ["**/*.mjs"],
    rules: {
      // JavaScript 已有原生 no-unused-vars 检查，避免 TypeScript 规则误报。
      "unused-imports/no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.mjs"],
    rules: {
      "style/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        {
          blankLine: "any",
          prev: ["const", "let", "var"],
          next: ["const", "let", "var"],
        },
        { blankLine: "always", prev: "block-like", next: "*" },
        {
          blankLine: "always",
          prev: "*",
          next: ["return", "throw", "continue", "break", "debugger"],
        },
      ],
    },
  },
);
