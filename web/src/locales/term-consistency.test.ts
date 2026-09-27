/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vi from './vi';

/**
 * ĐIỂM DANH: một khái niệm chỉ được mang MỘT tên trên toàn giao diện.
 *
 * ===== VÌ SAO LÀ MỘT BÀI KIỂM, KHÔNG PHẢI MỘT LẦN SỬA CÂU CHỮ =====
 *
 * Mục #25 của lượt rà 12/09 đã nêu đúng vấn đề này và **không ai tick**; lượt 19/09 đếm lại
 * thì vẫn nguyên sáu khái niệm hai tên. Lý do một lần sửa tay không đủ: khoá dịch nằm rải
 * trong một file 1400 dòng chia theo MÀN, nên hai người viết hai màn khác nhau đặt hai cái
 * tên cho cùng một việc là chuyện bình thường — và không có gì đỏ. Chính `accounts.disable`
 * đã "sống lại" một lần sau khi bị xoá (xem `dead-keys-rollcall.test.ts`).
 *
 * Nên thứ đáng dựng là cái cửa. Mỗi ô dưới đây khoá một CẶP khoá phải đọc giống nhau, kèm
 * chỗ hai bản đó đứng cạnh nhau trên màn — vì đó là thứ làm nó thành lỗi chứ không phải
 * thẩm mỹ.
 *
 * ===== KHOÁ GIÁ TRỊ, KHÔNG KHOÁ CÁCH VIẾT =====
 *
 * Bài này so GIÁ TRỊ hai khoá với nhau (`a === b`), không so với một hằng chép cứng trong
 * bài. Đổi cách xưng hô về sau chỉ phải sửa `vi.ts`; bài vẫn đúng. Đây là bài học của
 * `vault-surface.spec.ts` — nó khoá CÁCH VIẾT (`toContain("role !== 'sa'")`) nên đổi một
 * dấu cách là đỏ, mà đổi hành vi thì không.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

type Dict = Record<string, unknown>;

/** Đọc một khoá dạng `ns.key` trong cây `vi`. Ném nếu không có — khoá sai chính tả phải ĐỎ. */
function lookup(path: string): string {
  const value = path.split('.').reduce<unknown>((node, part) => (node as Dict)?.[part], vi);
  if (typeof value !== 'string') {
    throw new Error(`Khoá "${path}" không tồn tại hoặc không phải chuỗi trong vi.ts`);
  }
  return value;
}

