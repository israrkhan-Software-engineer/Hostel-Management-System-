module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/coverage/'],
  moduleNameMapper: {
    '^@prisma/client$': '<rootDir>/node_modules/.prisma/client/index.js',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: true }],
  },
  testTimeout: 30000,
};