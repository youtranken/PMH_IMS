import { formatDate, todayIso } from '@/lib/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { SoftwareForm } from './software-form';
import type { SoftwareRow } from './software-types';

afterEach(() => vi.unstubAllGlobals());

const CATALOG = { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] };

const ROW: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-E2E-FORM',
  name: 'Office',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 5,
  seatUsed: 0,
  startDate: '2024-02-29',
  endDate: '2024-12-31',
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
};

function mockFetch() {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return Promise.resolve(jsonResponse(200, { id: 'sw1' }));
      }
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return writes;
}

function render(row: SoftwareRow | null) {
  return renderWithI18n(
    <ToastProvider>
      <SoftwareForm row={row} csrfToken="csrf" onClose={() => {}} onSaved={() => {}} />
    </ToastProvider>,
  );
}

describe('Form hồ sơ phần mềm', () => {
  it('hộp tạo mới mang tên "Thêm phần mềm"', () => {
    mockFetch();
    render(null);
    expect(screen.getByRole('dialog', { name: 'Thêm phần mềm' })).toBeInTheDocument();
  });

  // FM-06: ô Bắt đầu trống thì các nút +1 / +2 / +3 năm xám — hồ sơ mới mặc định hôm nay.
  it('thêm mới: ô Bắt đầu mặc định hôm nay', () => {
    mockFetch();
    render(null);
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toHaveTextContent(formatDate(todayIso()));
  });

  it('câu giải thích kỳ hạn nằm sau nút (i), không in thẳng dưới ô', async () => {
    mockFetch();
    render(null);
    expect(screen.queryByText(/hệ thống nhắc gia hạn/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Giải thích: Kỳ hạn' }));
    expect(screen.getByText(/hệ thống nhắc gia hạn/)).toBeInTheDocument();
  });

  it('+1 năm tính từ ngày bắt đầu (29/02 lùi về 28/02); chưa có ngày bắt đầu thì tắt', async () => {
    mockFetch();
    // Hồ sơ mới đã có Bắt đầu = hôm nay (FM-06); "chưa có ngày bắt đầu" là hồ sơ cũ để trống ô đó.
    const { unmount } = render({ ...ROW, startDate: null });
    expect(screen.getByRole('button', { name: '+1 năm' })).toBeDisabled();
    unmount();

    const writes = mockFetch();
    render(ROW);
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ startDate: '2024-02-29', endDate: '2025-02-28' });
  });

  it('Ghế và Ghi chú chung một khu — không còn khu "Ghế" riêng', () => {
    mockFetch();
    render(null);
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).not.toContain('Ghế');
    expect(screen.getByRole('textbox', { name: 'Số ghế' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toBeInTheDocument();
  });

  it('Số ghế có nút − / +; − dừng ở số máy đang dùng, lưu đúng số đã bấm (Q-24)', async () => {
    const writes = mockFetch();
    render({ ...ROW, seatTotal: 4, seatUsed: 3 });
    const seat = screen.getByRole('textbox', { name: 'Số ghế' });
    await userEvent.click(screen.getByRole('button', { name: 'Giảm số ghế' }));
    expect(seat).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Giảm số ghế' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Tăng số ghế' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tăng số ghế' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ seatTotal: 5 });
  });

  it('Thời hạn (Thuê bao / Vĩnh viễn) là dải nút nằm thẳng trong ô form — CSS trải đều (Q-24)', () => {
    mockFetch();
    render(null);
    const group = screen.getByRole('radiogroup', { name: 'Kỳ hạn' });
    expect(group.parentElement).toHaveClass('field');
    expect(group).toHaveClass('segmented');
  });

  // UX-E20: panel giấy tờ ghi thẳng, trùng tab Giấy tờ — form Sửa chỉ còn một dòng chỉ đường.
  it('SỬA: không nhúng panel giấy tờ, chỉ một dòng chỉ sang tab Giấy tờ', async () => {
    mockFetch();
    render(ROW);
    expect(await screen.findByText(/Giấy tờ · quản lý ở tab Giấy tờ$/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Chọn file để đính kèm')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giải thích: Giấy tờ đính kèm' })).toBeNull();
  });
});

/** Form mở từ màn nào thì chỉ cho chọn loại của màn đó (Q-22). */
describe('Form theo màn (Q-22)', () => {
  function renderOn(screenKey: 'software' | 'domains' | 'maintenance' | 'services') {
    return renderWithI18n(
      <ToastProvider>
        <SoftwareForm row={null} screen={screenKey} csrfToken="csrf" onClose={() => {}} onSaved={() => {}} />
      </ToastProvider>,
    );
  }

  it('Tên miền & SSL: hai lựa chọn Tên miền / Chứng chỉ SSL, tiêu đề "Thêm tên miền / SSL"', () => {
    mockFetch();
    renderOn('domains');
    expect(screen.getByRole('dialog', { name: 'Thêm tên miền / SSL' })).toBeInTheDocument();
    const kinds = within(screen.getByRole('radiogroup', { name: 'Loại hồ sơ' }))
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent);
    expect(kinds).toEqual(['Tên miền', 'Chứng chỉ SSL']);
    // Không còn ô của license.
    expect(screen.queryByRole('textbox', { name: 'Số ghế' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Kỳ hạn' })).toBeNull();
  });

  // FM-23: tên miền là thứ người ta có trên tay đầu tiên — ô đứng đầu, Tên hồ sơ tự điền theo nó.
  it('Tên miền & SSL: ô Tên miền đứng trước Tên hồ sơ; gõ tên miền → Tên hồ sơ tự điền, sửa tay thì giữ', async () => {
    mockFetch();
    renderOn('domains');
    const user = userEvent.setup();
    const domains = screen.getByRole('textbox', { name: /^Tên miền/ });
    const name = screen.getByRole('textbox', { name: /Tên hồ sơ/ });
    expect(domains.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.type(domains, 'pmh.com.vn{Enter}mail.pmh.com.vn');
    expect(name).toHaveValue('pmh.com.vn');
    await user.clear(name);
    await user.type(name, 'Tên miền chính');
    await user.type(domains, '{Enter}vpn.pmh.com.vn');
    expect(name).toHaveValue('Tên miền chính');
  });

  it('Tên miền & SSL: phải có ít nhất một tên miền — ô "Tên miền" báo lỗi, không gửi', async () => {
    const writes = mockFetch();
    renderOn('domains');
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Mã hồ sơ/ }), 'DOM-E2E-1');
    await user.type(screen.getByRole('textbox', { name: /Tên hồ sơ/ }), 'Tên miền chính');
    expect(screen.getByText(/một hoặc nhiều tên miền dùng chung ngày hết hạn này/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findAllByText('Nhập ít nhất một tên miền.')).not.toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['maintenance', 'Thêm hợp đồng bảo trì', 'maintenance'],
    ['services', 'Thêm dịch vụ có hạn', 'other'],
    ['software', 'Thêm phần mềm', 'license'],
  ] as const)('%s (%s): loại cố định, không có ô chọn Loại, gửi kind=%s', async (key, title, kind) => {
    const writes = mockFetch();
    renderOn(key);
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Loại hồ sơ' })).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Mã hồ sơ/ }), 'X-E2E-1');
    await user.type(screen.getByRole('textbox', { name: /Tên hồ sơ/ }), 'Hồ sơ thử');
    if (kind === 'license') {
      await user.click(screen.getByRole('radio', { name: 'Vĩnh viễn' }));
    }
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ kind });
  });
});

