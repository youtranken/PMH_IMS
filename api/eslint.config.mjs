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
/**
 * AD-16 — TÊN ĐỊNH DANH PHẢI LÀ TIẾNG ANH.
 *
 * Tiếng Việt chỉ ở: chú thích, mô tả `describe`/`it`/`test`, và BẢNG ÁNH XẠ NHÃN NHẬP-EXCEL
 * (`devices/device-import.ts`, `catalog/catalog-import.ts`) — ở đó chuỗi tiếng Việt là DỮ
 * LIỆU người dùng gõ vào file, đổi là hỏng chức năng nhập.
 *
 * LỚP NÀY CHỈ BẮT ĐỊNH DANH **CÓ DẤU**. Tiếng Việt không dấu cần một từ điển ~900 âm tiết —
 * đó là lớp hai, làm cùng đợt đổi tên. Xem mục 3.4 của
 * `docs/RA-SOAT-TOAN-DIEN-2026-09-19.md`.
 */
const NO_VIETNAMESE_IDENT = /** @type {const} */ ({
  selector: 'Identifier[name=/[À-ỹ]/]',
  message:
    'AD-16: tên định danh phải là tiếng Anh. Tiếng Việt chỉ ở chú thích, mô tả bài kiểm ' +
    'và bảng ánh xạ nhãn nhập-Excel.',
});
/**
 * MỘT danh sách luật cú pháp, khai đúng một lần — và các khối ngoại lệ BỚT ĐI từ nó.
 *
 * Trước 21/09 mỗi khối tự liệt kê lại từng phần tử, và khối ngoại lệ `audit` (cuối file) vì
 * thế đánh rơi BA luật trong khi chú thích của chính nó nói là bỏ một: AD-16, NFR-04
 * (`NO_RAW_ERROR_MESSAGE_IN_LOG`) và `NO_BEST_EFFORT_AUDIT` — mà `audit.interceptor.ts` lại
 * đúng là nơi ghi log lỗi, tức nơi NFR-04 cần nhất.
 *
 * Liệt kê tay thì thêm một luật mới phải nhớ thêm vào N chỗ, và chỗ quên được sẽ im lặng.
 * `filter` thì ngoại lệ tự nói ra nó bỏ CÁI GÌ, và luật mới tự động áp cho mọi khối.
 */
const SYNTAX_RULES_FOR_SOURCE = () => [
  ...RESTRICTED_SYNTAX,
  NO_BEST_EFFORT_AUDIT,
  NO_RAW_ERROR_MESSAGE_IN_LOG,
  NO_VIETNAMESE_IDENT,
];

const NO_BEST_EFFORT_AUDIT = /** @type {const} */ ({
  selector: "CallExpression[callee.property.name='appendBestEffort']",
  message:
    'NFR-03: appendBestEffort nuốt lỗi ghi audit — chỉ AuditInterceptor được dùng (dòng audit ở đó nằm SAU một mutation đã commit). Nơi khác dùng appendWithin trong transaction nghiệp vụ.',
});

/**
 * NFR-04: cấm nhét `.message` của một lỗi thẳng vào dòng log.
 *
 * ===== LỖ ĐÃ ĐÓNG NGÀY 11/09 =====
 *
 * drizzle ≥0.36 ném `DrizzleQueryError`, và `.message` của nó là
 * `Failed query: <sql>\nparams: <THAM SỐ ĐÃ BIND>`. Một câu INSERT vào `users` hỏng vì bất kỳ
 * ràng buộc nào sẽ in nguyên hash Argon2, ciphertext TOTP secret, email, họ tên, số điện
 * thoại vào `docker logs` — ngoài ranh giới PII mà NFR-04/AD-4 dựng quanh DB. Không ai phải
 * cố ý làm gì.
 *
 * `common/log-redact.ts` sinh ra đúng để chặn chuyện đó, nhưng tới 11/09 nó được gọi ở ĐÚNG
 * MỘT chỗ (`GlobalExceptionFilter`), còn 13 chỗ khác vẫn viết `(error as Error).message`.
 * Vá 13 chỗ đó chỉ mua được thời gian tới chỗ thứ 14 — nên hàng rào phải nằm ở CỔNG.
 *
 * Selector nhắm đúng hình dạng đã gặp: một `.message` nằm trong chuỗi mẫu, bên trong lời gọi
 * `logger.log/warn/error/debug/verbose`. Hẹp có chủ ý — cấm mọi `.message` ở mọi nơi thì lập
 * tức thành luật bị tắt.
 */
