import { so1ve } from "@so1ve/eslint-config";

export default so1ve(
  {
    test: false,
    ignores: ["**/.devenv/**", "**/.direnv/**"],
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
