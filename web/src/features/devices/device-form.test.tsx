import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { DeviceRow } from '@/lib/device-types';
import { DeviceForm } from './device-form';

/**
 * DEV-025 + DEV-027 trên form thật.
 *
 *   · bấm Lưu khi trống: câu tiếng Việt dưới từng ô bắt buộc, tóm tắt đầu form, tiêu điểm về
 *     ô đầu tiên, KHÔNG gửi gì — thay cho bong bóng "Please fill out this field." (form đặt
 *     `noValidate`, nên thiếu hook là form gửi thẳng lên server);
 *   · ô chọn danh mục chỉ mời mục còn dùng; hồ sơ đang trỏ vào mục đã vô hiệu vẫn thấy đúng tên.
 */

const LISTS = {
  sites: [
    { id: 's-on', code: 'HCM', name: 'Văn phòng', address: null, active: true },
    { id: 's-off', code: 'KHO-CU', name: 'Kho cũ', address: null, active: false },
  ],
  cabinets: [],
  deviceTypes: [
    { id: 't-on', name: 'PC', hasPortMap: false, description: null, active: true },
    { id: 't-off', name: 'Máy fax', hasPortMap: false, description: null, active: false },
  ],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

function mockFetch(lists: typeof LISTS = LISTS) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, lists));
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        return Promise.resolve(jsonResponse(200, { device: { id: 'd1', code: 'SW-01' }, warnings: [] }));
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderForm(device: DeviceRow | null) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DeviceForm device={device} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Form thiết bị — kiểm tiếng Việt và danh mục vô hiệu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bấm Lưu khi trống: lỗi dưới từng ô, tóm tắt, tiêu điểm ô đầu, không gửi', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Còn 3 ô cần sửa trước khi lưu.')).toBeInTheDocument();
    const code = screen.getByRole('textbox', { name: 'Mã thiết bị' });
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription('Chưa nhập.');
    expect(screen.getByRole('button', { name: 'Loại thiết bị' })).toHaveAccessibleDescription(
      'Chưa chọn.',
    );
    await waitFor(() => expect(code).toHaveFocus());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('ghi chú có chuỗi trông như mật khẩu: báo tại ô, không gửi (Q-19)', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Ghi chú/ }));
    const note = screen.getByRole('textbox', { name: 'Ghi chú' });
    await user.type(note, 'mk wifi Pmh@Guest2026');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(note).toHaveAttribute('aria-invalid', 'true'));
    expect(note).toHaveAccessibleDescription(expect.stringContaining('trông như mật khẩu'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('thêm mới: loại và site đã vô hiệu không có trong ô chọn', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/catalog'))).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Loại thiết bị' }));
    expect(await screen.findByRole('option', { name: 'PC' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Máy fax/ })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Site' }));
    expect(await screen.findByRole('option', { name: /HCM/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /KHO-CU/ })).toBeNull();
  });

  it('hồ sơ đang trỏ vào loại đã vô hiệu vẫn hiện đúng tên, kèm "(ngừng dùng)"', async () => {
    mockFetch();
    renderForm({
      id: 'd1',
      code: 'FAX-01',
      name: 'Máy fax tầng 2',
      deviceTypeId: 't-off',
      siteId: 's-off',
      status: 'in_use',
    } as DeviceRow);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Loại thiết bị' })).toHaveTextContent(
        'Máy fax (ngừng dùng)',
      ),
    );
    expect(screen.getByRole('button', { name: 'Site' })).toHaveTextContent(/KHO-CU.*\(ngừng dùng\)/);
  });

  it('sửa: "giấy tờ lưu ngay" nằm trong nút (i) cạnh tiêu đề khu, không phải băng cảnh báo', async () => {
    mockFetch();
    renderForm({ id: 'd1', code: 'PC-01', name: 'Máy', deviceTypeId: 't-on', status: 'in_use' } as DeviceRow);
    const user = userEvent.setup();
    expect(screen.queryByText(/có hiệu lực ngay/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Giải thích: Giấy tờ đính kèm' }));
    expect(
      await screen.findByText('Tải lên / xóa ở đây được lưu ngay, không cần bấm Lưu.'),
    ).toBeInTheDocument();
  });

  /* Vị trí U trong tủ: hai ô chỉ hiện khi đã chọn tủ; bỏ tủ thì gửi U rỗng. */
  describe('U bắt đầu / Số U', () => {
    const WITH_CABINET = {
      ...LISTS,
      cabinets: [{ id: 'c-1', siteId: 's-on', siteCode: 'HCM', code: 'R1', description: null, uHeight: 42, active: true }],
    } as unknown as typeof LISTS;
    const inRack = {
      id: 'd1',
      code: 'SW-01',
      name: 'Switch',
      deviceTypeId: 't-on',
      siteId: 's-on',
      cabinetId: 'c-1',
      rackUStart: 5,
      rackUSize: 2,
      status: 'in_use',
    } as DeviceRow;

    it('không có tủ thì không có ô U', () => {
      mockFetch(WITH_CABINET);
      renderForm({ ...inRack, cabinetId: null, rackUStart: null, rackUSize: null });
      expect(screen.queryByRole('textbox', { name: 'U bắt đầu' })).toBeNull();
      expect(screen.queryByRole('textbox', { name: 'Số U' })).toBeNull();
    });

    it('có tủ: hiện U đang khai, sửa rồi Lưu gửi số', async () => {
      const calls = mockFetch(WITH_CABINET);
      renderForm(inRack);
      const start = await screen.findByRole('textbox', { name: 'U bắt đầu' });
      expect(start).toHaveValue('5');
      expect(screen.getByRole('textbox', { name: 'Số U' })).toHaveValue('2');
      const user = userEvent.setup();
      await user.clear(start);
      await user.type(start, '7');
      await user.click(screen.getByRole('button', { name: 'Lưu' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      const body = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!) as Record<string, unknown>;
      expect(body).toMatchObject({ cabinetId: 'c-1', rackUStart: 7, rackUSize: 2 });
    });

    it('Số U có nút − / + (Q-24): bấm + rồi Lưu gửi số mới', async () => {
      const calls = mockFetch(WITH_CABINET);
      renderForm(inRack);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Tăng số U' }));
      await user.click(screen.getByRole('button', { name: 'Lưu' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      const body = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!) as Record<string, unknown>;
      expect(body).toMatchObject({ rackUStart: 5, rackUSize: 3 });
    });

    it('xoá trống cả hai ô → gửi null (bỏ U)', async () => {
      const calls = mockFetch(WITH_CABINET);
      renderForm(inRack);
      const user = userEvent.setup();
      await user.clear(await screen.findByRole('textbox', { name: 'U bắt đầu' }));
      await user.clear(screen.getByRole('textbox', { name: 'Số U' }));
      await user.click(screen.getByRole('button', { name: 'Lưu' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
      const body = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!) as Record<string, unknown>;
      expect(body).toMatchObject({ rackUStart: null, rackUSize: null });
    });

    it('chỉ điền một ô → báo tại ô, không gửi', async () => {
      const calls = mockFetch(WITH_CABINET);
      renderForm(inRack);
      const user = userEvent.setup();
      await user.clear(screen.getByRole('textbox', { name: 'Số U' }));
      await user.click(screen.getByRole('button', { name: 'Lưu' }));
      const size = screen.getByRole('textbox', { name: 'Số U' });
      await waitFor(() => expect(size).toHaveAttribute('aria-invalid', 'true'));
      expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    });
  });

  it('hai khối luôn mở (Máy gì, Đặt ở đâu); phần còn lại gập, có số ô đã khai (Q-27)', async () => {
    mockFetch();
    renderForm(null);
    expect(screen.getByRole('heading', { name: 'Máy gì' })).toBeVisible();
    const where = screen.getByRole('heading', { name: 'Đặt ở đâu' }).closest('section');
    expect(where?.querySelector('.form-grid')).toHaveAttribute('data-columns', '4');
    for (const fold of ['Người dùng và phòng ban', 'Mua sắm và bảo hành', 'Truy cập quản trị', 'Ảnh và giấy tờ', 'Ghi chú']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${fold}`) })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.getByRole('button', { name: /^Mua sắm và bảo hành/ })).toHaveAccessibleName(expect.stringContaining('chưa khai'));
    // Ô trong khối gập vẫn ở trong DOM (hộp đo "đang gõ dở" bằng chúng) nhưng không tới được.
    expect(screen.queryByRole('textbox', { name: 'Ghi chú' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Ghi chú/ }));
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toHaveAttribute('rows', '2');
  });

  it('thứ tự trong "Máy gì": Model trước, rồi Mã · Tên gọi · Loại thiết bị', () => {
    mockFetch();
    renderForm(null);
    const what = screen.getByRole('heading', { name: 'Máy gì' }).closest('section') as HTMLElement;
    const labels = Array.from(what.querySelectorAll('label, .field-label')).map((el) => el.textContent?.replace('*', '').trim());
    const order = ['Model', 'Mã thiết bị', 'Tên gọi', 'Loại thiết bị'].map((name) => labels.findIndex((l) => l?.startsWith(name)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

/*
 * Dấu tích "đã lưu" trên nút Lưu chỉ thuộc về lượt bấm chính nút đó: "Lưu và nhân bản" giữ hộp
 * mở để khai máy kế, dấu tích nhảy lên nút Lưu đọc ra là đã lưu và đóng.
 */
describe('Form thiết bị — dấu tích ở đúng nút vừa bấm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.motion;
  });

  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByRole('textbox', { name: 'Mã thiết bị' }), 'SW-E2E-01');
    await user.type(document.getElementById('device-name') as HTMLInputElement, 'Switch E2E');
    await user.click(screen.getByRole('button', { name: 'Loại thiết bị' }));
    await user.click(await screen.findByRole('option', { name: 'PC' }));
  }

  it('"Lưu và nhân bản" → nút Lưu KHÔNG hiện dấu tích', async () => {
    document.documentElement.dataset.motion = 'on';
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Lưu và nhân bản' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mã thiết bị' })).not.toHaveValue('SW-E2E-01'));
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    expect(screen.getByRole('button', { name: /^Lưu$/ })).not.toHaveAttribute('data-done');
  });

  it('vế đối chứng: bấm Lưu → nút Lưu hiện dấu tích', async () => {
    document.documentElement.dataset.motion = 'on';
    mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Lưu$/ })).toHaveAttribute('data-done', 'true'));
  });
});
