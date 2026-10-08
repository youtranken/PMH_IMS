import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkLinkDialog } from '@/ui/bulk-link-dialog';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';

/**
 * E-09: "Nối hàng loạt" xếp theo luồng — Switch → Cổng bắt đầu → danh sách máy → tuỳ chọn ít dùng
 * (cổng cuối, cổng phía máy) để trong khối mở rộng.
 */
afterEach(() => vi.unstubAllGlobals());

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/ports/bulk-plan')) return Promise.resolve(jsonResponse(200, { ports: ['Gi1/0/5', 'Gi1/0/6'], reason: null }));
      return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [], cableTypes: [] }));
    }),
  );
}

describe('BulkLinkDialog', () => {
  it('thứ tự theo luồng: Switch → Cổng bắt đầu → danh sách máy; tuỳ chọn ít dùng gập lại', async () => {
    mockFetch();
    renderWithI18n(<BulkLinkDialog device={null} csrfToken="t" onClose={() => {}} onDone={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Nối hàng loạt' });
    const labels = Array.from(dialog.querySelectorAll('.lbl-t')).map((el) => el.textContent?.replace('*', '').trim());
    expect(labels.slice(0, 3)).toEqual(['Switch', 'Cổng bắt đầu', 'Thêm máy vào danh sách']);
    const advanced = within(dialog).getByText('Tùy chọn thêm').closest('details') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(within(advanced).getByLabelText('Cổng cuối (tùy chọn)')).toBeInTheDocument();
    expect(within(advanced).getByLabelText('Cổng phía các máy (tùy chọn)')).toBeInTheDocument();
  });
});
