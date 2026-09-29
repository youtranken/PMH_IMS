/// <reference types="node" />
// `tsconfig.app.json` chỉ có kiểu `vite/client`; tham chiếu này mở kiểu Node cho đúng một file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import vi from '@/locales/vi';
import { scanSource } from '@/test/scan-source';
import {
  ACTION_KEY,
  DANGER_ACTIONS,
  auditActionLabel,
  FAMILY_KEY,
  OBJECT_TYPE_KEY,
  TEMPLATE_PATTERNS,
  VERB_KEY,
} from './admin/audit-actions';
import { ACTION_LABEL as DEVICE_ACTIONS } from './devices/device-history-entries';
import { ACTION_LABEL as SOFTWARE_ACTIONS } from './software/software-history-entries';
import { ACTION_LABEL as SERVICE_ACCOUNT_ACTIONS } from './service-accounts/service-account-history-entries';
import { ACTION_LABEL as ISP_ACTIONS } from './isp/isp-history-entries';
import { ACTION_LABEL as CATALOG_ACTIONS } from './catalog/catalog-history-entries';

/**
 * ĐIỂM DANH: mọi mã hành động API ghi vào `audit_log` đều có nhãn tiếng Việt trên màn Nhật ký.
 *
 * `auditActionLabel` rơi về chính mã khi không biết — cửa MỞ MẶC ĐỊNH: thêm một `@Audited(...)`
 * mới mà quên nhãn thì không gì đỏ, màn Nhật ký chỉ lặng lẽ in mã máy. Bài này đọc thẳng mã
 * nguồn API (nơi sinh ra sự thật) thay vì chép danh sách mã vào đây.
 *
 * Ba ngả sinh mã:
 *   1. `@Audited('mã', …)` — interceptor ghi (hoặc service ghi cùng mã). Route khai nhiều mã
 *      thì khai qua một bảng hằng `const …ACTION… = { … }` — mọi chuỗi mã trong bảng đó được quét.
 *   2. `action: 'mã'` viết thẳng trong lời gọi ghi nhật ký — kể cả dạng `action: x ? 'a' : 'b'`
 *      và các khoá đuôi `Action` (`failedAction: 'mã'`) truyền mã sang một hàm ghi hộ. Chỉ lấy
 *      chuỗi CÓ DẤU CHẤM: mọi mã nhật ký đều có, còn `action: 'create'` của kế hoạch nhập Excel
 *      thì không. Script vận hành ghi thẳng bằng SQL (`INSERT INTO audit_log … VALUES (…)`) cũng
 *      được quét: dòng của nó hiện trên cùng màn Nhật ký.
 *   3. `action: \`device.${action}\`` — mã ghép lúc chạy. Mẫu phải có trong `TEMPLATE_PATTERNS`,
 *      và động từ ghép vào (chính là mã sổ lịch sử, đã có bài điểm danh riêng) phải có nhãn.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, '..', '..', '..', 'api', 'src');

function apiSources(): { rel: string; text: string }[] {
  return scanSource(API_SRC, /\.ts$/)
    .filter((f) => !f.endsWith('.spec.ts'))
    .map((f) => ({
      rel: f.slice(API_SRC.length + 1).replace(/\\/g, '/'),
      text: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1'),
    }));
}

const CODE = "[a-z_]+(?:\\.[a-z0-9_-]+)+";
const AUDITED = new RegExp(`@Audited\\(\\s*['"](${CODE})['"]`, 'g');
/* Vế phải của `action:` / `failedAction:` … tới dấu phẩy hay hết dòng; mọi chuỗi mã trong đó. */
const KEYED = /\b\w*[aA]ction:\s*([^,\n]+)/g;
const SQL_INSERT = /INSERT INTO audit_log[\s\S]*?VALUES\s*\(([^)]*)\)/g;
const QUOTED = new RegExp(`['"](${CODE})['"]`, 'g');
const CONST_ACTION = new RegExp(`const [A-Z_]*ACTION[A-Z_]*\\s*=\\s*['"](${CODE})['"]`, 'g');
const CONST_ACTION_TABLE = /const [A-Z_]*ACTION[A-Z_]*\s*=\s*\{([^}]*)\}/g;
const TEMPLATE = /\baction:\s*`([^`]+)`/g;

function scan() {
  const literal = new Map<string, string>();
  const templates = new Map<string, string>();
  for (const { rel, text } of apiSources()) {
    for (const re of [AUDITED, CONST_ACTION]) {
      for (const m of text.matchAll(re)) if (!literal.has(m[1])) literal.set(m[1], rel);
    }
    for (const re of [KEYED, SQL_INSERT, CONST_ACTION_TABLE]) {
      for (const m of text.matchAll(re)) {
        for (const q of m[1].matchAll(QUOTED)) if (!literal.has(q[1])) literal.set(q[1], rel);
      }
    }
    for (const m of text.matchAll(TEMPLATE)) {
      templates.set(m[1].replace(/\$\{[^}]*\}/g, '*'), rel);
    }
  }
  return { literal, templates };
}

const t = i18n.t;

function lookupKey(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (button, part) => (button && typeof button === 'object' ? (button as Record<string, unknown>)[part] : undefined),
      vi,
    );
}

describe('Nhãn hành động trên màn Nhật ký', () => {
  const { literal, templates } = scan();

  it('đọc được mã nguồn API (nếu không thì cả bài vô nghĩa)', () => {
    expect(literal.size).toBeGreaterThanOrEqual(80);
    expect(literal.get('vault.secret.revealed')).toBeDefined();
    // Ba ngả dễ lọt: vế sau của toán tử ba ngôi, khoá `failedAction`, và SQL của script vận hành.
    expect(literal.get('auth.password.ok')).toBeDefined();
    expect(literal.get('auth.password.change_failed')).toBeDefined();
    expect(literal.get('account.seeded')).toBeDefined();
    expect(literal.get('account.disabled')).toBeDefined();
    expect(templates.size).toBeGreaterThanOrEqual(5);
  });

  it('mọi mã viết thẳng trong API đều có nhãn tiếng Việt', () => {
    const missing = [...literal.entries()]
      .filter(([code]) => auditActionLabel(code, t) === code)
      .map(([code, file]) => `${code}  (ghi ở ${file})`);
    expect(missing).toEqual([]);
  });

  it('mọi mẫu mã ghép trong API đều đã khai (mẫu mới = họ mới cần nhãn)', () => {
    const known = new Set<string>(TEMPLATE_PATTERNS);
    const unexpected = [...templates.entries()]
      .filter(([pattern]) => !known.has(pattern))
      .map(([pattern, file]) => `${pattern}  (ở ${file})`);
    expect(unexpected).toEqual([]);
  });

  it('mã ghép từ động từ sổ lịch sử đều ra nhãn (device/software/isp/service_account/catalog)', () => {
    const families: [string[], Record<string, string>][] = [
      [['device'], DEVICE_ACTIONS],
      [['software'], SOFTWARE_ACTIONS],
      [['isp'], ISP_ACTIONS],
      [['service_account'], SERVICE_ACCOUNT_ACTIONS],
      [Object.keys(FAMILY_KEY).filter((f) => f.startsWith('catalog.')), CATALOG_ACTIONS],
    ];
    const missing: string[] = [];
    for (const [prefixes, table] of families) {
      for (const prefix of prefixes) {
        for (const verb of Object.keys(table)) {
          const code = `${prefix}.${verb}`;
          if (auditActionLabel(code, t) === code) missing.push(code);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('tập tô đỏ trên màn Nhật ký trùng đúng tập lọc "Chỉ sự kiện an ninh" của API', () => {
    const text = readFileSync(join(API_SRC, 'modules', 'audit', 'security-actions.ts'), 'utf8');
    const body = /SECURITY_AUDIT_ACTIONS[^=]*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? '';
    const api = [...body.matchAll(QUOTED)].map((m) => m[1]).sort();
    expect(api.length).toBeGreaterThan(5);
    expect([...DANGER_ACTIONS].sort()).toEqual(api);
  });

  it('mọi khoá trong bốn bảng tra đều có thật trong vi.ts', () => {
    const broken = [ACTION_KEY, FAMILY_KEY, VERB_KEY, OBJECT_TYPE_KEY]
      .flatMap((labelTable) => Object.entries(labelTable))
      .filter(([, key]) => typeof lookupKey(key) !== 'string')
      .map(([actionCode, key]) => `${actionCode} → ${key}`);
    expect(broken).toEqual([]);
  });
});
