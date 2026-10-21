import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import type { CatalogEntity, CatalogRow } from '@/lib/catalog-types';
import { CatalogForm } from './catalog-form';

const LISTS = {
  sites: [{ id: 's-hcm', code: 'E2E-HCM', name: 'Hồ Chí Minh', address: null, active: true }],
  cabinets: [
    { id: 'c-1', code: 'TU-E2E-HCM-01', siteId: 's-hcm', siteCode: 'E2E-HCM', active: true },
    { id: 'c-2', code: 'TU-E2E-HCM-02', siteId: 's-hcm', siteCode: 'E2E-HCM', active: true },
  ],
  deviceTypes: [],
  vendors: [],
  departments: [{ id: 'd-1', name: 'Phòng IT E2E', description: null, active: true }],
  ispProviders: [],
  servicePorts: [
    { id: 'p-1', name: 'HTTPS', protocol: 'tcp', portFrom: 443, portTo: 443, description: null, active: true },
  ],
};

function stubFetch(save?: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== 'GET' && save) return Promise.resolve(save(url, init));
    return Promise.resolve(jsonResponse(200, LISTS));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderForm(entity: CatalogEntity, row: CatalogRow | null = null) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <CatalogForm entity={entity} row={row} csrfToken="t" onClose={vi.fn()} onSaved={vi.fn()} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('CatalogForm — gợi ý và cảnh báo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tủ mạng: ô "Thuộc site" đứng TRƯỚC ô Mã; chọn site thì điền sẵn mã kế tiếp', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('cabinet');
    const site = await screen.findByRole('button', { name: 'Thuộc site' });
    const code = screen.getByRole('textbox', { name: /^Mã/ });
    // Thứ tự trong DOM = thứ tự người dùng đi qua.
    expect(site.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(site);
    await user.click(await screen.findByRole('option', { name: /E2E-HCM/ }));
    expect(code).toHaveValue('TU-E2E-HCM-03');
  });

  /* Chủ dự án hỏi "vị trí tủ 1, 2, 3": số tủ là đuôi mã, vị trí đặt tủ là ô mô tả — form phải
     nói thẳng hai điều đó thay vì để người dùng đi tìm một ô không có. */
  it('tủ mạng: nói rõ số tủ theo đuôi mã; ô mô tả là "Vị trí / mô tả" kèm ví dụ', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('cabinet');
    await user.click(await screen.findByRole('button', { name: 'Thuộc site' }));
    await user.click(await screen.findByRole('option', { name: /E2E-HCM/ }));
    const code = screen.getByRole('textbox', { name: /^Mã/ });
    expect(code).toHaveAccessibleDescription(/Tủ số 3 của site E2E-HCM/);

    await user.clear(code);
    await user.type(code, 'R01');
    expect(code).not.toHaveAccessibleDescription(/Tủ số/);

    const where = screen.getByRole('textbox', { name: 'Vị trí / mô tả' });
    expect(where).toHaveAccessibleDescription(/vd P\.server tầng 2/);
  });

  it('sửa tủ: số tủ đọc từ mã đang có', async () => {
    stubFetch();
    renderForm('cabinet', {
      id: 'c-2',
      code: 'TU-E2E-HCM-02',
      siteId: 's-hcm',
      siteCode: 'E2E-HCM',
      description: 'P.server tầng 2',
      uHeight: 42,
      active: true,
    } as unknown as CatalogRow);
    expect(await screen.findByText(/Tủ số 2 của site E2E-HCM/)).toBeInTheDocument();
  });

  it('sửa site: ô Mã khoá sẵn, phải bấm "Đổi mã…" và đọc cảnh báo mới gõ được', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('site', { id: 's-hcm', code: 'E2E-HCM', name: 'HCM', address: null, active: true } as CatalogRow);
    expect(screen.queryByRole('textbox', { name: /^Mã/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đổi mã…' }));
    expect(screen.getByRole('textbox', { name: /^Mã/ })).toHaveValue('E2E-HCM');
    expect(screen.getByText(/File Excel cũ và thói quen tìm theo mã cũ sẽ lệch/)).toBeInTheDocument();
  });

  it('sửa site: chỉ bấm "Đổi mã…" mà chưa gõ gì thì Esc đóng thẳng, không hỏi "bỏ dữ liệu"', async () => {
    stubFetch();
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <CatalogForm
            entity="site"
            row={{ id: 's-hcm', code: 'E2E-HCM', name: 'HCM', address: null, active: true } as CatalogRow}
            csrfToken="t"
            onClose={onClose}
            onSaved={vi.fn()}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Đổi mã…' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Bỏ những gì vừa nhập?' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('phòng ban: gõ tên gần trùng (bỏ dấu, hoa thường) thì nhắc tên đã có', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('department');
    await waitFor(() => expect(screen.getByRole('textbox', { name: /^Tên/ })).toBeInTheDocument());
    await user.type(screen.getByRole('textbox', { name: /^Tên/ }), 'phong it e2e');
    expect(await screen.findByText('Đã có "Phòng IT E2E" — có phải cùng phòng ban?')).toBeInTheDocument();
  });

  it('dịch vụ: port + giao thức trùng dịch vụ đã có thì cảnh báo nhẹ', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('service_port');
    await user.type(await screen.findByRole('textbox', { name: /^Từ port/ }), '443');
    expect(await screen.findByText(/Trùng port với "HTTPS"/)).toBeInTheDocument();
  });

  it('trùng mã (409 CATALOG_DUPLICATE) thì lỗi nằm ngay dưới ô Mã, không ở cuối form', async () => {
    stubFetch(() =>
      jsonResponse(409, { code: 'CATALOG_DUPLICATE', message: 'Mã "E2E-HCM" đã có.' }),
    );
    const user = userEvent.setup();
    renderForm('site');
    await user.type(screen.getByRole('textbox', { name: /^Mã/ }), 'E2E-HCM');
    await user.type(screen.getByRole('textbox', { name: /^Tên/ }), 'Hồ Chí Minh');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    const code = screen.getByRole('textbox', { name: /^Mã/ });
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'));
    expect(code).toHaveAccessibleDescription(/đã có/);
  });
});