describe('Một khái niệm — một tên', () => {
  /**
   * Hai nhãn này hiện trong CÙNG MỘT FORM, cách nhau 3cm: `nat-screen.tsx:626` bày ô chọn
   * giao thức của luật NAT, `service-port-picker.tsx:61` bày đúng khái niệm ấy trong ô chọn
   * cổng dịch vụ ngay bên cạnh.
   */
  it('giao thức "cả hai" chỉ có MỘT khoá, và cả hai ô cùng đọc nó', () => {
    // Không cho hai khoá cùng giá trị: hai khoá thì hai người sửa hai nơi rồi lệch lại.
    expect((vi as Dict).nat).not.toHaveProperty('protocolBoth');

    const natScreen = readFileSync(join(SRC, 'features/ipam/nat-screen.tsx'), 'utf8');
    const portPicker = readFileSync(join(SRC, 'features/ipam/service-port-picker.tsx'), 'utf8');
    expect(natScreen).toContain("t('catalog.protocolBoth')");
    expect(portPicker).toContain("t('catalog.protocolBoth')");
  });

  /**
   * Câu thông báo phải nói ĐÚNG việc vừa làm. Hồ sơ IP không bị xoá — nó bị ẩn đi và bật lại
   * được (`ipam.voidedBadge` = 'Đã ẩn', và có hẳn đường bật lại). Người dùng đọc "Đã xóa" rồi
   * đi khai lại từ đầu là mất công thật, không phải chuyện chữ nghĩa.
   */
  it('gỡ hồ sơ IP: nút, toast và badge nói cùng một việc', () => {
    for (const key of ['ipam.voidAddress', 'ipam.addressVoided', 'ipam.voidedBadge']) {
      expect(lookup(key).toLowerCase(), key).toContain('ẩn');
      expect(lookup(key).toLowerCase(), key).not.toMatch(/xóa|xoá/);
    }

    /*
     * Và "Xóa" phải còn nguyên nghĩa của nó ở chỗ xoá THẬT — dải chưa từng có hồ sơ IP nào thì
     * biến mất hẳn, không hoàn tác được. Dùng chung một chữ cho hai việc là chỗ người dùng trả
     * giá, nên ô này khoá cả chiều ngược lại.
     */
    expect(lookup('ipam.subnetDeleted').toLowerCase()).toMatch(/xóa|xoá/);

    const screen = readFileSync(join(SRC, 'features/ipam/subnet-detail.tsx'), 'utf8');
    expect(screen).not.toContain('t("common.delete")');
  });

  /**
   * Đợt D (12/09) khai đã bỏ tiếng lóng "đá phiên" — thật ra chỉ đổi cái NÚT. Câu hỏi trong
   * chính hộp mà nút đó mở ra vẫn giữ tiếng lóng, nên người dùng bấm "Đóng phiên" rồi được
   * hỏi "Đá phiên…?".
   */
  it('đóng phiên người khác: nút và câu hỏi dùng cùng một động từ', () => {
    expect(lookup('accounts.confirmKillSession')).toContain(lookup('accounts.killSession'));
  });

  it('vô hiệu hoá: danh mục và tài khoản dịch vụ dùng cùng một động từ', () => {
    expect(lookup('catalog.deactivate')).toBe(lookup('serviceAccounts.disable'));
  });

  /** Cột bảng nói "Seat", câu ngay DƯỚI cột nói "ghế" — cùng một màn `/software`. */
  it('ghế license: tên cột và câu chú dùng cùng một từ', () => {
    expect(lookup('software.seats').toLowerCase()).toContain('ghế');
  });

  /**
   * Cả ba đổ về cùng màn **Kho thanh lý**, nơi hồ sơ phần mềm hiện "Đã thanh lý license"
   * trong khi màn `/software` gọi chính nó là "Đã bỏ".
   */
  it('trạng thái đã ngừng dùng: ba màn đổ về Kho thanh lý dùng cùng một chữ', () => {
    expect(lookup('software.statusRetired')).toBe(lookup('devices.statusRetired'));
    expect(lookup('disposal.statusRetired')).toBe(lookup('devices.statusRetired'));
  });

  /**
   * Ba khoá cho MỘT trạng thái, ba cách viết ('Vô hiệu hóa' · 'Đã vô hiệu' · 'Đã vô hiệu hóa').
   * §4.2 của sổ chỉ nêu cặp `accounts`; hai cái kia lộ ra lúc sửa, 23/09. Ghi thành ô riêng để
   * lượt sau không phải đếm lại.
   */
  it('trạng thái đã vô hiệu: bốn màn dùng cùng một chữ', () => {
    expect(lookup('accounts.statusDisabled')).toBe(lookup('disposal.statusDisabled'));
    expect(lookup('serviceAccounts.statusDisabled')).toBe(lookup('disposal.statusDisabled'));
    expect(lookup('catalog.inactive')).toBe(lookup('disposal.statusDisabled'));
  });
});

/**
 * Panel Lịch sử giữ MỘT BỘ NHÃN RIÊNG (`history.<module>.st*`) song song với nhãn trên bảng
 * (`<module>.status*`). Nghĩa là mỗi trạng thái có hai khoá, và chúng trôi lệch được mà không
 * gì đỏ — đúng hình dạng của F-09 (năm bản sao `display()` ở chính panel này, và chúng ĐÃ lệch).
 *
 * Chuyện đã xảy ra thật: bảng `/software` đọc 'Đã thanh lý' trong khi dòng lịch sử ngay dưới
 * nó đọc 'Đã bỏ'. §4.2 của sổ đếm ba khoá màn và không thấy ba khoá lịch sử; chúng lộ ra
 * 23/09 chỉ vì `software-history-entries.test.ts` dùng `t` THẬT chứ không dùng stub.
 *
 * Bảng dưới là **mọi** cặp có thể đối chiếu được. Thêm module mới vào panel Lịch sử thì thêm
 * một dòng ở đây; quên thì không ai bắt được — nên dòng này quan trọng hơn nó trông.
 */
describe('Nhãn ở panel Lịch sử không được lệch nhãn trên bảng', () => {
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['history.devices.stRetired', 'devices.statusRetired'],
    ['history.software.stActive', 'software.statusActive'],
    ['history.software.stExpiredOk', 'software.statusExpiredOk'],
    ['history.software.stRetired', 'software.statusRetired'],
    ['history.serviceAccounts.stActive', 'serviceAccounts.statusActive'],
    ['history.serviceAccounts.stDisabled', 'serviceAccounts.statusDisabled'],
    ['history.isp.stActive', 'isp.statusActive'],
    ['history.isp.stSuspended', 'isp.statusSuspended'],
    ['history.isp.stTerminated', 'isp.statusTerminated'],
    ['history.ip.stFree', 'ipam.statusFree'],
    ['history.ip.stAssigned', 'ipam.statusAssigned'],
  ];

  it.each(PAIRS)('%s đọc giống %s', (historyKey, screenKey) => {
    expect(lookup(historyKey)).toBe(lookup(screenKey));
  });

  /** Q-04 chốt đúng ba chữ này cho đường truyền; file Excel phía API dùng cùng ba chữ. */
  it('đường truyền: Đang dùng / Tạm ngưng / Thanh lý', () => {
    expect(lookup('isp.statusActive')).toBe('Đang dùng');
    expect(lookup('isp.statusSuspended')).toBe('Tạm ngưng');
    expect(lookup('isp.statusTerminated')).toBe('Thanh lý');
  });

  /**
   * Q-10: IP có chủ đọc cùng chữ với phần mềm và đường truyền đang chạy. "Đang cấp" tả một
   * động tác chứ không tả một tình trạng, và đứng cạnh nút "Cấp IP" thì đọc như chưa xong.
   */
  it('IP có chủ: cùng chữ "Đang dùng" với phần mềm và đường truyền', () => {
    expect(lookup('ipam.statusAssigned')).toBe(lookup('isp.statusActive'));
    expect(lookup('ipam.statusAssigned')).toBe(lookup('software.statusActive'));
  });
});

