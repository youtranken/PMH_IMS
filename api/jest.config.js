/**
 * Cấu hình test API (Jest + ts-jest). Test đơn vị: *.spec.ts cạnh file nguồn.
 *
 * ===== MÚI GIỜ GHIM CỨNG, KHÔNG LẤY CỦA MÁY (24/09/2026) =====
 *
 * Đặt ngay tại đây chứ không qua `setupFiles`: Node ghi nhớ múi giờ ở lần dùng `Date` ĐẦU
 * TIÊN, nên một setup file chạy sau khi framework đã đụng `Date` sẽ đặt hụt. File cấu hình
 * này được nạp trước mọi thứ khác.
 *
 * Vì sao cần: tầng sản phẩm đã ghim giờ VN ở mọi nơi (`docker-compose.yml`, `app.timezone`
 * qua `isoDateInTz()`, `AT TIME ZONE` trong SQL nhật ký), chỉ tầng chạy bài kiểm là còn lấy
 * giờ của máy. Máy dev ở VN và máy chủ CI Ubuntu mặc định UTC sẽ cho hai kết quả khác nhau
 * trên cùng một commit — và kiểu hỏng tệ hơn là kiểu XANH: bài chạy ở UTC thôi không còn
 * chạm vào logic ngày-địa-phương mà `today.ts` sinh ra để canh. Nó không đỏ, nó ngừng canh.
 *
 * `api/src/common/today.spec.ts` ghi lại lần ĐẦU repo này dính bẫy ấy: *"lỗi thật E2E story
 * 3.4 bắt được: chạy lúc 6 giờ sáng giờ VN, UTC vẫn là hôm qua"*.
 */
process.env.TZ = 'Asia/Ho_Chi_Minh';

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
