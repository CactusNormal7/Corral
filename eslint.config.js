import js from "@eslint/js";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";

export default tseslint.config(
  { ignores: ["out/**", "dist/**", "node_modules/**", "release/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] },
    },
    rules: {
      // Les composants n'ont qu'une racine quand c'est utile ; le bandeau d'env
      // vit au-dessus du contenu dans WorkerView.
      "vue/multi-word-component-names": "off",
      "vue/attributes-order": "off",
      // Mise en forme : c'est Prettier qui l'impose, pas ESLint, sinon les deux
      // outils se contredisent sur les mêmes lignes.
      "vue/max-attributes-per-line": "off",
      "vue/html-indent": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/html-self-closing": "off",
      "vue/first-attribute-linebreak": "off",
      // Les lignes de log sont préformatées : un retour à la ligne autour de
      // l'interpolation ajouterait des espaces visibles dans la sortie.
      "vue/multiline-html-element-content-newline": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
