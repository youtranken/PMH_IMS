// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * ===== Cổng lint của web =====
 *
 * VÌ SAO LÀ ESLINT CHỨ KHÔNG PHẢI OXLINT (quyết định 07/09).
 *
 * `oxlint` vào `web/package.json` từ Epic 1 (`f728245`) cùng lúc dựng khung web, và chạy rule
 * mặc định không có file cấu hình cho tới 28/08. Nó nhanh hơn ESLint rất nhiều — nhưng nó
 * **không có cùng bộ rule**, và điều đó đã cắn thật:
 *
 *   luật cấm `window.confirm` viết bằng `no-restricted-syntax` (đúng cú pháp mà
 *   `api/eslint.config.mjs` đang dùng cho `crypto.createCipheriv`) → oxlint trả về
 *   `Rule 'no-restricted-syntax' not found in plugin 'eslint'`.
 *
 * Hệ quả là một luật viết đúng ở api là luật CHẾT ở web, và ngược lại — đúng lớp lỗi mà cả hai
 * đợt rà soát 28/08 và 07/09 đều gọi tên ("cổng khớp 0 chuỗi"). Với hai phương ngữ thì mỗi luật
 * phải viết hai lần theo hai cách, và không có gì báo khi bản thứ hai viết sai.
 *
 * Nên: MỘT phương ngữ cho cả repo. Luật ở đây copy sang api được và ngược lại.
 * Ranh giới ở mức ĐƯỜNG DẪN ĐÃ RESOLVE do `.dependency-cruiser.cjs` canh — cùng cách api làm.
 *
 * Cổng này được canh ngược bởi `src/lint-rules.test.ts`: bài đó chạy thẳng eslint trên file
 * probe và chốt rằng luật BẮT ĐƯỢC thứ nó phải bắt. Không có bài đó thì không gì cho biết
 * luật đã chết.
 */

/** Các mục ngoại lệ dưới đây là ngoại lệ VIẾT RA GIẤY — thêm một cái là phải giải thích trong PR. */
const CROSS_FEATURE_EXCEPTIONS = [
  '!@/features/software/device-licenses-expand',
  /* Hộp "Cấp IP" mở từ trang thiết bị: luật cấp IP là của ipam, trang thiết bị chỉ nhúng vào
     (cùng lý do với khu license ở trên). */
  '!@/features/ipam/device-ip-assign',
  '!@/features/catalog/catalog-form',
  '!@/features/devices/device-form',
];

/**
 * AD-16 — TÊN ĐỊNH DANH PHẢI LÀ TIẾNG ANH.
 *
 * Tiếng Việt chỉ ở: giá trị chuỗi i18n (`src/locales/vi.ts`), chú thích, mô tả
 * `describe`/`it`/`test`, và bảng ánh xạ nhãn nhập-Excel bên api. Tên hàm/biến/hằng/kiểu thì
 * không — đó là thứ lập trình viên, log và công cụ đọc.
 *
 * LỚP NÀY CHỈ BẮT ĐỊNH DANH **CÓ DẤU**. Phần lớn nợ hiện tại là tiếng Việt KHÔNG dấu
 * (`quetNguon`, `timVaChoLoc`, `moTimNhanh`…), và bắt được chúng cần một từ điển ~900 âm tiết
 * cộng một phép tính tỉ lệ — không nhét vừa một selector. Lớp hai là một bài điểm danh, làm
 * cùng đợt đổi tên (xem mục 3.4 của `docs/RA-SOAT-TOAN-DIEN-2026-09-19.md`).
 *
 * Dải `À-ỹ` phủ chữ Latin có dấu phụ, gồm trọn khối Latin Extended Additional nơi
 * chứa gần hết nguyên âm tiếng Việt. Không chạm tới chuỗi hay chú thích — selector `Identifier`
 * chỉ khớp TÊN.
 */
