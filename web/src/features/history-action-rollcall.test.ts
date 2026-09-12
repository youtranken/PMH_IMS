/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
// Tham chiếu ở đây mở đúng cho MỘT file, thay vì kéo kiểu Node vào toàn bộ mã app.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ACTION_LABEL as DEVICE_ACTIONS } from './devices/device-history-entries';
import { ACTION_LABEL as SOFTWARE_ACTIONS } from './software/software-history-entries';
import { ACTION_LABEL as SERVICE_ACCOUNT_ACTIONS } from './service-accounts/service-account-history-entries';
import { ACTION_LABEL as ISP_ACTIONS } from './isp/isp-history-entries';
import { ACTION_LABEL as NAT_ACTIONS } from './ipam/nat-history-entries';
import { ACTION_LABEL as IP_ACTIONS } from './ipam/ip-history-entries';

/**
 * ĐIỂM DANH: mọi mã thao tác API ghi vào sổ lịch sử đều phải có nhãn tiếng Việt.
 *
 * ===== VÌ SAO CẦN MỘT CỬA, KHÔNG PHẢI HAI DÒNG NHÃN =====
 *
 * Sáu file nhãn đều kết bằng `ACTION_LABEL[row.action] ?? row.action`. Cái `??` đó là một cửa
 * MỞ MẶC ĐỊNH: thêm một mã thao tác mới ở API mà quên khai nhãn thì không có gì đỏ, không có
 * gì cảnh báo — tab Lịch sử chỉ lặng lẽ in ra mã máy, và nó trông đủ giống một nhãn để không
 * ai thấy lạ.
 *
 * Chuyện đó đã xảy ra HAI LẦN trong cùng một bản vá (nhóm 3, 11/09), và không bài kiểm nào
 * bắt được:
 *   · `port-unlinked`   — `api/src/modules/devices/port-device-retirement.ts`
 *   · `device-detached` — `api/src/modules/software/isp-device-retirement.ts`
 * Cả hai chỉ lộ ra khi có người ngồi mở đúng tab Lịch sử của đúng cái máy còn lại, sau khi
 * thanh lý cái máy kia — tức gần như không bao giờ.
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
 * Nên bài chốt điều đơn giản mà chắc: mã ấy phải có nhãn ở ÍT NHẤT MỘT trong sáu bảng. Nó bắt
 * đúng kiểu hỏng đã xảy ra (mã mới, không nhãn ở đâu cả), và không bao giờ báo động giả. Việc
 * nhãn nằm đúng sổ vẫn là việc của người viết — nhưng người viết sẽ được nhắc, thay vì không.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, '..', '..', '..', 'api', 'src');

/** `x.recordWithin(tx, actor, id, 'ten-thao-tac'` — dạng gọi duy nhất đang dùng để ghi sổ. */
const RECORD_CALL = /recordWithin\(\s*tx\s*,[^;]{0,200}?,\s*'([a-z0-9-]+)'/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function actionsWrittenByApi(): Map<string, string> {
  /* Mã thao tác → file đầu tiên ghi nó, để câu báo lỗi chỉ thẳng chỗ cần sửa. */
  const found = new Map<string, string>();
  for (const file of walk(API_SRC)) {
    if (file.endsWith('.spec.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(RECORD_CALL)) {
      if (!found.has(match[1])) found.set(match[1], file.slice(API_SRC.length + 1));
    }
  }
  return found;
}

/**
 * NGOẠI LỆ PHẢI GIẢI THÍCH ĐƯỢC — không phải chỗ dập tắt cảnh báo.
 *
 * Cùng lối với `MAY_GROW` trong `e2e/leak-guard.ts`: kể tên thứ được phép đứng ngoài, KÈM LÝ DO,
 * thay vì nới vị từ cho tới khi bài hết đỏ.
 *
 * `catalog_history` có bảng, có `GET /catalog/history`, và lượt dọn E2E phải xử lý riêng nó —
 * nhưng KHÔNG màn nào trong `web/src` render lịch sử danh mục (kiểm 12/09: `HistoryPanel` xuất
 * hiện ở 6 màn, không có `catalog`). Không có giao diện thì không có nhãn để thiếu.
 *
 * Ngày nào mở màn đó ra, xoá dòng này đi — bài sẽ đỏ và nói luôn cần khai những nhãn nào.
 */
const KHONG_HIEN_TREN_GIAO_DIEN = new Set(['deleted']);

const LABELLED = new Set([
  ...Object.keys(DEVICE_ACTIONS),
  ...Object.keys(SOFTWARE_ACTIONS),
  ...Object.keys(SERVICE_ACCOUNT_ACTIONS),
  ...Object.keys(ISP_ACTIONS),
  ...Object.keys(NAT_ACTIONS),
  ...Object.keys(IP_ACTIONS),
]);

describe('Nhãn thao tác trong sổ lịch sử', () => {
  const written = actionsWrittenByApi();

  /*
   * SÀN CHỐNG REGEX HỤT — và đây là vế giữ cho cả bài có nghĩa.
   *
   * Nếu cách gọi `recordWithin` đổi hình dạng (đổi tên hàm, thêm tham số, xuống dòng khác đi)
   * thì regex trên trả về rỗng, và một bài "mọi mã tìm được đều có nhãn" sẽ XANH RỰC trong khi
   * nó chẳng kiểm gì cả. Con số 14 là số mã đếm được ngày 12/09; nó chỉ được phép TĂNG.
   */
  it('đọc được mã nguồn API (nếu không thì cả bài này vô nghĩa)', () => {
    expect(written.size).toBeGreaterThanOrEqual(14);
  });

  it('mọi mã thao tác API ghi ra đều có nhãn tiếng Việt', () => {
    const thieu = [...written.entries()]
      .filter(([action]) => !LABELLED.has(action) && !KHONG_HIEN_TREN_GIAO_DIEN.has(action))
      .map(([action, file]) => `${action}  (ghi ở ${file})`);

    // Jest/Vitest in ra nguyên mảng khi đỏ, nên người đọc thấy luôn mã nào thiếu và ghi ở đâu.
    expect(thieu).toEqual([]);
  });
});
