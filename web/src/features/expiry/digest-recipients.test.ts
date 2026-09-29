import { describe, expect, it } from 'vitest';
import { parseRecipients, recipientSuggestions } from './digest-recipients';

describe('parseRecipients — ô Người nhận thành từng email, đánh dấu email sai', () => {
  it('tách theo phẩy, chấm phẩy, xuống dòng; bỏ ô trống; giữ thứ tự gõ', () => {
    expect(parseRecipients('sep@pmh.com.vn, it@pmh.com.vn;\nketoan@pmh.com.vn ,, ')).toEqual([
      { email: 'sep@pmh.com.vn', valid: true },
      { email: 'it@pmh.com.vn', valid: true },
      { email: 'ketoan@pmh.com.vn', valid: true },
    ]);
  });

  it('email sai dạng được giữ lại kèm cờ sai — để tô đỏ đúng chip đó', () => {
    expect(parseRecipients('sep@pmh.com.vn, khong-phai-email, a@b')).toEqual([
      { email: 'sep@pmh.com.vn', valid: true },
      { email: 'khong-phai-email', valid: false },
      { email: 'a@b', valid: false },
    ]);
  });
});

describe('recipientSuggestions — gợi ý từ người nhận của các luật khác + chính mình', () => {
  const rules = [
    { recipients: ['it@pmh.com.vn', 'sep@pmh.com.vn'] },
    { recipients: ['IT@pmh.com.vn', 'ketoan@pmh.com.vn'] },
    { recipients: ['it@pmh.com.vn'] },
  ];

  it('dùng nhiều nhất đứng trước; không phân biệt hoa thường; kèm email của mình', () => {
    expect(recipientSuggestions(rules, 'sa@pmh.com.vn', '')).toEqual([
      'it@pmh.com.vn',
      'ketoan@pmh.com.vn',
      'sep@pmh.com.vn',
      'sa@pmh.com.vn',
    ]);
  });

  it('bỏ những email đã có trong ô', () => {
    expect(recipientSuggestions(rules, 'sa@pmh.com.vn', 'SEP@pmh.com.vn, it@pmh.com.vn')).toEqual([
      'ketoan@pmh.com.vn',
      'sa@pmh.com.vn',
    ]);
  });

  it('tối đa 6 gợi ý', () => {
    const many = [{ recipients: Array.from({ length: 10 }, (_, i) => `u${i}@pmh.com.vn`) }];
    expect(recipientSuggestions(many, 'sa@pmh.com.vn', '')).toHaveLength(6);
  });
});
