import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { AccessMatrixScreen } from './access-matrix-screen';

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const ACCOUNTS = [{ id: 'u-binh', email: 'binh@pmh.com.vn', fullName: 'Trần Bình', role: 'member' }];
const SCOPES = [
  { scopeType: 'device_site', scopeRef: 's-hn', label: 'Thiết bị tại E2E-HN' },
  { scopeType: 'device_type', scopeRef: 't-sw', label: 'Thiết bị loại Switch' },
  { scopeType: 'software_kind', scopeRef: 'ssl', label: 'Phần mềm: Chứng chỉ SSL' },
];
const RULES = [
  {
    id: 'r1',
    memberEmail: 'binh@pmh.com.vn',
    scopeType: 'device_type',
    scopeRef: 't-sw',
    scopeLabel: 'Thiết bị loại Switch',
    tier: 'whitelist',
    grantedBy: 'sa@pmh.com.vn',
    note: null,
  },
  {
    id: 'r2',
    memberEmail: 'binh@pmh.com.vn',
    scopeType: 'device_site',
    scopeRef: 's-hn',
    scopeLabel: 'Thiết bị tại E2E-HN',
    tier: 'needs_approval',
    grantedBy: 'sa@pmh.com.vn',
    note: null,
  },
];

function renderAt(entry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/vault/access/scopes')) return Promise.resolve(jsonResponse(200, SCOPES));
      if (url.includes('/vault/access/people')) return Promise.resolve(jsonResponse(200, ACCOUNTS));
      if (url.includes('/vault/access/tier')) {
        return Promise.resolve(
          jsonResponse(200, {
            tier: 'whitelist',
            groups: [
              { scopeType: 'device_site', scopeRef: 's-hn' },
              { scopeType: 'device_type', scopeRef: 't-sw' },
            ],
            matched: [
              { scopeType: 'device_type', scopeRef: 't-sw', tier: 'whitelist' },
              { scopeType: 'device_site', scopeRef: 's-hn', tier: 'needs_approval' },
            ],
          }),
        );
      }
      if (url.includes('/vault/access')) return Promise.resolve(jsonResponse(200, RULES));
      if (url.includes('/api/v1/devices')) {
        return Promise.resolve(jsonResponse(200, { items: [{ id: 'd1', code: 'SW-E2E-01', name: 'Switch lõi' }] }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    }),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <AccessMatrixScreen me={ME} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Quyền két sắt — số trong dòng tổng là lối lọc, Kiểm tra quyền chỉ đúng dòng sinh kết quả', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('"1 nhóm chưa gán cho ai" bấm được: sang Ma trận, chỉ còn đúng cột trống', async () => {
    renderAt('/admin/vault-access');
    await userEvent.click(await screen.findByRole('button', { name: '1 nhóm chưa gán cho ai' }));
    expect(await screen.findByRole('checkbox', { name: 'Chỉ nhóm chưa ai được gán' })).toBeChecked();
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '');
    expect(headers.some((text) => text.includes('Chứng chỉ SSL'))).toBe(true);
    expect(headers.some((text) => text.includes('Switch'))).toBe(false);
  });

  it('Kiểm tra quyền nói hồ sơ thuộc nhóm nào và DÒNG QUYỀN NÀO quyết định tầng', async () => {
    renderAt('/admin/vault-access');
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra quyền' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kiểm tra quyền xem két' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Người' }));
    await userEvent.click(screen.getByRole('option', { name: /Trần Bình/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Mã hồ sơ' }), 'SW-E2E-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra' }));
    expect(
      await within(dialog).findByText('Hồ sơ này thuộc nhóm: Thiết bị tại E2E-HN · Thiết bị loại Switch.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Vì dòng quyền: Thiết bị loại Switch · Xem thẳng.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Còn 1 dòng khớp khác nhưng hẹp hơn\./)).toBeInTheDocument();
  });
});
