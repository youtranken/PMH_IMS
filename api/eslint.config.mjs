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
/** Luật cấm cú pháp áp cho MỌI file `src/` — tách ra const để chỗ ngoại lệ dùng lại được. */
const RESTRICTED_SYNTAX = /** @type {const} */ ([
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
]);

/**
 * NFR-03 — `appendBestEffort` nuốt lỗi ghi audit, nên nó chỉ được tồn tại ở ĐÚNG MỘT nơi.
 *
 * Rà soát 07/09 (#4): trước 08/09 chỉ có một hàm `append()` và nó bọc `try/catch` chỉ log rồi
 * đi tiếp. Vì mọi nơi dùng chung hàm đó, `vault.reveal()` — writer DUY NHẤT của đường mở két,
 * do controller khai `writtenByService: true` — cũng nuốt lỗi: INSERT hỏng thì plaintext vẫn
 * ra và vết chỉ còn một dòng log container.
 *
 * Bản sửa tách ba hàm và ghi rõ trong chú thích rằng chỉ interceptor được dùng bản nuốt lỗi.
 * Chú thích không phải hàng rào: người viết đường ghi thứ 63 sẽ chọn hàm không làm mình gãy,
 * và hỏng lại đúng như cũ — im lặng. Nên luật này ép bằng máy, đúng nếp `docs/SHARED-REGISTRY.md`
 * mục "Cách CI ép luật (không trông vào review)".
 *
 * Đường ghi mới cần audit thì dùng `appendWithin` trong chính transaction nghiệp vụ, kèm
 * `@Audited(..., { writtenByService: true })`.
 */
const NO_BEST_EFFORT_AUDIT = /** @type {const} */ ({
  selector: "CallExpression[callee.property.name='appendBestEffort']",
  message:
    'NFR-03: appendBestEffort nuốt lỗi ghi audit — chỉ AuditInterceptor được dùng (dòng audit ở đó nằm SAU một mutation đã commit). Nơi khác dùng appendWithin trong transaction nghiệp vụ.',
});

/**
 * @param {{ crossModule?: boolean, extraExceptions?: string, allowLibraries?: string[] }} [opts]
 *   `allowLibraries` — BỎ đúng vài thư viện khỏi danh sách cấm mà GIỮ NGUYÊN AD-2.
 *
 *   Trước 08/09, hai file được phép chạm nguyên thủy (`mail-transport.service.ts` với
 *   `nodemailer`, `password.service.ts` với `@node-rs/argon2`) được miễn bằng
 *   `'no-restricted-imports': 'off'`. Nhưng luật đó chở CẢ danh sách thư viện cấm LẪN biểu
 *   thức AD-2, nên `'off'` tắt luôn ranh giới module cho hai file nằm giữa `src/modules/` —
 *   trong đó có lõi bảo mật. Rà soát 07/09 #9. Cùng hình dạng đã sửa ở đợt B cho
 *   `appendBestEffort`: ngoại lệ phải khai lại luật mà BỚT đúng một mục.
 */
function ad2Rule(opts = {}) {
  const { crossModule = true, extraExceptions = '', allowLibraries = [] } = opts;
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
      ].filter((entry) => !allowLibraries.includes(entry.name)),
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
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX, NO_BEST_EFFORT_AUDIT],
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
    /**
     * Nơi DUY NHẤT được phép chạm nguyên thủy mã hóa / xuất Excel.
     *
     * `'off'` chỉ an toàn ở ĐÂY vì `src/common/**` nằm ngoài `src/modules/**`, nên AD-2 vốn
     * không áp cho chúng (ranh giới `common → modules` do dependency-cruiser canh).
     */
    files: ['src/common/crypto/**/*.ts', 'src/common/excel/**/*.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    /**
     * Hai file trong `src/modules/` được phép chạm nguyên thủy — nhưng CHỈ nguyên thủy của
     * chúng, KHÔNG kèm giấy phép bỏ qua AD-2.
     *
     * Bản trước gộp chung với khối trên và dùng `'off'`. `no-restricted-imports` chở cả danh
     * sách thư viện cấm lẫn biểu thức AD-2, nên `password.service.ts` (lõi bảo mật) và
     * `mail-transport.service.ts` được phép import thẳng ruột mọi module khác — vĩnh viễn,
     * không ai thấy. Rà soát 07/09 #9; canh bằng `src/ad2-gate.lint.spec.ts`.
     *
     * `no-restricted-syntax` KHÔNG còn được tắt: cả hai file đọc `SMTP_HOST/PORT/USER` và
     * `readSecretFile`, không đọc `SMTP_PASSWORD` từ env và không gọi `createCipheriv` — tức
     * là chúng chưa bao giờ cần miễn luật đó.
     */
    files: ['src/modules/mail/mail-transport.service.ts'],
    rules: { 'no-restricted-imports': ad2Rule({ allowLibraries: ['nodemailer'] }) },
  },
  {
    files: ['src/modules/auth/password.service.ts'],
    rules: {
      'no-restricted-imports': ad2Rule({
        allowLibraries: ['@node-rs/argon2'],
        // `password.service` nằm trong module auth → giữ luôn ngoại lệ auth↔users (AD-3).
        extraExceptions: ad2.AUTH_USERS_EXCEPTION,
      }),
    },
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
  {
    /**
     * HAI nơi duy nhất được gọi `appendBestEffort` — xem `NO_BEST_EFFORT_AUDIT` phía trên:
     *   - interceptor: nơi dùng thật, vì dòng audit ở đó nằm SAU một mutation đã commit;
     *   - spec của chính writer: phải gọi được thì mới chứng minh nó nuốt lỗi.
     *
     * Khối này khai lại `no-restricted-syntax` KHÔNG kèm luật đó, chứ không tắt cả rule: tắt
     * hẳn thì hai file này cũng thoát luôn luật cấm `createCipheriv` và luật cấm đọc bí mật từ
     * `process.env` — mở một lỗ chẳng ai định mở.
     */
    files: [
      'src/modules/audit/audit.interceptor.ts',
      'src/modules/audit/audit-writer.service.spec.ts',
    ],
    rules: { 'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX] },
  },
);
