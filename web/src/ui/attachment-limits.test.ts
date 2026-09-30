import { describe, expect, it } from 'vitest';
import {
  attachmentLimitsOf,
  DEFAULT_ATTACHMENT_LIMITS,
  screenAttachments,
} from '@/ui/attachment-limits';
import type { Me } from '@/lib/me';

const MB = 1024 * 1024;

function file(name: string, bytes: number): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

const names = (files: File[]) => files.map((f) => f.name);

describe('screenAttachments (Q-18) — lọc TRƯỚC khi gửi', () => {
  const limits = { maxSizeMb: 25, maxFiles: 3 };

  it.each([
    ['vừa trần', [file('a.pdf', 25 * MB)], ['a.pdf'], [], []],
    ['quá trần 1 byte', [file('a.pdf', 25 * MB + 1)], [], ['a.pdf'], []],
    [
      'quá số file: giữ theo thứ tự chọn, bỏ phần dư',
      [file('1.pdf', 1), file('2.pdf', 1), file('3.pdf', 1), file('4.pdf', 1)],
      ['1.pdf', '2.pdf', '3.pdf'],
      [],
      ['4.pdf'],
    ],
    [
      'file quá cỡ không chiếm chỗ trong lượt',
      [file('to.pdf', 30 * MB), file('1.pdf', 1), file('2.pdf', 1), file('3.pdf', 1)],
      ['1.pdf', '2.pdf', '3.pdf'],
      ['to.pdf'],
      [],
    ],
  ])('%s', (_label, picked, accepted, tooLarge, overCount) => {
    const result = screenAttachments(picked, limits);
    expect(names(result.accepted)).toEqual(accepted);
    expect(names(result.tooLarge)).toEqual(tooLarge);
    expect(names(result.overCount)).toEqual(overCount);
  });

  it('đã giữ sẵn N file (form thêm mới) thì chỉ còn chỗ cho phần còn lại', () => {
    const result = screenAttachments([file('3.pdf', 1), file('4.pdf', 1)], limits, 2);
    expect(names(result.accepted)).toEqual(['3.pdf']);
    expect(names(result.overCount)).toEqual(['4.pdf']);
  });
});

describe('attachmentLimitsOf — đọc trần từ `/auth/me`', () => {
  it('lấy đúng số API trả', () => {
    const me = { config: { fileMaxSizeMb: 10, fileMaxFilesPerBatch: 2 } } as unknown as Me;
    expect(attachmentLimitsOf(me)).toEqual({ maxSizeMb: 10, maxFiles: 2 });
  });

  it.each([[undefined], [null], [{} as Me], [{ config: {} } as unknown as Me]])(
    'phiên chưa về / thiếu cấu hình %j → mặc định, không phải 0 (0 là chặn mọi file)',
    (me) => {
      expect(attachmentLimitsOf(me)).toEqual(DEFAULT_ATTACHMENT_LIMITS);
    },
  );
});
