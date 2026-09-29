import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * ⌘K KHÔNG ĐƯỢC BIẾN MỘT LƯỢT GỌI HỎNG THÀNH "KHÔNG CÓ GÌ".
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Hộp tìm nhanh gộp bốn nguồn (thiết bị · phần mềm · đường truyền · tài khoản dịch vụ), và cả
 * bốn đều viết `…data?.items ?? []`. Một lượt 500 vì thế hoá thành danh sách rỗng, và hộp in
 * ra câu KHẲNG ĐỊNH: "Không có hồ sơ nào khớp ...". Đo trên trình duyệt thật bằng cách ép
 * `/isp-lines` trả 500 rồi gõ "fpt" — ra đúng câu đó.
 *
 * Hậu quả không phải thẩm mỹ: người trực đọc "không có hồ sơ nào khớp" rồi đi khai TRÙNG một
 * đường truyền đã có trong hệ thống. Đây đúng họ lỗi mà `api-error-not-empty.spec.ts`
 * chặn ở các màn danh sách, chỉ là ở một cửa khác.
 *
 * Cờ `loading` cũng chỉ đọc hai trên bốn nguồn, nên một nhóm về chậm là hộp nháy câu "không
 * có gì" trước khi đổ kết quả ra.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Hai cảnh, và cả hai đều là thứ người dùng đọc được trên màn hình: hỏng mà KHÔNG có kết quả
 * nào thì đừng khẳng định là không có; hỏng mà VẪN có kết quả thì phải nói rõ danh sách còn
 * thiếu, chứ đừng để người ta tin là đã thấy hết.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const pageNo = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 5 });

/** Giả lập tầng mạng: `isp-lines` hỏng, ba nguồn còn lại trả về `items`. */
function gaLapFetch(deviceItems: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/isp-lines')) return Promise.resolve(jsonResponse(500, { message: 'toang' }));
      if (url.includes('/devices')) return Promise.resolve(jsonResponse(200, pageNo(deviceItems)));
      return Promise.resolve(jsonResponse(200, pageNo([])));
    }),
  );
}

describe('⌘K khi một nguồn hỏng', () => {
  afterEach(() => vi.unstubAllGlobals());

  const openAndType = async (text: string) => {
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ConfirmProvider>
          <CommandPalette me={me} />
        </ConfirmProvider>
      </MemoryRouter>,
    );
    await user.keyboard('{Control>}k{/Control}');
    /* `combobox`, không phải `textbox`: ô tìm khai `role="combobox"` +
       `aria-activedescendant` để mũi tên ↑/↓ nói được với trình đọc màn hình. */
    await user.type(screen.getByRole('combobox', { name: /tìm nhanh/i }), text);
  };

  it('không kết quả nào: KHÔNG được khẳng định "không có hồ sơ nào khớp"', async () => {
    gaLapFetch([]);
    await openAndType('fpt');

    // Câu phải nói ra là ĐANG THIẾU, và thiếu nhóm nào.
    // `findByText` đã NÉM khi không thấy, nên `toBeTruthy()` sau nó không thể đỏ — bỏ đi để
    // đừng dạy sai người đọc sau. Phép chờ nằm ở chính `findByText`.
    await screen.findByText(/Chưa tìm được trong:.*Đường truyền/s);
    expect(screen.queryByText(/Không có hồ sơ nào khớp/)).toBeNull();
  });

  it('có kết quả: vẫn phải nói danh sách còn thiếu', async () => {
    gaLapFetch([{ id: 'd1', code: 'SW-CORE-01', name: 'Switch lõi', siteCode: 'HN' }]);
    await openAndType('sw');

    // Tên dòng đi qua vai `option`: phần khớp từ khoá được bọc `<mark>`, chữ bị tách thành nhiều nút.
    await screen.findByRole('option', { name: /SW-CORE-01/ });
    await screen.findByText(/Danh sách dưới đây còn thiếu/);
  });
});
