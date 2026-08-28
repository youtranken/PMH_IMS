import { describe, expect, it } from 'vitest';
import { toNatHistory, type NatHistoryRow } from './nat-history-entries';

function row(over: Partial<NatHistoryRow> = {}): NatHistoryRow {
  return {
    id: 'h1',
    action: 'updated',
    actor: 'sa@pmh.com.vn',
    changes: null,
    createdAt: '2026-08-28T10:00:00Z',
    ...over,
  };
}

/**
 * Sổ NAT là thứ auditor hỏi nhiều nhất — "ai mở port 3389 ra internet, ngày nào, vì sao".
 * Bài kiểm này khóa cách những dòng đó được viết ra.
 */
describe('toNatHistory — dịch lịch sử rule NAT thành câu người đọc được', () => {
  const actions: { action: string; label: string }[] = [
    { action: 'created', label: 'Mở rule' },
    { action: 'updated', label: 'Sửa rule' },
    { action: 'voided', label: 'Gỡ rule' },
  ];

  for (const { action, label } of actions) {
    it(`"${action}" → "${label}"`, () => {
      expect(toNatHistory([row({ action })])[0].action).toBe(label);
    });
  }

  it('hành động lạ giữ nguyên mã thô — người đọc còn biết đường hỏi', () => {
    expect(toNatHistory([row({ action: 'exported' })])[0].action).toBe('exported');
  });

  it('không có thay đổi thì detail là null', () => {
    expect(toNatHistory([row()])[0].detail).toBeNull();
  });

  const details: { name: string; changes: NatHistoryRow['changes']; expected: string }[] = [
    {
      name: 'nới dải port',
      changes: { ports: { before: '8080', after: '8080-8090' } },
      expected: 'port ngoài: 8080 → 8080-8090',
    },
    {
      // `true/false` không phải tiếng Việt — dòng lịch sử phải đọc được bằng mắt thường.
      name: 'tắt rule dịch sang tiếng Việt',
      changes: { enabled: { before: true, after: false } },
      expected: 'trạng thái: Đang bật → Đã tắt',
    },
    {
      name: 'ô rỗng đọc ra (trống)',
      changes: { note: { before: null, after: 'mở theo yêu cầu anh Dũng' } },
      expected: 'ghi chú: (trống) → mở theo yêu cầu anh Dũng',
    },
    {
      name: 'nhiều thay đổi nối bằng dấu chấm phẩy',
      changes: {
        internalIp: { before: '172.16.10.5', after: '172.16.10.9' },
        usedBy: { before: 'Camera tầng 2', after: 'Đầu ghi NVR' },
      },
      expected: 'IP trong: 172.16.10.5 → 172.16.10.9; mở cho ai: Camera tầng 2 → Đầu ghi NVR',
    },
    {
      /*
       * Dòng "Gỡ rule" cố ý kèm `ports` không đổi để nói RÕ gỡ cái port nào — nhưng phải đọc
       * ra "port ngoài 8080", không phải "8080 → 8080".
       */
      name: 'trường đi kèm làm bối cảnh không vẽ mũi tên',
      changes: {
        ports: { before: '8080', after: '8080' },
        reason: { before: null, after: 'dịch vụ đã ngừng' },
      },
      expected: 'port ngoài 8080; lý do: (trống) → dịch vụ đã ngừng',
    },
  ];

  for (const { name, changes, expected } of details) {
    it(name, () => {
      expect(toNatHistory([row({ changes })])[0].detail).toBe(expected);
    });
  }
});
