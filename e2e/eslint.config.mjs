// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ===== CỔNG CHO `e2e/` — trước 08/09 thư mục này KHÔNG có cổng nào =====
 *
 * Rà soát 07/09 (#16): `e2e/` không lint, không nằm trong `npm run lint` của repo. Mọi luật
 * viết trong `CLAUDE.md` cho E2E — không `sleep`, cấm CSS class selector, ưu tiên
 * `getByRole`/`getByLabel` — có **0 cưỡng chế**, và cả ba đều đang bị vi phạm nhiều chỗ.
 *
 * `npm run typecheck` (thêm 07/09) mới chỉ canh phần KIỂU. Nó không thấy được một bài kiểm
 * ngủ 4 giây thay vì chờ điều kiện, cũng không thấy một selector bám vào tên class CSS.
 *
 * ===== VÌ SAO HAI LUẬT NÀY, VỚI HAI MỨC KHÁC NHAU =====
 *
 * `waitForTimeout` = LỖI. Ngủ một khoảng cố định là cách viết bài kiểm vừa chậm vừa dối: máy
 * chậm hơn thì nó đỏ ngẫu nhiên, máy nhanh hơn thì nó xanh trước khi thứ cần kiểm kịp xảy ra.
 * Playwright có `expect(...).toBeVisible()` và `waitForResponse` cho đúng việc đó.
 *
 * Selector CSS = CẢNH BÁO CÓ TRẦN. Nó là nợ THẬT (đang 20+ chỗ) nhưng gỡ hết đòi thêm
 * `data-testid` vào hàng chục component, và làm việc đó ngay trước lượt E2E chốt nhánh là đổi
 * một rủi ro nhỏ lấy một rủi ro lớn. Nên: đếm hôm nay, ghim trần bằng `--max-warnings`, và nợ
 * KHÔNG được phép lớn thêm. Một cổng chặn được đà tăng vẫn hơn hẳn một cổng không tồn tại —
 * và hơn hẳn một cổng đặt `'off'` rồi quên (đúng cái bẫy vừa gỡ ở `api/eslint.config.mjs`).
 *
 * Hạ trần mỗi khi gỡ được một chỗ. Đừng nâng.
 */

/** Ngủ theo đồng hồ thay vì chờ điều kiện. */
const NO_SLEEP = /** @type {const} */ ({
  selector: "CallExpression[callee.property.name='waitForTimeout']",
  message:
    'CLAUDE.md: không `sleep` trong E2E. Dùng `expect(...).toBeVisible()` hoặc `waitForResponse`. ' +
    'Bài PHẢI chờ đồng hồ thật (trần đăng nhập theo IP, cache system_config) thì gắn nhãn @slow ' +
    'và khai ngoại lệ trong file này.',
});

/**
 * Chuỗi selector bắt đầu bằng `.` `#` `[` — tên class, id hoặc thuộc tính.
 *
 * Tên class thuộc về CSS: đổi màu một nút cũng làm đỏ bài kiểm, mà tệ hơn là đổi cấu trúc rồi
 * selector vẫn khớp một phần tử KHÁC — bài kiểm xanh trong khi nó đang soi nhầm chỗ.
 */
const NO_CSS_SELECTOR = /** @type {const} */ ({
  selector:
    "CallExpression[callee.property.name=/^(locator|click|fill|textContent|isVisible|waitForSelector)$/] > Literal[value=/^[.#\\[]/]",
  message:
    'CLAUDE.md: cấm selector CSS trong E2E. Ưu tiên getByRole/getByLabel/getByText; khung bố cục ' +
    'không có tên trợ năng thì thêm `data-testid` vào component rồi dùng `getByTestId`.',
});

/** Selector kiểu `aside.sidebar`, `div.card` — thẻ + class, cùng một loại nợ. */
const NO_TAG_CLASS_SELECTOR = /** @type {const} */ ({
  selector:
    "CallExpression[callee.property.name=/^(locator|click|fill|textContent|isVisible|waitForSelector)$/] > Literal[value=/^[a-z]+[.#]/]",
  message:
    'CLAUDE.md: cấm selector CSS trong E2E (kể cả dạng `thẻ.class`). Dùng getByRole/getByTestId.',
});

export default tseslint.config(
  { ignores: ['node_modules/**', 'playwright-report/**', 'test-results/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Trần ghim ở `package.json` (`--max-warnings`). Đọc phần đầu file trước khi đổi.
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    /**
     * HAI MỨC TRONG MỘT LUẬT — `no-restricted-syntax` chỉ có một mức cho cả danh sách, nên
     * phần "lỗi" và phần "cảnh báo" phải là HAI khối, và khối sau KHÔNG được làm rơi khối trước.
     *
     * Bản đầu của tôi chỉ khai hai mục CSS ở đây. Vì khai lại cùng tên luật là GHI ĐÈ chứ
     * không cộng dồn, `NO_SLEEP` biến mất khỏi mọi file trong `tests/` — tức là luật cấm sleep
     * chết ngay lúc vừa sinh ra. Bắt được nhờ chạy thử một file mồi có `waitForTimeout` và
     * thấy nó ra CẢNH BÁO thay vì LỖI. Đúng loại cổng-khớp-số-không mà file này sinh ra để tránh.
     */
    files: ['tests/**/*.ts', '*.ts'],
    rules: {
      'no-restricted-syntax': ['warn', NO_CSS_SELECTOR, NO_TAG_CLASS_SELECTOR],
      'no-restricted-properties': [
        'error',
        {
          object: 'page',
          property: 'waitForTimeout',
          message: NO_SLEEP.message,
        },
      ],
    },
  },
  {
    /**
     * NGOẠI LỆ DUY NHẤT cho `waitForTimeout`, khai tường minh.
     *
     * `login-rate-limit.spec.ts` đo TRẦN ĐĂNG NHẬP THEO IP — một cửa sổ thời gian thật của
     * Redis. Không có điều kiện nào để chờ: thứ cần kiểm chính là "sau N giây thì mở lại".
     * Bài đó đã gắn @slow và chỉ chạy ở lượt `--e2e` đầy đủ.
     *
     * `'off'` ở đây AN TOÀN vì `no-restricted-properties` chỉ chở đúng một mục — luật cấm
     * sleep. Phần selector CSS nằm ở `no-restricted-syntax`, một tên luật KHÁC, nên nó không
     * rơi theo. Chính vì vậy hai luật này cố ý tách tên: gộp chung rồi miễn cả cụm là đúng cái
     * bẫy #9b vừa gỡ ở `api/eslint.config.mjs`.
     */
    files: ['tests/login-rate-limit.spec.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
