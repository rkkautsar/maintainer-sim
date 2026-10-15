import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["src/generated/**"] },
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
);