/* PW-A12 (Q-33): mã hồ sơ chỉ A–Z 0–9 - _ . /, tự in hoa; mã khai trước luật vẫn sửa được. */
describe('Form phần mềm — luật mã hồ sơ', () => {
  it('gõ chữ thường thành chữ hoa; có dấu / khoảng trắng thì báo tại ô, không gửi', async () => {
    const writes = mockFetch();
    renderWithI18n(
      <ToastProvider>
        <SoftwareForm row={null} screen="maintenance" csrfToken="csrf" onClose={() => {}} onSaved={() => {}} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const code = screen.getByRole('textbox', { name: /Mã hồ sơ/ });
    await user.type(code, 'hồ sơ -1');
    expect(code).toHaveValue('HỒ SƠ -1');
    await user.type(screen.getByRole('textbox', { name: /Tên hồ sơ/ }), 'Bảo trì');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findAllByText(/Chỉ dùng chữ A–Z/)).not.toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('Sửa hồ sơ có mã cũ sai luật: không đụng ô Mã thì lưu được', async () => {
    const writes = mockFetch();
    render({ ...ROW, code: 'hồ sơ -1' });
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ code: 'hồ sơ -1' });
  });
});

/* FM-21: khai cả lô hợp đồng / dịch vụ — lưu xong giữ form mở, bỏ mã + ghi chú, giữ phần chung. */
describe('Form phần mềm — Lưu và nhân bản', () => {
  it('lưu một hồ sơ, form ở lại: mã + ghi chú trống, tên / NCC / hạn giữ nguyên', async () => {
    const writes = mockFetch();
    const saved = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <SoftwareForm row={null} screen="maintenance" csrfToken="csrf" onClose={() => {}} onSaved={saved} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Mã hồ sơ/ }), 'BT-E2E-01');
    await user.type(screen.getByRole('textbox', { name: /Tên hồ sơ/ }), 'Bảo trì UPS');
    await user.type(screen.getByRole('textbox', { name: 'Ghi chú' }), 'Tầng 3');
    await user.click(screen.getByRole('button', { name: 'Lưu và nhân bản' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ code: 'BT-E2E-01', name: 'Bảo trì UPS', note: 'Tầng 3' });
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'sw1' }), { keepOpen: true }));
    expect(screen.getByRole('dialog', { name: 'Thêm hợp đồng bảo trì' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Mã hồ sơ/ })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /Tên hồ sơ/ })).toHaveValue('Bảo trì UPS');
  });

  it('form Sửa không có nút Lưu và nhân bản', () => {
    mockFetch();
    render(ROW);
    expect(screen.queryByRole('button', { name: 'Lưu và nhân bản' })).toBeNull();
  });
});

/* PW-A35 + FM-25 (Q-33): tiêu đề khối là danh từ, Mã luôn đứng trước Tên. */
describe('Form phần mềm — tiêu đề khối + thứ tự Mã / Tên', () => {
  it('license: khối "Nhận dạng" (không còn "Phần mềm gì"); ô Mã trước ô Tên', () => {
    mockFetch();
    render(null);
    const dialog = screen.getByRole('dialog');
    const headings = within(dialog).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim());
    expect(headings).toContain('Nhận dạng');
    expect(headings).not.toContain('Phần mềm gì');
    const boxes = within(dialog).getAllByRole('textbox');
    const code = boxes.indexOf(screen.getByRole('textbox', { name: /Mã hồ sơ/ }));
    const name = boxes.indexOf(screen.getByRole('textbox', { name: /Tên hồ sơ/ }));
    expect(code).toBeLessThan(name);
  });
});
