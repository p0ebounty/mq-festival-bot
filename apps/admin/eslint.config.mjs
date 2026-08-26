import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Требование заказчика: никаких браузерных выпадающих списков,
    // подтверждений и валидаций. См. .claude/rules/30-admin-ui.md
    // Правило существует, чтобы требование нельзя было нарушить случайно.
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "alert", message: "Используй toast() из sonner." },
        { name: "confirm", message: "Используй <AlertDialog> из shadcn/ui." },
        { name: "prompt", message: "Используй модалку с формой." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]",
          message: "Браузерные диалоги запрещены — используй компоненты shadcn/ui.",
        },
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message: "Нативный <select> запрещён — используй <Select> из shadcn/ui.",
        },
        {
          selector: 'JSXAttribute[name.name="type"][value.value="number"]',
          message:
            'input[type=number] даёт нативные стрелки и валидацию — используй inputMode="numeric".',
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "e2e/**"]),
]);

export default eslintConfig;
