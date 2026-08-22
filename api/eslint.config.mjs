// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'jest.config.js', '.dependency-cruiser.cjs', 'dist/**'],
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
    // ===== AD-15: chặn "làm riêng lẻ" ngay ở CI, không trông vào review =====
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
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
          ],
          patterns: [
            {
              group: ['**/modules/*/[!(index|*.api)]*'],
              message:
                'AD-2: chỉ được import `*.api.ts` của module khác. Không chạm file nội bộ.',
              allowTypeImports: true,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.name='Cipheriv'], CallExpression[callee.name='createCipheriv']",
          message:
            'NFR-02/AD-15: mã hóa chỉ qua EnvelopeCryptoService — không tự gọi createCipheriv.',
        },
        {
          selector: "CallExpression[callee.name='createDecipheriv']",
          message: 'NFR-02/AD-15: giải mã chỉ qua EnvelopeCryptoService.',
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