describe('Nhãn trạng thái không được trùng nút bấm', () => {
  /**
   * Trên màn Tài khoản, badge trạng thái và nút hành động đứng trên cùng một hàng. Đọc giống
   * hệt nhau thì không phân biệt được "tài khoản NÀY đang bị vô hiệu" với "bấm để vô hiệu nó".
   */
  it('accounts: badge trạng thái khác chữ với nút', () => {
    expect(lookup('accounts.statusDisabled')).not.toBe(lookup('accounts.disable'));
  });
});

/**
 * "Chưa có gì" và "lọc không ra" là HAI cảnh, và lời khuyên cho chúng ngược nhau: một bên mời
 * thêm bản ghi đầu tiên, một bên mời nới bộ lọc. Bốn màn từng dùng chung một câu, nên một hệ
 * thống vừa cài xong báo "Chưa có thiết bị nào **khớp bộ lọc**" — người dùng mới đọc câu đó đi
 * tìm cái bộ lọc không tồn tại.
 *
 * Vị từ ở đây cố ý HẸP: câu `empty` (cảnh chưa lọc gì) không được nhắc tới bộ lọc. Nó không
 * bắt ai phải viết câu nào, chỉ chặn đúng lỗi đã xảy ra — và chặn được cho cả màn thứ năm.
 */
describe('Câu rỗng: "chưa có gì" không được nói về bộ lọc', () => {
  const MAN_HINH = ['devices', 'software', 'isp', 'serviceAccounts'];

  it.each(MAN_HINH)('%s có đủ cặp câu, và chúng khác nhau', (ns) => {
    expect(lookup(`${ns}.empty`)).not.toBe(lookup(`${ns}.emptyFiltered`));
    expect(lookup(`${ns}.emptyHint`)).not.toBe(lookup(`${ns}.emptyFilteredHint`));
  });

  it.each(MAN_HINH)('%s.empty không nhắc tới bộ lọc', (ns) => {
    expect(lookup(`${ns}.empty`).toLowerCase()).not.toContain('bộ lọc');
    expect(lookup(`${ns}.emptyHint`).toLowerCase()).not.toContain('bộ lọc');
  });

  it.each(MAN_HINH)('%s: màn thật sự chọn câu theo `isFiltered`', (ns) => {
    const FILE: Record<string, string> = {
      devices: 'features/devices/devices-screen.tsx',
      software: 'features/software/software-screen.tsx',
      isp: 'features/isp/isp-screen.tsx',
      serviceAccounts: 'features/service-accounts/service-accounts-screen.tsx',
    };
    // Khai đủ hai câu trong `vi.ts` mà màn không rẽ nhánh thì câu thứ hai là khoá chết đẹp đẽ.
    const source = readFileSync(join(SRC, FILE[ns]), 'utf8');
    expect(source).toContain(`url.isFiltered ? t('${ns}.emptyFiltered')`);
  });
});

describe('Không tiếng Anh lẫn trong câu tiếng Việt', () => {
  /**
   * Tên vai trò trong UI là 'Thành viên' / 'Quản trị' (`accounts.roleMember`, `accounts.roleAdmin`),
   * và `app.forbidden` đã viết đúng "nhờ Quản trị cấp quyền". Ba câu dưới thì nói "Member" và
   * "Admin" — cùng một vai, hai tên, trong cùng một sản phẩm.
   *
   * 'Super Admin' được phép: đó là tên riêng của vai SA, dùng nguyên vẹn ở mọi chỗ.
   */
  const PROSE_KEYS = ['access.noMembers', 'digest.readOnly'];

  it.each(PROSE_KEYS)('%s không chứa tên vai tiếng Anh', (key) => {
    const sentence = lookup(key).replace(/Super Admin/g, '');
    expect(sentence).not.toMatch(/\bMember\b/);
    expect(sentence).not.toMatch(/\bAdmin\b/);
  });
});
