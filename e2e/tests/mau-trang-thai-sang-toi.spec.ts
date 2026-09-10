import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_SA,
  firstLogin,
  resetDevices,
  resetSoftware,
  resetUsers,
  writeHeaders,
} from './helpers';

/**
 * "Test luôn cả light + dark khi màn có màu trạng thái" (CLAUDE.md) — bài đầu tiên của repo
 * thật sự HỎI câu đó.
 *
 * ===== VÌ SAO `toBeVisible()` KHÔNG TRẢ LỜI ĐƯỢC =====
 *
 * Trước bài này, cả bộ E2E có đúng một chỗ chạm theme (`expiry.mobile.spec.ts`) và nó chỉ
 * kiểm cơ chế: bấm nút → `html[data-theme]` đổi → chữ vẫn `toBeVisible()`. Nhưng
 * `toBeVisible()` chỉ hỏi "phần tử có hộp bao khác 0 và không bị `display:none`". Chữ trắng
 * trên nền trắng THỎA MÃN hết. Đúng chế độ hỏng mà luật token của dự án sinh ra để chặn: quên
 * cặp `html[data-theme='dark']` cho một token mới, hoặc viết hex thẳng vào component — huy
 * hiệu vẫn "hiện", chỉ là không ai đọc được nó nữa.
 *
 * ===== NÊN BÀI NÀY ĐO MÀU THẬT, HAI CÂU =====
 *
 *   1. Huy hiệu có nền RIÊNG không — nền của nó phải khác nền trang. Mất lớp tint (token dark
 *      thiếu → `background` rơi về trong suốt) thì câu này đỏ, kể cả khi chữ vẫn đọc được.
 *   2. Chữ trên nền đó có tương phản đạt AA (≥ 4.5) không — đo bằng `getComputedStyle` qua
 *      `page.evaluate`, cộng dồn mọi lớp nền bán trong suốt lên tới `html`.
 *
 * Ngưỡng 4.5 không phải con số cho vui: `tokens.css` ghi thẳng rằng `--warn` và `--muted` đã
 * bị làm ĐẬM ĐI ("đậm để chữ warn đạt AA trên warn-soft (axe 2026-08-06)"). Hạ ngưỡng xuống 3
 * là vứt bỏ đúng thứ đã trả giá để có.
 *
 * Chạy ở project desktop, cố ý: đây là câu hỏi về MÀU, không phải về bố cục. Phủ 390px là
 * việc của các file `*.mobile.spec.ts`.
 */

test.beforeEach(() => {
  resetUsers();
  resetSoftware();
  // Bảo hành thiết bị cũng là một nguồn hạn — máy sót lại từ spec khác chen vào bảng này.
  resetDevices();
});

/** Ngưỡng AA của WCAG cho chữ thường. Huy hiệu là chữ nhỏ (`--fs-xs`), nên đúng là 4.5. */
const AA = 4.5;

interface Paint {
  /** Màu chữ đã cộng nền, dạng `rgb(r, g, b)`. */
  color: string;
  /** `background-color` thô của CHÍNH huy hiệu. */
  ownBackground: string;
  /** Nền hiệu dụng dưới chữ: cộng dồn từ huy hiệu lên tới `html`. */
  effectiveBackground: string;
  /** Nền PHÍA SAU huy hiệu: cộng dồn từ phần tử cha lên tới `html`. */
  behindBackground: string;
  /** Có gặp một lớp nền ĐỤC nào trên đường đi lên không — xem chú thích dưới. */
  opaqueFound: boolean;
  ratio: number;
}

/**
 * Đọc màu chữ / màu nền đã tính toán của một phần tử và tính tỉ số tương phản WCAG.
 *
 * `opaqueFound` tồn tại để bài kiểm không tự lừa mình: nếu MỌI lớp từ huy hiệu lên tới `html`
 * đều trong suốt thì hàm này buộc phải giả định nền trắng, và ở chế độ tối giả định đó cho ra
 * một tỉ số cao đẹp đẽ hoàn toàn sai. Trả cờ ra ngoài rồi khẳng định nó `true` thì cái giả
 * định kia không bao giờ lặng lẽ đi vào kết quả.
 *
 * (Để riêng trong file này chứ chưa đưa vào `helpers.ts`: AD-15 tính "dùng chung" từ người
 * dùng thứ hai. Có bài thứ hai cần đo màu thì chuyển sang đó, đừng chép.)
 */
