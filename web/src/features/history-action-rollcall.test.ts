/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
// Tham chiếu ở đây mở đúng cho MỘT file, thay vì kéo kiểu Node vào toàn bộ mã app.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { quetNguon } from '@/test/quet-nguon';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import vi from '@/locales/vi';

import { ACTION_LABEL as DEVICE_ACTIONS } from './devices/device-history-entries';
import { ACTION_LABEL as SOFTWARE_ACTIONS } from './software/software-history-entries';
import { ACTION_LABEL as SERVICE_ACCOUNT_ACTIONS } from './service-accounts/service-account-history-entries';
import { ACTION_LABEL as ISP_ACTIONS } from './isp/isp-history-entries';
import { ACTION_LABEL as NAT_ACTIONS } from './ipam/nat-history-entries';
import { ACTION_LABEL as IP_ACTIONS } from './ipam/ip-history-entries';
import { ACTION_LABEL as CATALOG_ACTIONS } from './catalog/catalog-history-entries';

/**
 * ĐIỂM DANH: mọi mã thao tác API ghi vào sổ lịch sử đều phải có nhãn tiếng Việt.
 *
 * ===== VÌ SAO CẦN MỘT CỬA, KHÔNG PHẢI HAI DÒNG NHÃN =====
 *
 * Bảy file nhãn đều kết bằng `ACTION_LABEL[row.action] ?? row.action`. Cái `??` đó là một cửa
 * MỞ MẶC ĐỊNH: thêm một mã thao tác mới ở API mà quên khai nhãn thì không có gì đỏ, không có
 * gì cảnh báo — tab Lịch sử chỉ lặng lẽ in ra mã máy, và nó trông đủ giống một nhãn để không
 * ai thấy lạ.
 *
 * Ví dụ `port-unlinked` (`api/src/modules/devices/port-device-retirement.ts`) và
 * `device-detached` (`api/src/modules/software/isp-device-retirement.ts`): thiếu nhãn thì chỉ
 * lộ ra khi có người ngồi mở đúng tab Lịch sử của đúng cái máy còn lại, sau khi thanh lý cái
 * máy kia — tức gần như không bao giờ.
 *
 * ===== VÌ SAO ĐỌC THẲNG MÃ NGUỒN API =====
 *
 * Chép danh sách mã thao tác vào đây rồi so với bảng nhãn là dựng BẢN LUẬT THỨ HAI: hai danh
 * sách gõ tay cho cùng một khái niệm thì sớm muộn trả lời khác nhau, và cửa canh sẽ xanh trong
 * khi sản phẩm đã lệch. Nên bài này đi hỏi thẳng nơi sinh ra sự thật.
 *
 * ===== VÌ SAO CHỈ HỢP NHẤT, KHÔNG CHIA THEO TỪNG SỔ =====
 *
 * Muốn biết `port-unlinked` thuộc sổ nào thì phải lần theo người nhận lời gọi
 * (`this.devices.recordWithin` ở một file nằm trong thư mục `software/`…). Suy luận đó mong
 * manh, và mong manh theo hướng nguy hiểm: regex hụt một nhánh thì bài vẫn xanh.
 *
 * Nên bài chốt điều đơn giản mà chắc: mã ấy phải có nhãn ở ÍT NHẤT MỘT trong bảy bảng. Nó bắt
 * đúng kiểu hỏng đã xảy ra (mã mới, không nhãn ở đâu cả), và không bao giờ báo động giả. Việc
 * nhãn nằm đúng sổ vẫn là việc của người viết — nhưng người viết sẽ được nhắc, thay vì không.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, '..', '..', '..', 'api', 'src');

/*
 * HAI NGẢ GHI VÀO BẢY SỔ MÀ `HistoryPanel` HIỆN RA:
 *
 *   1. Lời gọi `recordWithin(tx, …)` — hàm ghi sổ của từng module. Mã thao tác có thể là chữ
 *      viết thẳng, một phép chọn giữa hai chữ (`active ? 'activated' : 'deactivated'`), hoặc
 *      một biến `const action = …` khai trong cùng file.
 *   2. Câu `tx.insert(<sổ>).values({ action: '…' })` viết thẳng — sổ IP ghi kiểu này, không qua
 *      `recordWithin`, nên chỉ quét ngả 1 thì không bao giờ thấy nó.
 *
 * `appendWithin` và `@Audited` KHÔNG thuộc danh sách: chúng chỉ ghi `audit_log`, và màn Nhật ký
 * hiện nguyên mã thao tác, không qua bảng nhãn nào. Quét chúng ở đây là đòi nhãn cho những mã
 * chỉ có trong nhật ký như `ip.transitioned` — bài đỏ vì thứ không ai nhìn thấy.
 *
 * Lời gọi nào đọc không ra mã (hình dạng lạ) thì vào `khongDocDuoc` và bài đỏ, thay vì lặng lẽ
 * bỏ qua — bài điểm danh bỏ sót im lặng thì xanh cả khi đã mù.
 */
