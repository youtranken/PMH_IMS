import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { ExpiryScreen } from './expiry-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';
import { jsonResponse, render, screen, waitFor } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * HUY HIỆU HẠN PHẢI TÔ THEO NGƯỠNG CỦA LƯỢT TRẢ VỀ, KHÔNG PHẢI NGƯỠNG CỦA LƯỢT RENDER ĐẦU.
 *
 * ===== LỖ ĐANG VÁ (F-01, rà soát 19-20/09/2026) =====
 *
 * `expiry-screen.tsx` đọc ngưỡng ra biến `nguong`, dùng nó ở HAI chỗ: phép lọc `rows` (ngoài
 * memo) và `cell` của cột Tình trạng (TRONG `useMemo` của `columns`). Nhưng deps của memo chỉ
 * có `[t, kinds.data]` — thiếu `nguong`.
 *
 * Ở lượt render ĐẦU `expiry.data` còn `undefined`, nên `nguong` lùi về
 * `DEFAULT_EXPIRY_THRESHOLDS` (7/30) và bị ĐÓNG BĂNG vào closure của `cell`. Dữ liệu về mang
 * ngưỡng thật 14/30: `rows` lọc theo 14, huy hiệu vẫn tô theo 7. Ô "Gấp" ghi 6, bấm vào ra 6
 * dòng, chỉ 2 dòng đỏ — đúng cảnh mà 12 dòng chú thích ở `ui/expiry-badge.tsx:38-40` sinh ra
 * để dẹp.
 *
 * ===== VÌ SAO KHÔNG BÀI NÀO BẮT ĐƯỢC =====
 *
 * `DEFAULT_EXPIRY_THRESHOLDS` = 7/30 = ĐÚNG giá trị seed của migration 0041. Mọi lượt chạy
 * dev và E2E vì thế ở đúng cấu hình che lỗi — bản vá chết mà mọi cổng vẫn xanh. Và cả thư mục
 * `features/expiry/` **không có một file test nào**; đây là file đầu tiên.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Một hồ sơ còn 10 ngày, server trả ngưỡng `critical = 14`:
 *   · đúng  → 10 ≤ 14 ⇒ `critical` ⇒ `badge danger`
 *   · hỏng  → 10 > 7  ⇒ `warning`  ⇒ `badge warn`
 *
 * Hai lớp CSS khác nhau, nên bài này phân biệt được bản vá sống với bản vá chết.
 *
 * ===== VÌ SAO PHẢI GIEO SẴN CACHE `['expiry','kinds']` =====
 *
 * Bản ĐẦU của bài này dùng `renderWithI18n` (tự dựng `QueryClient` rỗng) và **đột biến sống
 * sót**: bỏ `nguong` khỏi deps mà bài vẫn xanh. Lý do — `kindLabel` là `useCallback([kinds.data])`,
 * nên khi `kinds` về, nó đổi identity và memo tính lại, vô tình nhặt được `nguong` mới. Bài
 * xanh vì một dep KHÁC cứu, không vì bản vá.
 *
 * Cảnh hỏng thật (mô tả trong lượt rà 19/09) là: người dùng ở Bảng điều khiển — nơi ĐÃ nạp
 * `['expiry','kinds']` — rồi bấm sang `/expiry`. Lúc đó `kinds.data` có sẵn NGAY từ render 1
 * và không bao giờ đổi, nên `nguong` là dep duy nhất còn có thể làm memo tính lại. Gieo sẵn
 * cache chính là dựng lại cảnh đó.
 *
 * Kiểm chính bài này bằng đột biến: bỏ `nguong` khỏi deps ở `expiry-screen.tsx` ⇒ PHẢI đỏ.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

/** Ngày ISO cách hôm nay `days` hôm — tính theo ngày lịch, khớp `daysUntil`. */
function ngayCachDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const CON_10_NGAY = {
  id: 'r1',
  label: 'DM-000001 — Máy trạm kế toán',
  sublabel: null,
  kind: 'device_warranty',
  start: null,
  end: ngayCachDay(10),
  link: '/devices/r1',
  daysLeft: 10,
  canRenew: false,
};

/**
 * Tầng mạng giả.
 *
 * Điểm mấu chốt: `/expiry` trả `criticalDays: 14`, còn `/expiry/thresholds` — thứ
 * `useExpiryThresholds()` của `ExpiryBadge` hỏi — vẫn trả 7/30. Hai nguồn CỐ Ý lệch nhau,
 * vì đó chính là lý do `thresholds` tồn tại như một prop: bảng và huy hiệu phải cùng đọc
 * ngưỡng đi kèm lượt trả về.
 */
function gaLapFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/expiry/kinds')) {
        return Promise.resolve(
          jsonResponse(200, [{ kind: 'device_warranty', label: 'Bảo hành thiết bị' }]),
        );
      }
      if (url.includes('/expiry/thresholds')) {
        return Promise.resolve(jsonResponse(200, { criticalDays: 7, warningDays: 30 }));
      }
      if (url.includes('/expiry/rules')) return Promise.resolve(jsonResponse(200, []));
      if (url.includes('/expiry')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [CON_10_NGAY],
            summary: { expired: 0, critical: 1, warning: 0 },
            thresholds: { criticalDays: 14, warningDays: 30 },
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }),
  );
}

describe('Màn Sắp hết hạn — ngưỡng của lượt trả về', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('huy hiệu tô theo ngưỡng server trả về, không phải ngưỡng lúc chờ dữ liệu', async () => {
    gaLapFetch();

    /* Cache ấm sẵn: đúng trạng thái sau khi người dùng vừa ở Bảng điều khiển. */
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      ['expiry', 'kinds'],
      [{ kind: 'device_warranty', label: 'Bảo hành thiết bị' }],
    );

    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <ExpiryScreen me={me} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    // Chờ dòng về — tức đã qua lượt render có `expiry.data === undefined`, đúng lượt sinh lỗi.
    const nhan = await screen.findByText(/Còn 10 ngày/i, {}, { timeout: 5000 });

    await waitFor(() => {
      /*
       * So bằng LỚP CSS chứ không bằng chữ: nhãn "Còn 10 ngày" giống hệt nhau ở cả hai
       * ngưỡng — chỉ MÀU nói ra hệ thống đang phân loại nó là gấp hay chỉ là sắp tới.
       */
      expect(nhan.className).toContain('danger');
      expect(nhan.className).not.toContain('warn');
    });
  });
});
