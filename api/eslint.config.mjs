// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import ad2 from './ad2-boundary.js';

/**
 * ===== AD-2 — ranh giới module, ép bằng máy =====
 *
 * Luật khớp trên CHUỖI IMPORT NHƯ NGƯỜI TA GÕ (`'../users/users.service'`), không phải trên
 * đường dẫn đã resolve. Bản trước viết `group: ['**\/modules\/*\/[!(index|*.api)]*']` và
 * khớp đúng SỐ KHÔNG chuỗi, vì hai lý do cộng dồn:
 *   1. không import nào trong repo chứa đoạn `modules/` — tất cả đều là đường dẫn tương đối;
 *   2. `[!(index|*.api)]` là LỚP KÝ TỰ PHỦ ĐỊNH của glob, không phải extglob `!(...)`.
 * Cộng thêm `allowTypeImports: true` thì mọi `import type` xuyên ruột module đều hợp lệ.
 * Kết quả: hàng rào AD-2 chết âm thầm suốt 9 epic. Xem `docs/CODE-REVIEW-2026-08-28.md` (M1).
 *
 * Vì sao regex chứ không glob: cần "khớp X TRỪ danh sách Y", mà glob của `no-restricted-imports`
 * không diễn đạt được. Mọi ngoại lệ là ngoại lệ VIẾT RA GIẤY trong `ad2-boundary.js` — thêm
 * một cái là phải sửa file đó, tức là phải giải thích trong PR.
 *
 * Biểu thức nằm ở `./ad2-boundary.js` để `src/ad2-boundary.spec.ts` kiểm được nó CÒN BẮT.
 */

/**
 * @param {{ crossModule?: boolean, extraExceptions?: string }} [opts]
 *   `crossModule: false` → chỉ giữ các luật cấm thư viện (dùng cho composition root
 *   `main.ts`/`worker.ts`/`health`, nơi việc đấu dây mọi module là NHIỆM VỤ chứ không phải
 *   vi phạm; ranh giới `common → modules` do dependency-cruiser canh).
 */
function ad2Rule(opts = {}) {
  const { crossModule = true, extraExceptions = '' } = opts;
  return /** @type {const} */ ([
    'error',
    {
      paths: [
        {
          name: 'exceljs',
          message:
            'AD-15: không import exceljs trực tiếp. Dùng ExcelExportService (src/common/excel).',
        },
        {
          name: 'nodemailer',
          message:
            'AD-5/AD-15: không gửi mail trong request. Ghi outbox; MailTransportService là nơi duy nhất chạm nodemailer.',
        },
        {
          name: '@node-rs/argon2',
          message: 'AD-8: băm mật khẩu chỉ qua PasswordService.',
        },
        {
          name: 'node:crypto',
          importNames: ['createCipheriv', 'createDecipheriv'],
          message: 'NFR-02/AD-15: mã hóa/giải mã chỉ qua EnvelopeCryptoService.',
        },
        {
          name: 'crypto',
          importNames: ['createCipheriv', 'createDecipheriv'],
          message: 'NFR-02/AD-15: mã hóa/giải mã chỉ qua EnvelopeCryptoService.',
        },
      ],
      patterns: crossModule
        ? [{ regex: ad2.ad2PatternSource(extraExceptions), message: ad2.AD2_MESSAGE }]
        : [],
    },
  ]);
}

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'ad2-boundary.js',
      'jest.config.js',
      '.dependency-cruiser.cjs',
      'dist/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  {
    // ===== AD-2/AD-15: chặn "làm riêng lẻ" ngay ở CI, không trông vào review =====
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ad2Rule({ crossModule: false }),
      'no-restricted-syntax': [
        'error',
        {
          // `callee.name` chỉ có với lời gọi TRẦN. `crypto.createCipheriv(...)` là
          // MemberExpression nên bản cũ để lọt đúng cách viết phổ biến nhất. Bắt cả hai dạng.
          selector:
            "CallExpression[callee.name=/^create(?:De)?cipheriv$/], CallExpression[callee.property.name=/^create(?:De)?cipheriv$/]",
          message:
            'NFR-02/AD-15: mã hóa/giải mã chỉ qua EnvelopeCryptoService — không tự gọi createCipheriv/createDecipheriv.',
        },
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env'] > Identifier[name=/^(MASTER_KEY|PASSWORD_PEPPER|SMTP_PASSWORD)$/]",
          message: 'AD-11: bí mật đọc từ file docker secret, không từ env.',
        },
      ],
    },
  },
  {
    // AD-2 chỉ áp cho module ↔ module. Đây là nơi luật thật sự có hiệu lực.
    files: ['src/modules/**/*.ts'],
    rules: { 'no-restricted-imports': ad2Rule() },
  },
  {
    /**
     * NGOẠI LỆ DUY NHẤT của AD-2, có chủ đích: `auth` và `users` là MỘT chủ sở hữu của bảng
     * `users` theo AD-3 (spine gộp hai module này). `auth` cần `UsersService` để xác thực và
     * `usersTable` để khai `sessions.schema`. Chiều ngược lại (`users` → `auth`) chỉ được lấy
     * kiểu, và đã nằm trong cửa `*.types.ts`.
     *
     * Nếu có ngày tách hẳn hai module, xóa khối này trước rồi mới sửa code.
     */
    files: ['src/modules/auth/**/*.ts'],
    rules: {
      'no-restricted-imports': ad2Rule({ extraExceptions: ad2.AUTH_USERS_EXCEPTION }),
    },
  },
  {
    // Nơi DUY NHẤT được phép chạm nguyên thủy tương ứng.
    files: [
      'src/common/crypto/**/*.ts',
      'src/common/excel/**/*.ts',
      'src/modules/mail/mail-transport.service.ts',
      'src/modules/auth/password.service.ts',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