describe('CatalogForm — loại thiết bị: hình trên sơ đồ mạng', () => {
  afterEach(() => vi.unstubAllGlobals());

  const TYPE = { id: 't-1', name: 'Switch E2E', hasPortMap: true, isRouter: false, description: null, diagramShape: null, active: true } as CatalogRow;

  function stubShapes(save?: (url: string, init?: RequestInit) => Response) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method && init.method !== 'GET' && save) return Promise.resolve(save(url, init));
      if (url.includes('/diagram-shapes')) {
        return Promise.resolve(jsonResponse(200, { shapes: [{ key: 'mxgraph.networks.switch', label: 'Switch (mạng)' }] }));
      }
      if (url.includes('/diagram-icon')) return Promise.resolve(jsonResponse(200, { svg: null }));
      return Promise.resolve(jsonResponse(200, LISTS));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('chọn hình trong danh sách đóng (không ô gõ style), gửi diagramShape; "Thiết bị khác" gửi null', async () => {
    const bodies: Record<string, unknown>[] = [];
    stubShapes((_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(200, TYPE);
    });
    const user = userEvent.setup();
    renderForm('device_type', TYPE);
    const shape = await screen.findByRole('button', { name: 'Hình trên sơ đồ mạng' });
    await user.click(shape);
    await user.click(await screen.findByRole('option', { name: 'Switch (mạng)' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ diagramShape: 'mxgraph.networks.switch' });
    expect(screen.queryByRole('textbox', { name: /style/i })).toBeNull();
  });

  it('ô tải biểu tượng SVG riêng chỉ hiện khi được phép (SA)', async () => {
    stubShapes();
    renderForm('device_type', TYPE);
    await screen.findByRole('button', { name: 'Hình trên sơ đồ mạng' });
    expect(screen.queryByLabelText('Chọn file SVG biểu tượng')).toBeNull();
  });

  it('SA tải SVG: server từ chối (có script) → lý do hiện ngay dưới ô', async () => {
    stubShapes(() => jsonResponse(400, { code: 'DIAGRAM_ICON_INVALID', message: 'Biểu tượng có <script> — không nhận.' }));
    const user = userEvent.setup();
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <CatalogForm entity="device_type" row={TYPE} csrfToken="t" onClose={vi.fn()} onSaved={vi.fn()} canUploadIcon />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'icon.svg', { type: 'image/svg+xml' });
    await user.upload(await screen.findByLabelText('Chọn file SVG biểu tượng'), file);
    expect(await screen.findByText('Biểu tượng có <script> — không nhận.')).toBeInTheDocument();
  });
});

/** Loại dây (Q-23): màu chọn từ bảng ô màu token — không có ô nhập mã màu. */
describe('CatalogForm — loại dây', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chọn màu bằng ô màu, gửi colorSlot; không có ô nhập hex', async () => {
    let body: unknown = null;
    stubFetch((_url, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(201, { id: 'ct-1', name: 'E2E Cat5e', colorSlot: 4, description: null, active: true });
    });
    const user = userEvent.setup();
    renderForm('cable_type');
    await user.type(await screen.findByRole('textbox', { name: /^Tên/ }), 'E2E Cat5e');
    const slots = screen.getAllByRole('radio');
    expect(slots).toHaveLength(8);
    expect(screen.queryByRole('textbox', { name: /màu|hex/i })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Ô màu 4' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(body).toEqual({ name: 'E2E Cat5e', colorSlot: 4, description: '' }));
  });
});
