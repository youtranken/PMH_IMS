/**
 * Cấu hình cho TẦNG TEST CHẠM DB THẬT — tách hẳn khỏi `jest.config.js`.
 *
 * Hai lý do phải tách, không phải chuyện gọn gàng:
 *
 * 1. `jest.config.js` có `rootDir: 'src'`, nên `npm test` (và GitHub Actions) KHÔNG BAO GIỜ
 *    nhặt phải thư mục này. Tầng DB cần một Postgres đang sống; để nó lọt vào cổng CI là biến
 *    một cổng đang xanh thành một cổng đỏ vì lý do chẳng liên quan gì tới code vừa sửa.
 *
 * 2. `--runInBand` (đặt trong script `test:db`): mỗi file tự tạo rồi xóa một DATABASE riêng,
 *    chạy song song thì chúng tranh nhau kết nối tới DB `postgres` quản trị.
 *
 * Chạy: `npm --prefix api run test:db`
 * Cần:  `docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml up -d postgres`
 *       (override mở cổng 127.0.0.1:55432 — compose gốc cố ý không publish, NFR-04).
 *
 * File `.cjs` chứ không `.json` vì JSON không chứa được đoạn giải thích ở trên, và script
 * `test:db` trong package.json đã trỏ vào một file KHÔNG TỒN TẠI suốt từ lúc được khai.
 */
module.exports = {
  rootDir: '..',
  testRegex: 'test/.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testTimeout: 60000,
  transform: {
    '^.+\\.(t|j)s$': [
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
  // Cùng lý do với `jest.config.js`: otplib 13 + @scure ship ESM, bài nào chạm TotpService cần transform.
  transformIgnorePatterns: ['node_modules/(?!(otplib|@otplib|@scure|@noble)/)'],
};