const RECORD_CALL = /(?<!async |function )recordWithin\(/g;
const PANEL_INSERT =
  /\.insert\((deviceHistoryTable|softwareHistoryTable|serviceAccountHistoryTable|ispLineHistoryTable|natRuleHistoryTable|ipHistoryTable|catalogHistoryTable)\)\s*\.values\(/g;
const CODE = "'([a-z0-9._-]+)'";
const ACTION_ARG = new RegExp(`^(?:${CODE}|[\\w.!]+\\s*\\?\\s*${CODE}\\s*:\\s*${CODE})$`);

/* Bản dùng chung — xem `test/quet-nguon.ts` (bỏ qua thư mục dò của `lint-rules.test.ts`). */
const walk = (dir: string): string[] => quetNguon(dir, /\.ts$/);

/** Văn bản đối số của lời gọi có dấu `(` ở vị trí `open`, tới dấu đóng khớp với nó. */
function argumentText(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if ('({['.includes(source[i])) depth += 1;
    if (')}]'.includes(source[i])) depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Tách đối số ở tầng ngoài cùng — dấu phẩy trong `{…}` của `changes` không được cắt. */
function topLevelArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    if ('({['.includes(text[i])) depth += 1;
    if (')}]'.includes(text[i])) depth -= 1;
    if (text[i] === ',' && depth === 0) {
      out.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(text.slice(from).trim());
  return out.filter(Boolean);
}

const codesIn = (text: string): string[] =>
  [...text.matchAll(new RegExp(CODE, 'g'))].map((m) => m[1]);

/** Mã thao tác của một lời gọi `recordWithin` — rỗng nghĩa là không đọc ra được. */
function recordCallActions(args: string[], source: string): string[] {
  // Bỏ `tx` và `actor` — actor cũng có thể là chữ viết thẳng (`'system'` của lượt quét hạn).
  const rest = args.slice(2);
  const literal = rest.find((arg) => ACTION_ARG.test(arg));
  if (literal) return codesIn(literal);
  // Không có chữ viết thẳng → mã đi qua một biến `const <tên> = …;` trong cùng file.
  for (const arg of rest) {
    if (!/^\w+$/.test(arg)) continue;
    const decl = new RegExp(`const ${arg}\\s*=\\s*([^;]+);`).exec(source);
    if (decl && codesIn(decl[1]).length > 0) return codesIn(decl[1]);
  }
  return [];
}

/**
 * Sổ IP lưu thẳng NHÃN TIẾNG VIỆT cho bước chuyển trạng thái (`transitionLabel` → "Cấp IP",
 * "Thu hồi"), không phải mã, và web in nguyên chữ đó. Không có mã thì không có nhãn để thiếu.
 */
const DA_LA_NHAN = /\baction:\s*transitionLabel\(/;

function actionsWrittenByApi(): { found: Map<string, string>; khongDocDuoc: string[] } {
  /* Mã thao tác → file đầu tiên ghi nó, để câu báo lỗi chỉ thẳng chỗ cần sửa. */
  const found = new Map<string, string>();
  const khongDocDuoc: string[] = [];
  for (const file of walk(API_SRC)) {
    if (file.endsWith('.spec.ts')) continue;
    const rel = file.slice(API_SRC.length + 1).replace(/\\/g, '/');
    if (KHONG_HIEN_TREN_GIAO_DIEN.some((dir) => rel.startsWith(dir))) continue;
    const source = readFileSync(file, 'utf8');
    const add = (action: string) => {
      if (!found.has(action)) found.set(action, rel);
    };

    for (const match of source.matchAll(RECORD_CALL)) {
      const args = topLevelArgs(argumentText(source, match.index + match[0].length - 1));
      if (args[0] !== 'tx') continue;
      const actions = recordCallActions(args, source);
      if (actions.length === 0) khongDocDuoc.push(`recordWithin(${args.slice(0, 4).join(', ')})  ở ${rel}`);
      actions.forEach(add);
    }

    for (const match of source.matchAll(PANEL_INSERT)) {
      const body = argumentText(source, match.index + match[0].length - 1);
      const actions = [...body.matchAll(new RegExp(`\\baction:\\s*${CODE}`, 'g'))].map((m) => m[1]);
      // `action,` viết tắt = thân của chính hàm `recordWithin`; mã của nó đến từ ngả 1.
      const viaHelper = /\baction\s*[,}]/.test(body);
      if (actions.length === 0 && !viaHelper && !DA_LA_NHAN.test(body)) {
        khongDocDuoc.push(`insert(${match[1]})  ở ${rel}`);
      }
      actions.forEach(add);
    }
  }
  return { found, khongDocDuoc };
}

/**
 * NGOẠI LỆ PHẢI GIẢI THÍCH ĐƯỢC — không phải chỗ dập tắt cảnh báo.
 *
 * Cùng lối với `MAY_GROW` trong `e2e/leak-guard.ts`: kể tên thứ được phép đứng ngoài, KÈM LÝ DO,
 * thay vì nới vị từ cho tới khi bài hết đỏ. Hiện chưa có sổ nào được miễn.
 */
const KHONG_HIEN_TREN_GIAO_DIEN: string[] = [];

const MOI_BANG = [
  DEVICE_ACTIONS,
  SOFTWARE_ACTIONS,
  SERVICE_ACCOUNT_ACTIONS,
  ISP_ACTIONS,
  NAT_ACTIONS,
  IP_ACTIONS,
  CATALOG_ACTIONS,
];

const LABELLED = new Set(MOI_BANG.flatMap((bang) => Object.keys(bang)));

/** `history.devices.actCreated` → chuỗi thật trong `vi.ts`, hoặc `undefined` nếu chưa khai. */
function traKhoa(khoa: string): unknown {
  return khoa
    .split('.')
    .reduce<unknown>(
      (nut, phan) =>
        nut && typeof nut === 'object' ? (nut as Record<string, unknown>)[phan] : undefined,
      vi,
    );
}

describe('Nhãn thao tác trong sổ lịch sử', () => {
  const { found: written, khongDocDuoc } = actionsWrittenByApi();

  /*
   * SÀN CHỐNG REGEX HỤT — và đây là vế giữ cho cả bài có nghĩa.
   *
   * Nếu cách gọi `recordWithin` đổi hình dạng (đổi tên hàm, thêm tham số, xuống dòng khác đi)
   * thì regex trên trả về rỗng, và một bài "mọi mã tìm được đều có nhãn" sẽ XANH RỰC trong khi
   * nó chẳng kiểm gì cả. Con số 14 là một sàn đã đếm thật; nó chỉ được phép TĂNG.
   */
  it('đọc được mã nguồn API (nếu không thì cả bài này vô nghĩa)', () => {
    expect(written.size).toBeGreaterThanOrEqual(14);
  });

  /*
   * Sàn riêng cho từng ngả phụ: mỗi ngả phải còn bắt được ít nhất một mã nó sinh ra để bắt.
   * Sàn tổng ở trên không đủ — ngả 1 một mình đã vượt 14, nên ngả 2 mù hẳn vẫn không đỏ.
   */
  it('mỗi ngả ghi sổ đều còn đọc ra mã', () => {
    // Ngả 2 — `insert(ipHistoryTable)` viết thẳng.
    expect(written.get('ip.created')).toBe('modules/ipam/ip-address.service.ts');
    expect(written.get('ip.voided')).toBeDefined();
    // Ngả 1 qua biến `const action = …`.
    expect(written.get('disabled')).toBe('modules/service-accounts/service-account.service.ts');
    expect(written.get('enabled')).toBeDefined();
  });

  it('không có lời gọi ghi sổ nào mà bài không đọc ra mã', () => {
    expect(khongDocDuoc).toEqual([]);
  });

  /*
   * ===== CỬA THỨ HAI: KHÓA NHÃN PHẢI CÓ THẬT =====
   *
   * Nhãn sổ lịch sử nằm ở `vi.ts`, nên các bảng này không chứa CHỮ mà chứa KHÓA. Lối hỏng:
   * ô trong bảng trỏ tới một khóa không tồn tại, và i18next rơi về chính cái khóa — tab Lịch
   * sử in ra `history.devices.actCreated`. Nên nó phải có cửa canh của riêng nó, không phải
   * một lời hứa.
   */
  it('mọi khóa trong bảy bảng nhãn đều có thật trong vi.ts', () => {
    const hong: string[] = [];
    for (const bang of MOI_BANG) {
      for (const [ma, khoa] of Object.entries(bang)) {
        if (typeof traKhoa(khoa) !== 'string') hong.push(`${ma} → ${khoa}`);
      }
    }
    expect(hong).toEqual([]);
  });

  it('mọi mã thao tác API ghi ra đều có nhãn tiếng Việt', () => {
    const thieu = [...written.entries()]
      .filter(([action]) => !LABELLED.has(action))
      .map(([action, file]) => `${action}  (ghi ở ${file})`);

    // Jest/Vitest in ra nguyên mảng khi đỏ, nên người đọc thấy luôn mã nào thiếu và ghi ở đâu.
    expect(thieu).toEqual([]);
  });
});
