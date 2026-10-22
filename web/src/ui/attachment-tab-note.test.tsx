import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { AttachmentTabNote } from '@/ui/attachment-panel';

/*
 * UX-E20: form SỬA không nhúng panel giấy tờ (ghi thẳng, trùng tab Giấy tờ) — chỉ một dòng đếm
 * chỉ đường sang tab.
 */
describe('AttachmentTabNote', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đếm giấy tờ đang có và chỉ sang tab Giấy tờ; không có ô chọn file', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(200, [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(<AttachmentTabNote ownerType="isp" ownerId="i1" />);
    expect(await screen.findByText('3 Giấy tờ · quản lý ở tab Giấy tờ')).toBeInTheDocument();
    expect(screen.queryByLabelText('Chọn file để đính kèm')).toBeNull();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('ownerType=isp&ownerId=i1');
  });

  it('chưa đọc được số: vẫn chỉ đường, không bịa số 0', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(403, { code: 'FORBIDDEN' }))));
    renderWithI18n(<AttachmentTabNote ownerType="device" ownerId="d1" />);
    expect(await screen.findByText('Giấy tờ · quản lý ở tab Giấy tờ')).toBeInTheDocument();
    expect(screen.queryByText(/^0 Giấy tờ/)).toBeNull();
  });
});
