import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { SoftwareForm } from './software-form';
import type { SoftwareRow } from './software-types';

afterEach(() => vi.unstubAllGlobals());

const CATALOG = { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] };

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
});
