/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  // Les tests utilisent les sources du package partagé, sans build préalable.
  moduleNameMapper: {
    '^@ticketing/shared$': '<rootDir>/../../packages/shared/src',
  },
  testTimeout: 20000,
};