const NO_VIETNAMESE_IDENT = /** @type {const} */ ({
  selector: 'Identifier[name=/[\u00C0-\u1EF9]/]',
  message:
    'AD-16: tên định danh phải là tiếng Anh. Tiếng Việt chỉ ở GIAO DIỆN (qua lib/i18n), ' +
    'chú thích và mô tả bài kiểm. Xem docs/SHARED-REGISTRY.md.',
});
/**
 * DoD gạch 6 — CHỮ GIAO DIỆN TIẾNG VIỆT CHỈ SỐNG Ở `src/locales/vi.ts`.
 *
 * Bắt mọi chuỗi (`'…'`, `` `…` ``) và chữ JSX có ký tự tiếng Việt CÓ DẤU trong mã sản phẩm.
 * Chuỗi viết cứng thì không đổi được câu chữ ở một chỗ, `term-consistency.test.ts` không nhìn
 * thấy nó, và cùng một khái niệm lặng lẽ mang hai tên ở hai màn.
 *
 * Lớp ký tự cố ý KHÔNG dùng dải `À-ỹ` của AD-16: dải đó nuốt cả `×` (U+00D7, nút đóng toast),
 * `÷`, và khối dấu kết hợp U+0300–036F mà `lib/search-fold.ts` cần để bỏ dấu khi tìm. Ở đây chỉ
 * lấy chữ Latin có dấu dựng sẵn: Latin-1 trừ `×`/`÷`, Latin Extended-A/B, và khối
 * `Ạ-ỹ` của Latin Extended Additional.
 *
 * Ngoại lệ (xem khối `files:` bên dưới): `src/locales/**` (chính là chỗ của chữ), bài kiểm, và
 * `src/features/dev/**` (gallery linh kiện cho lập trình viên, dữ liệu mẫu ở đó là cố ý).
 * Thông báo lỗi dành cho LẬP TRÌNH VIÊN (`throw new Error(...)`) viết tiếng Anh.
 */
const VI_TEXT = '[À-ÖØ-öø-ɏẠ-ỹ]';
const VI_TEXT_MESSAGE =
  'DoD-6: chữ giao diện tiếng Việt phải nằm trong src/locales/vi.ts và đọc qua t(...). ' +
  'Hàm thuần không có t thì trả KHÓA i18n, nơi gọi dịch.';
const NO_VIETNAMESE_TEXT = /** @type {const} */ ([
  { selector: `Literal[value=/${VI_TEXT}/]`, message: VI_TEXT_MESSAGE },
  { selector: `TemplateElement[value.raw=/${VI_TEXT}/]`, message: VI_TEXT_MESSAGE },
  { selector: `JSXText[value=/${VI_TEXT}/]`, message: VI_TEXT_MESSAGE },
]);

