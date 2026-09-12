import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { describeLoadError } from '@/lib/load-error-text';
import vi from '@/locales/vi';

/**
 * Bảng dữ liệu cho hàm thuần — đúng lối `CLAUDE.md` đòi cho logic thuần: một bảng, không dựng
 * React, không đi qua HTTP.
 */
describe('describeLoadError', () => {
  const cases: { ten: string; error: unknown; key: string; text: string | null }[] = [
    {
      ten: 'không có lỗi → câu chung, KHÔNG đoán thành mất mạng',
      error: undefined,
      key: 'app.loadError',
      text: null,
    },
    {
      ten: 'API có câu riêng → lấy nguyên câu đó',
      error: new ApiError(404, { message: 'Thiết bị không tồn tại hoặc đã bị xóa.' }),
      key: 'app.loadError',
      text: 'Thiết bị không tồn tại hoặc đã bị xóa.',
    },
    {
      ten: '403 trần → thiếu quyền',
      error: new ApiError(403, null),
      key: 'app.forbidden',
      text: null,
    },
    {
      ten: '404 trần → không tìm thấy dữ liệu',
      error: new ApiError(404, {}),
      key: 'app.notFoundData',
      text: null,
    },
    {
      ten: 'message rỗng/toàn khoảng trắng không tính là câu',
      error: new ApiError(403, { message: '   ' }),
      key: 'app.forbidden',
      text: null,
    },
    {
      /*
       * `global-exception.filter.ts` trả MỘT câu chung chung cho mọi 500, cố ý, để không lộ
       * nội bộ (từ 12/09 câu đó đã là tiếng Việt). Web vẫn dùng câu CỦA MÌNH thay vì bê câu
       * ấy ra: hai bên nói cùng một ý, nhưng chữ trên màn hình là việc của tầng giao diện —
       * và quan trọng hơn, quy tắc "500 thì đừng tin câu của server" phải đúng cả cho những
       * 500 KHÔNG đi qua filter (nginx sập, gateway chết) — lúc đó câu trả về là HTML.
       */
      ten: '500 → câu tiếng Việt của ta, không mượn câu của filter',
      error: new ApiError(500, { message: 'Máy chủ gặp lỗi không mong đợi.' }),
      key: 'app.serverError',
      text: null,
    },
    {
      ten: 'không phải ApiError → chưa tới được máy chủ',
      error: new TypeError('Failed to fetch'),
      key: 'app.serverUnreachable',
      text: null,
    },
  ];

  for (const c of cases) {
    it(c.ten, () => {
      const got = describeLoadError(c.error);
      expect(got.key).toBe(c.key);
      expect(got.text).toBe(c.text);
    });
  }

  it('mọi khóa hàm này trả về đều có thật trong vi.ts', () => {
    // Khóa gõ sai thì i18next in ra chính cái khóa — đúng lớp lỗi mục #1 của bản rà soát.
    const keys = new Set(cases.map((c) => c.key));
    const thieu = [...keys].filter(
      (key) => typeof (vi.app as Record<string, unknown>)[key.replace('app.', '')] !== 'string',
    );
    expect(thieu).toEqual([]);
  });
});
