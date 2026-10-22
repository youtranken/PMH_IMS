import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
import { DeviceOnDiagrams } from './device-on-diagrams';

/**
 * "Có trên sơ đồ" ở hồ sơ thiết bị (T-01): trước khi thanh lý hay đổi cổng, IT cần biết bản vẽ nào
 * sẽ lệch kho. Chỉ tên + trạng thái (thông tin của cây, không cần mã); mở bản vẽ mới hỏi mã sơ đồ.
 */

const TREE = [
  { id: 'd1', parentId: null, name: 'PMH Tower E2E', status: 'official_draft', officialSeq: 3 },
  { id: 'd2', parentId: 'd1', name: 'Phòng server E2E', status: 'draft', officialSeq: null },
];

function mockFetch(byDevice: () => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v1/diagrams/by-device/dev-1')) return Promise.resolve(byDevice());
    if (url.endsWith('/api/v1/diagrams')) return Promise.resolve(jsonResponse(200, TREE));
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderCard() {
  return renderWithI18n(
    <MemoryRouter>
      <DeviceOnDiagrams deviceId="dev-1" />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Khu "Có trên sơ đồ" của hồ sơ thiết bị', () => {
  it('liệt kê bản vẽ có máy: tên là link mở bản vẽ và bay tới máy; trạng thái bằng chữ; không gọi nội dung bản vẽ', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, [{ id: 'd1', name: 'PMH Tower E2E' }, { id: 'd2', name: 'Phòng server E2E' }]));
    renderCard();
    const section = await screen.findByRole('region', { name: 'Có trên sơ đồ (2)' });
    const items = await within(section).findAllByRole('listitem');
    expect(within(items[0]).getByRole('link', { name: 'PMH Tower E2E' })).toHaveAttribute('href', '/diagrams/d1?focus=dev-1');
    expect(items[0]).toHaveTextContent('#3 · Chính thức · có bản nháp');
    expect(within(items[1]).getByRole('link', { name: 'Phòng server E2E' })).toHaveAttribute('href', '/diagrams/d2?focus=dev-1');
    expect(items[1]).toHaveTextContent('Bản nháp');
    expect(fetchMock.mock.calls.some(([url]) => /\/content|\/versions/.test(String(url)))).toBe(false);
  });

  it('máy chưa có trên bản vẽ nào: nói rõ, không để trống', async () => {
    mockFetch(() => jsonResponse(200, []));
    renderCard();
    const section = await screen.findByRole('region', { name: 'Có trên sơ đồ (0)' });
    expect(section).toHaveTextContent('Máy này chưa có trên bản vẽ nào.');
  });

  it('lỗi tải: báo lỗi + thử lại, không nói "chưa có trên bản vẽ nào"', async () => {
    mockFetch(() => jsonResponse(500, { code: 'INTERNAL', message: 'Lỗi E2E' }));
    renderCard();
    const section = await screen.findByRole('region', { name: 'Có trên sơ đồ' });
    expect(await within(section).findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(section).not.toHaveTextContent('chưa có trên bản vẽ nào');
  });
});
