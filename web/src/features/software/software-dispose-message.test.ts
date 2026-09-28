import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { softwareDisposeMessage } from './software-dispose-message';

const t = i18n.t.bind(i18n);

describe('softwareDisposeMessage — câu hỏi lại khi thanh lý phần mềm (Q-11, Q-13)', () => {
  it('không còn máy nào dùng: không nhắc gì tới ghế', () => {
    const text = softwareDisposeMessage(t, 'SSL-WEB', 0, []);
    expect(text).toBe(
      'Đưa hồ sơ SSL-WEB vào kho thanh lý? Hồ sơ không còn được tính hạn và không vào email nhắc gia hạn.',
    );
  });

  it('≤10 máy: nói đúng là sẽ BỊ GỠ và liệt kê mã máy', () => {
    const text = softwareDisposeMessage(t, 'LIC-M365', 2, ['PC-01', 'PC-02']);
    expect(text).toContain('2 máy đang dùng sẽ bị gỡ license');
    expect(text).toContain('PC-01, PC-02');
    expect(text).not.toMatch(/giữ nguyên/);
  });

  it('>10 máy: chỉ nói số, không kéo dài câu hỏi bằng 11 mã', () => {
    const codes = Array.from({ length: 11 }, (_, i) => `PC-${i}`);
    const text = softwareDisposeMessage(t, 'LIC-M365', 11, codes);
    expect(text).toContain('11 máy đang dùng sẽ bị gỡ license');
    expect(text).not.toContain('PC-0');
  });

  it('chưa đọc được danh sách máy: vẫn nói số ghế từ hồ sơ', () => {
    const text = softwareDisposeMessage(t, 'LIC-M365', 3, null);
    expect(text).toContain('3 máy đang dùng sẽ bị gỡ license');
  });
});