/** Cấm `window.confirm` / `alert` / `prompt` — cả dạng trần lẫn dạng có tiền tố đối tượng. */
const NO_NATIVE_DIALOG = /** @type {const} */ ([
  'error',
  {
    selector:
      "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name=/^(confirm|alert|prompt)$/]",
    message:
      'AD-15: cấm window.confirm / alert / prompt. Dùng useConfirm() hoặc Dialog / toast của web/src/ui.',
  },
  {
    selector: "CallExpression[callee.name=/^(confirm|alert|prompt)$/]",
    message:
      'AD-15: cấm confirm / alert / prompt. Dùng useConfirm() hoặc Dialog / toast của web/src/ui.',
  },
]);

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/test/**', 'vite.config.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2024 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // `warn` chứ không `error`: rà soát 07/09 tìm thấy vài chỗ dependency thiếu thật, nhưng
      // bật `error` ngay bây giờ là chặn merge vì nợ cũ. Hạ nợ xong thì nâng lên `error`.
      'react-hooks/exhaustive-deps': 'warn',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': [...NO_NATIVE_DIALOG, NO_VIETNAMESE_IDENT],

      /*
       * `tsconfig.app.json` KHÔNG bật strict, nên compiler không ép gì. Ba luật này giữ nếp
       * mà đội đã tự giữ suốt 9 epic — nay có máy canh thay vì trông vào kỷ luật.
       *
       * `no-explicit-any` và `ban-ts-comment` để `error`: quét toàn `src/` ra ĐÚNG 0 vi phạm,
       * nên bật lên không tốn gì và khóa lại được ngay. (api tắt `no-explicit-any` vì nó dùng
       * `recommendedTypeChecked` và có chỗ chạm thư viện bên ngoài; web thì sạch, nên siết được.)
       *
       * `no-non-null-assertion` chỉ `warn`: quét ra **20 chỗ đang dùng `!`** — nợ có sẵn mà
       * oxlint chưa bao giờ bắt (nó không nằm trong category `correctness`). Đính chính luôn
       * một khẳng định của rà soát 28/08: mục "0 `any`/`!`/`@ts-ignore`" ĐÚNG hai vế, SAI vế
       * `!`. Bật thẳng `error` là chặn merge vì nợ cũ; hạ hết 20 chỗ rồi nâng lên `error`.
       */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    /*
     * TẦNG NỀN không được biết tới features. Chiều phụ thuộc chỉ đi một hướng:
     * features → ui / lib / shell. Cần dữ liệu của feature thì nhận qua prop.
     */
    files: ['src/ui/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}', 'src/shell/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/**', '../features/**', '../../features/**'],
              message:
                'AD-15: tầng nền (ui/lib/shell) KHÔNG được biết tới features. Chiều phụ thuộc chỉ đi một hướng: features -> ui/lib/shell. Cần dữ liệu của feature thì nhận qua prop.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * MỘT FEATURE không import ruột feature khác.
     *
     * Quy ước: trong CÙNG một feature dùng đường dẫn tương đối (`./x`); `@/features/…` LUÔN
     * nghĩa là xuyên feature. Thứ dùng ở ≥2 màn là tài sản dùng chung → `web/src/ui` hoặc
     * `web/src/lib`, và phải khai vào `docs/SHARED-REGISTRY.md`.
     */
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/**', '../*/[!.]*', ...CROSS_FEATURE_EXCEPTIONS],
              message:
                'AD-15: một feature KHÔNG import ruột feature khác. Thứ dùng ở >=2 màn/module là tài sản dùng chung -> web/src/ui hoặc web/src/lib, và phải khai vào docs/SHARED-REGISTRY.md. Trong CÙNG một feature thì dùng đường dẫn tương đối (./x), không dùng alias @/features.',
            },
            {
              group: ['react-dom'],
              message:
                'AD-15: không tự dựng dialog/portal trong features/. Dùng Dialog (Radix) của web/src/ui.',
            },
          ],
        },
      ],
    },
  },
  {
    // DoD gạch 6 chỉ áp cho mã NGUỒN của web — file cấu hình ở gốc `web/` là chú thích công cụ.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [...NO_NATIVE_DIALOG, NO_VIETNAMESE_IDENT, ...NO_VIETNAMESE_TEXT],
    },
  },
  {
    /*
     * Nơi chữ tiếng Việt được PHÉP nằm: từ điển i18n, và gallery linh kiện cho lập trình viên.
     * Viết lại cả mảng thay vì `'off'` để hai luật kia (hộp thoại gốc, AD-16) vẫn áp.
     */
    files: ['src/locales/**/*.{ts,tsx}', 'src/features/dev/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [...NO_NATIVE_DIALOG, NO_VIETNAMESE_IDENT],
    },
  },
  {
    // File test được chạy bởi vitest (node), không phải trình duyệt — và chúng CẦN gọi tiến
    // trình con để probe chính cái cổng này.
    files: ['src/**/*.{test,spec}.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      /*
       * Tắt luật cấm `confirm/alert/prompt` (bài kiểm CẦN gọi tiến trình con để probe cổng),
       * nhưng GIỮ AD-16: bài kiểm cũng là mã, và một tên có dấu mới sinh ra ở đây thì cũng
       * phải đỏ. Viết lại cả mảng thay vì `'off'` — `'off'` tắt trọn gói cả hai.
       */
      'no-restricted-syntax': ['error', NO_VIETNAMESE_IDENT],
      /*
       * `!` được phép TRONG BÀI KIỂM (20/09/2026).
       *
       * Bài kiểm dựng dữ liệu mẫu của chính nó rồi khẳng định trên đó, nên `rows[0]!` là một
       * lời khẳng định mà nếu sai thì BÀI KIỂM ĐỎ — đúng thứ ta muốn. Ở mã sản phẩm thì `!`
       * sai nghĩa là người dùng nhận trang trắng, nên ở đó rule vẫn `error`.
       *
       * Không nới bằng cách hạ rule toàn cục xuống `warn`: làm thế là 11 chỗ trong bài kiểm
       * che mất bất kỳ `!` MỚI nào lọt vào `features/`.
       */
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // File cấu hình chạy bằng Node, không phải trong trình duyệt. `.cjs` là CommonJS thật
    // (`module.exports`) — dependency-cruiser đọc bằng `require`, không phải bundler.
    files: ['*.cjs', '*.mjs', '*.config.{js,ts}'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
);