const NO_RAW_ERROR_MESSAGE_IN_LOG = /** @type {const} */ ({
  selector:
    "CallExpression[callee.property.name=/^(log|warn|error|debug|verbose)$/] TemplateLiteral MemberExpression[property.name='message']",
  message:
    'NFR-04: đừng ghi `.message` của lỗi ra log — `DrizzleQueryError.message` chở cả THAM SỐ ĐÃ BIND (hash Argon2, ciphertext TOTP, email, họ tên). Dùng `redactMessage(error)` của `common/log-redact.ts`.',
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
    /*
     * `test/**` có trong danh sách từ 21/09. Trước đó khối này chỉ khai `src/**`, nên CẢ TẦNG
     * bài kiểm chạm DB chưa bao giờ được AD-16 soi — đúng tầng mà đợt B vừa mở thêm file mới.
     * Vùng mù ấy vô hình vì không bài nào canh chính cái cổng; nay có:
     * `src/ad16-gate.lint.spec.ts`.
     *
     * `no-restricted-imports` (AD-2) cũng áp theo ở đây, nhưng khối `test/**` phía dưới đã
     * tắt nó có chủ ý — bài kiểm được phép import xuyên module. Thứ tự khối lo việc đó.
     */
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-restricted-imports': ad2Rule({ crossModule: false }),
      'no-restricted-syntax': ['error', ...SYNTAX_RULES_FOR_SOURCE()],
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
     * KÉT SẮT được phép chạm `auth/step-up.guard` + `auth/session-policy`.
     *
     * Step-up (FR-022) chỉ tồn tại vì két sắt, và két sắt là nơi duy nhất dùng nó. Hai file
     * này TỪNG nằm trong `INFRA_PRIMITIVES` — một danh sách toàn cục mở cửa cho mọi module —
     * và đó là sai hình dạng: module thứ ba bắt đầu dùng chúng sẽ không ai thấy. Ở đây thì
     * thấy ngay, vì lint đỏ.
     */
    files: ['src/modules/vault/**/*.ts'],
    rules: {
      'no-restricted-imports': ad2Rule({ extraExceptions: ad2.VAULT_STEPUP_EXCEPTION }),
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
     *
     * SỬA 21/09: câu trên mô tả ĐÚNG ý định và SAI thực tế. Khối này từng viết
     * `[...RESTRICTED_SYNTAX]`, tức đánh rơi BA luật chứ không một: `NO_BEST_EFFORT_AUDIT`
     * (cố ý), nhưng kèm cả AD-16 và NFR-04 — mà `audit.interceptor.ts` chính là nơi ghi log
     * lỗi, tức nơi NFR-04 cần nhất. Đó là hình dạng mà chính chú thích này cảnh báo, xảy ra
     * ngay trong chú thích cảnh báo nó: một luật thêm vào khối `src/**` về sau không có cách
     * nào tự đi vào đây.
     *
     * Nay ngoại lệ BỚT ĐI từ danh sách chung thay vì chép lại nó, nên nó chỉ bỏ được đúng
     * thứ nó gọi tên, và luật mới tự động áp.
     */
    files: [
      'src/modules/audit/audit.interceptor.ts',
      'src/modules/audit/audit-writer.service.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...SYNTAX_RULES_FOR_SOURCE().filter((rule) => rule !== NO_BEST_EFFORT_AUDIT),
      ],
    },
  },
);
