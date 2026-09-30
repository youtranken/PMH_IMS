import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `web/src/lib/note-secret.ts` là bản chép của `note-secret.ts` bên này (hai gói npm rời nhau).
 * Bản chép không có cổng sẽ trôi: form cho qua thứ server chặn (người dùng mất công gõ lại),
 * hoặc chặn thứ server cho qua (người dùng bị nói sai luật). So nguyên file, chỉ bỏ khác biệt
 * xuống dòng — file lẻ trong repo có CRLF.
 */
const API_FILE = join(__dirname, 'note-secret.ts');
const WEB_FILE = join(__dirname, '..', '..', '..', 'web', 'src', 'lib', 'note-secret.ts');

function read(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

describe('luật ghi chú két: bản web trùng từng byte với bản api', () => {
  it('hai file giống hệt nhau', () => {
    expect(read(WEB_FILE)).toBe(read(API_FILE));
  });
});
