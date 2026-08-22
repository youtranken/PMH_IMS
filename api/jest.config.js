/** Cấu hình test API (Jest + ts-jest). Test đơn vị: *.spec.ts cạnh file nguồn. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.(t|j)s$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          resolvePackageJsonExports: false,
          esModuleInterop: true,
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
          target: 'ES2023',
        },
      },
    ],
  },
  // otplib 13 + @scure ship ESM/TS nguồn → phải cho ts-jest transform, không bỏ qua như node_modules khác.
  transformIgnorePatterns: ['node_modules/(?!(otplib|@otplib|@scure|@noble)/)'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