function paintOf(target: Locator): Promise<Paint> {
  return target.evaluate((el) => {
    const parse = (value: string): [number, number, number, number] => {
      const n = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const over = (
      top: [number, number, number, number],
      under: [number, number, number],
    ): [number, number, number] => [
      top[0] * top[3] + under[0] * (1 - top[3]),
      top[1] * top[3] + under[1] * (1 - top[3]),
      top[2] * top[3] + under[2] * (1 - top[3]),
    ];
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const lin = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    };
    const rgb = ([r, g, b]: [number, number, number]) =>
      `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

    const layers: [number, number, number, number][] = [];
    let opaqueFound = false;
    for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
      const layer = parse(getComputedStyle(node).backgroundColor);
      layers.push(layer);
      if (layer[3] >= 0.999) opaqueFound = true;
    }

    /*
     * Cộng từ lớp dưới cùng (`html`) lên trên, và DỪNG LẠI MỘT NHỊP trước khi đắp lớp của
     * chính huy hiệu — đó là "nền phía sau". Đắp nốt lớp cuối ra "nền dưới chữ". Hai con số
     * khác nhau nghĩa là huy hiệu có thật một lớp tint của riêng nó; bằng nhau nghĩa là nó
     * trong suốt và đang mượn nền trang.
     *
     * Nền khởi đầu trắng chỉ là dự phòng khi mọi lớp đều trong suốt — `opaqueFound` tố cáo
     * đúng trường hợp đó, nên giả định này không bao giờ lặng lẽ đi vào kết quả.
     */
    let behind: [number, number, number] = [255, 255, 255];
    for (let i = layers.length - 1; i >= 1; i--) behind = over(layers[i], behind);
    const background = over(layers[0], behind);

    const color = over(parse(getComputedStyle(el).color), background);
    const [a, b] = [luminance(color), luminance(background)].sort((x, y) => y - x);

    return {
      color: rgb(color),
      ownBackground: getComputedStyle(el).backgroundColor,
      effectiveBackground: rgb(background),
      behindBackground: rgb(behind),
      opaqueFound,
      ratio: (a + 0.05) / (b + 0.05),
    };
  });
}

/** Bấm đúng cái nút người dùng bấm, rồi khẳng định theme đã thật sự đổi. */
async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const button = page.getByRole('button', {
    name: theme === 'dark' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng',
  });
  if ((await button.count()) > 0) await button.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/** Huy hiệu này có phải một huy hiệu THẬT, và có đọc được không — hỏi cả hai. */
async function expectLegibleBadge(badge: Locator, what: string): Promise<void> {
  await expect(badge, `${what}: phải hiện ra đã`).toBeVisible();
  const paint = await paintOf(badge);
  const detail = `${what} — chữ ${paint.color} trên nền ${paint.effectiveBackground}`;

  expect(paint.opaqueFound, `${detail}: không tìm thấy lớp nền đục nào (phép đo không tin được)`)
    .toBe(true);
  /*
   * Nền RIÊNG của huy hiệu. `.badge.warn { background: var(--warn-soft) }` — thiếu cặp token
   * dark thì `var()` rơi về giá trị trống, nền biến mất, và huy hiệu hòa vào trang. Chữ có thể
   * vẫn đọc được, nhưng nó không còn là huy hiệu trạng thái nữa.
   */
  expect(paint.ownBackground, `${detail}: huy hiệu mất lớp nền riêng`).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(
    paint.effectiveBackground,
    `${detail}: nền dưới chữ trùng nền phía sau (${paint.behindBackground}) — không còn lớp tint`,
  ).not.toBe(paint.behindBackground);
  expect(paint.ratio, `${detail}: tương phản ${paint.ratio.toFixed(2)} < ${AA}`).toBeGreaterThanOrEqual(
    AA,
  );
}

test('huy hiệu hạn ở màn Sắp hết hạn đọc được ở CẢ chế độ sáng lẫn tối', async ({ page }) => {
  await firstLogin(page, E2E_SA);
  const stamp = Date.now().toString().slice(-6);
  const headers = await writeHeaders(page);
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  // Một món GẤP (≤7 ngày → tone `danger`) và một món SẮP (≤30 ngày → tone `warn`). Hai tone
  // này là toàn bộ ngôn ngữ màu của màn — xám chỉ xuất hiện khi con số bằng 0.
  const critical = await page.request.post('/api/v1/software', {
    headers,
    data: { code: `SSL-E2E-DARK-C-${stamp}`, name: `Chứng chỉ gấp ${stamp}`, kind: 'ssl', endDate: day(3) },
  });
  expect(critical.status()).toBe(201);
  const warning = await page.request.post('/api/v1/software', {
    headers,
    data: { code: `SSL-E2E-DARK-W-${stamp}`, name: `Chứng chỉ sắp ${stamp}`, kind: 'ssl', endDate: day(20) },
  });
  expect(warning.status()).toBe(201);

  await page.goto('/expiry');
  await expect(page.getByRole('heading', { name: 'Sắp hết hạn' })).toBeVisible();

  /*
   * Regex neo hai đầu, cố ý: `getByText('Gấp')` khớp cả cái `<div>` bọc ba con số (chuỗi con),
   * và lúc đó bài kiểm đo màu của khung chứ không phải của huy hiệu — xanh vì đo nhầm chỗ.
   */
  const chipCritical = page.getByText(/^Gấp \(≤7 ngày\): \d+$/);
  const chipWarning = page.getByText(/^Sắp tới: \d+$/);
  const badgeCritical = page
    .getByRole('row')
    .filter({ hasText: `Chứng chỉ gấp ${stamp}` })
    .getByText(/^(Còn \d+ ngày|Hết hạn hôm nay)$/);
  const badgeWarning = page
    .getByRole('row')
    .filter({ hasText: `Chứng chỉ sắp ${stamp}` })
    .getByText(/^Còn \d+ ngày$/);

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    await expectLegibleBadge(chipCritical, `[${theme}] chip "Gấp"`);
    await expectLegibleBadge(chipWarning, `[${theme}] chip "Sắp tới"`);
    await expectLegibleBadge(badgeCritical, `[${theme}] huy hiệu hạn gấp trong bảng`);
    await expectLegibleBadge(badgeWarning, `[${theme}] huy hiệu hạn sắp trong bảng`);
  }

  /*
   * VẾ CUỐI, và là vế biến bài này từ "đo được" thành "phân biệt được": hai mức PHẢI khác màu
   * nhau. Một bản hỏng vẽ mọi huy hiệu cùng một tone vẫn đạt hết các khẳng định trên — vẫn có
   * nền riêng, vẫn đủ tương phản — trong khi màu đã thôi mang nghĩa. Hỏi ở chế độ tối vì đó
   * là chế độ hay bị bỏ quên khi thêm token.
   */
  const [critPaint, warnPaint] = [await paintOf(badgeCritical), await paintOf(badgeWarning)];
  expect(
    critPaint.color,
    'ở chế độ tối, "gấp" và "sắp" phải khác màu — nếu không màu đã hết nghĩa',
  ).not.toBe(warnPaint.color);
});
