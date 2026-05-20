module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  ignorePatterns: ['dist/', 'build/', 'coverage/', 'node_modules/'],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-explicit-any': 'off'
  }
};
