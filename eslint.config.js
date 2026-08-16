import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // The invariant, enforced mechanically: nothing outside the gateway's
          // note writer may name a hall or a room. See .agents/WORKFLOW.md.
          selector:
            "Property[key.name=/^(hall|room|wing)$/] > Literal[value=/^(human|notes)$/]",
          message:
            "Hall/room literals belong only in apps/gateway/src/palace/noteTarget.ts — the write address is computed there and nowhere else.",
        },
      ],
    },
  },
  {
    // The address computation itself, and the tests that pin it down — those
    // tests exist precisely to assert the literal values, so the rule would be
    // asserting against its own guard.
    files: [
      "apps/gateway/src/palace/noteTarget.ts",
      "apps/gateway/src/palace/noteTarget.test.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
);
