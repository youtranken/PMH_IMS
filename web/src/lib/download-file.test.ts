import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { downloadFile, fileNameFrom, postForDownload } from '@/lib/download-file';
import { jsonResponse } from '@/test/test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadFile — lỗi đi qua luật chung của apiFetch', () => {
  it('401 vì PHIÊN CHẾT → đá về màn đăng nhập', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(downloadFile('/api/v1/devices/export', 'thiet-bi.xlsx')).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(window.location.href).toBe('/login');
  });
});

describe('postForDownload — POST JSON kèm CSRF, nhận file về', () => {
  it('gửi đúng phương thức + thân + CSRF; STEPUP_REQUIRED thành ApiError để hộp hỏi mã bắt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram' }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await postForDownload('/api/v1/diagrams/d1/versions/v1/exports', { format: 'pdf' }, 'tok', 'ban-ve.pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toMatchObject({ code: 'STEPUP_REQUIRED' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/diagrams/d1/versions/v1/exports');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"format":"pdf"}');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
  });
});

describe('fileNameFrom — tên file từ Content-Disposition', () => {
  it.each([
    ['ưu tiên filename* (UTF-8) hơn bản ASCII đi trước', `attachment; filename="E2E Xuat - v1.png"; filename*=UTF-8''E2E%20Xu%E1%BA%A5t%20-%20v1.png`, 'E2E Xuất - v1.png'],
    ['chỉ filename*', `attachment; filename*=UTF-8''thi%E1%BA%BFt-b%E1%BB%8B.xlsx`, 'thiết-bị.xlsx'],
    ['chỉ filename có ngoặc', 'attachment; filename="devices.xlsx"', 'devices.xlsx'],
    ['chỉ filename không ngoặc', 'attachment; filename=devices.xlsx', 'devices.xlsx'],
    ['không có gì → tên dự phòng', 'attachment', 'du-phong.xlsx'],
  ])('%s', (_label, header, expected) => {
    expect(fileNameFrom(header, 'du-phong.xlsx')).toBe(expected);
  });
});
