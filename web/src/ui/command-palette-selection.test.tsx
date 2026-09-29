import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * ⌘K KHÔNG ĐƯỢC ĐỔI DÒNG ĐANG CHỌN DƯỚI TAY NGƯỜI DÙNG.
 *
 * ===== LỖ BÀI NÀY CANH =====
 *
 * `hits` ghép theo thứ tự cố định (thiết bị → phần mềm → ISP → tài khoản) từ bốn truy vấn giải
 * quyết ĐỘC LẬP, còn con trỏ là một CHỈ SỐ vào mảng ấy. Nhóm Phần mềm về trước, người dùng bấm
 * ↓↓ chọn dòng thứ ba — rồi nhóm Thiết bị về và chèn 5 dòng vào ĐẦU mảng. Chỉ số 2 giờ trỏ vào
 * một hồ sơ hoàn toàn khác. Enter mở đúng hồ sơ sai đó, và `aria-activedescendant` cũng đọc
 * vống ra cái tên mới cho trình đọc màn hình.
 *
 * Neo theo ĐÍCH ĐẾN thay vì theo chỗ ngồi là đúng ý tưởng, nhưng dễ đấu dây sai: effect ghi
 * neo khai TRƯỚC effect khôi phục thì nó đè neo bằng phần tử ở chỗ ngồi cũ rồi mới đi tìm chính
 * giá trị vừa đè — một no-op hoàn chỉnh, và cảnh hỏng xảy ra nguyên vẹn. Bài này canh đúng
 * chuyện đó.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Đúng một câu, và là câu người dùng gặp: dòng đang sáng TRƯỚC khi nhóm chậm về phải vẫn là
 * dòng đang sáng SAU khi nó về. Bài hỏi qua `aria-selected` — cùng thứ trình đọc màn hình đọc,
 * không phải qua chỉ số nội bộ.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const trang = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 3 });

const PHAN_MEM = [
  { id: 'sw1', code: 'SW-E2E-01', name: 'Office' },
  { id: 'sw2', code: 'SW-E2E-02', name: 'Photoshop' },
  { id: 'sw3', code: 'SW-E2E-03', name: 'AutoCAD' },
];
const THIET_BI = [
  { id: 'd1', code: 'TB-E2E-01', name: 'Switch', siteCode: 'HN' },
  { id: 'd2', code: 'TB-E2E-02', name: 'AP', siteCode: 'HN' },
  { id: 'd3', code: 'TB-E2E-03', name: 'Router', siteCode: 'HN' },
];

/** Dòng đang sáng, đọc theo đúng thứ trình đọc màn hình đọc. */
const dongDangSang = () =>
  document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? null;

describe('⌘K giữ dòng đang chọn khi một nhóm về muộn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nhóm Thiết bị về sau và chèn lên đầu: con trỏ vẫn ở đúng hồ sơ đã chọn', async () => {
    /* Giữ lời hứa của `/devices` lại, nhả đúng lúc muốn — đó là toàn bộ cuộc đua cần dựng. */
    let nhaThietBi: () => void = () => undefined;
    const thietBiVe = new Promise<Response>((resolve) => {
      nhaThietBi = () => resolve(jsonResponse(200, trang(THIET_BI)));
    });

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/devices')) return thietBiVe;
        if (url.includes('/software')) return Promise.resolve(jsonResponse(200, trang(PHAN_MEM)));
        return Promise.resolve(jsonResponse(200, trang([])));
      }),
    );

    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ConfirmProvider>
          <CommandPalette me={me} />
        </ConfirmProvider>
      </MemoryRouter>,
    );

    await user.keyboard('{Control>}k{/Control}');
    /* "qxz" không khớp tên màn hình nào, nên `navHits` rỗng và mảng chỉ có hai nhóm thật —
       giữ cuộc đua sạch, không lẫn dòng điều hướng vào giữa. */
    await user.type(screen.getByRole('combobox', { name: /tìm nhanh/i }), 'qxz');

    await screen.findByText('SW-E2E-03');
    await user.keyboard('{ArrowDown}{ArrowDown}');

    const truoc = dongDangSang();
    expect(truoc).toContain('SW-E2E-03');

    nhaThietBi();
    await screen.findByText('TB-E2E-01');

    expect(dongDangSang()).toBe(truoc);
  });
});
