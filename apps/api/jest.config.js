/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // cookie@2 (dépendance de fastify.inject) n'est publié qu'en ESM : on le compile en CommonJS pour Jest.
    '^.+/node_modules/cookie/.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true }, diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!cookie/)'],
  // Les tests utilisent les sources du package partagé, sans build préalable.
  moduleNameMapper: {
    '^@ticketing/shared$': '<rootDir>/../../packages/shared/src',
  },
  testTimeout: 20000,
};
