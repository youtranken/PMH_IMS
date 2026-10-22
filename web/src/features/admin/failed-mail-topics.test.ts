import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import vi from '@/locales/vi';
import { FAILED_MAIL_TOPIC_KEY } from './failed-mail-screen';

/**
 * Thư gửi lỗi hiện tên loại thư theo topic outbox. Topic mới ở API mà quên nhãn thì SA thấy mã
 * thô ("break_glass.code") đúng ở thư quan trọng nhất của Q-30. Bài này đọc thẳng mã API nên
 * thêm topic là đỏ ngay, không cần ai nhớ.
 */
const API = join(__dirname, '../../../../api/src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function apiTopics(): string[] {
  const found = new Set<string>();
  for (const file of tsFiles(API)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      for (const m of line.matchAll(/enqueue(?:Within)?\([^,]*,\s*['"]([a-z_]+(?:\.[a-z_]+)+)['"]/g)) found.add(m[1]);
      for (const m of line.matchAll(/TOPIC[A-Z_]*\s*[:=]\s*['"]([a-z_]+(?:\.[a-z_]+)+)['"]/g)) found.add(m[1]);
    }
  }
  return [...found].sort();
}

describe('Thư gửi lỗi: mọi loại thư của API đều có tên', () => {
  it('đọc được danh sách topic từ API (vế đối chứng: bài không trống trơn)', () => {
    expect(apiTopics()).toEqual(expect.arrayContaining(['expiry.digest', 'break_glass.code']));
  });

  it('mọi topic đều có nhãn tiếng Việt', () => {
    const missing = apiTopics().filter((topic) => !FAILED_MAIL_TOPIC_KEY[topic]);
    expect(missing).toEqual([]);
  });

  it('khóa nhãn trỏ vào chuỗi có thật trong vi.ts', () => {
    const topics = (vi as { failedMail: { topics: Record<string, string> } }).failedMail.topics;
    const dangling = Object.values(FAILED_MAIL_TOPIC_KEY).filter((key) => !topics[key.replace('failedMail.topics.', '')]);
    expect(dangling).toEqual([]);
  });
});
