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
    // PM2 loads its ecosystem file with require(), so this one is CommonJS by
    // necessity rather than by preference — the ESM rules do not apply to it.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The address computation itself, plus tests.
    //
    // Exempting tests does not weaken the guarantee: the rule exists to stop
    // production code from naming a destination, and a literal in a test cannot
    // move a write — it can only assert where one landed. The write-target
    // integrity tests are required to name "human" and "notes", since proving
    // the address is constant is the whole point of them.
    files: ["apps/gateway/src/palace/noteTarget.ts", "**/*.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
