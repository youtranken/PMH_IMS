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
 * Một lần sửa tay không đủ: khoá dịch nằm rải
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
   * Q-15: hồ sơ IP nhập nhầm thì "Xóa" — xóa để nhập lại, không khôi phục trên giao diện. Nút,
   * toast, dòng lịch sử và nhật ký nói cùng một việc; không còn chữ "ẩn" hay "bật lại" nào của
   * luồng này (người dùng đọc "ẩn" rồi đi tìm chỗ hiện lại — chỗ đó không còn).
   */
  it('xóa hồ sơ IP nhập nhầm: nút, toast, lịch sử và nhật ký nói cùng một việc', () => {
    expect(lookup('ipam.voidAddress')).toBe('Xóa');
    expect(lookup('ipam.addressVoided').toLowerCase()).toContain('đã xóa');
    expect(lookup('history.ip.actVoided')).toBe('Xóa hồ sơ IP nhập nhầm');
    expect(lookup('audit.actions.ipVoided')).toBe(lookup('history.ip.actVoided'));
    expect(lookup('ipam.voidAddressTitle')).toBe(lookup('history.ip.actVoided'));
    for (const key of ['ipam.voidAddress', 'ipam.addressVoided', 'ipam.voidAddressHint']) {
      expect(lookup(key).toLowerCase(), key).not.toMatch(/(^|[\s("])ẩn([\s.,)"]|$)|bật lại/u);
    }
    // Không còn đường khôi phục trên giao diện: khoá chữ của nó phải biến mất cùng nút.
    for (const key of ['restoreAddress', 'restoreAddressHint', 'addressRestored', 'voidReasonWas']) {
      expect((vi as Dict).ipam, key).not.toHaveProperty(key);
    }
    const screen = readFileSync(join(SRC, 'features/ipam/subnet-detail.tsx'), 'utf8');
    expect(screen).not.toContain('/restore`');
    expect(screen).not.toContain('includeVoided');

    // Hồ sơ tắt THEO DẢI là việc khác (dùng lại dải là sống lại) — đọc như dải.
    expect(lookup('ipam.voidedBadge')).toBe(lookup('ipam.disabledBadge'));
    expect(lookup('history.ip.actSubnetVoided')).toBe('Ngừng dùng theo dải');
  });

  /**
   * Đổi chữ ở NÚT mà quên câu hỏi trong chính hộp nút đó mở ra thì người dùng bấm "Đóng phiên"
   * rồi được hỏi "Đá phiên…?".
   */
  it('đóng phiên người khác: nút và câu hỏi dùng cùng một động từ', () => {
    expect(lookup('accounts.confirmKillSession')).toContain(lookup('accounts.killSession'));
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
    expect(lookup('disposal.statusTerminated')).toBe(lookup('devices.statusRetired'));
  });

  /**
   * Q-14: "Đã thanh lý" là TRẠNG THÁI, "Thanh lý" là HÀNH ĐỘNG. Hai chữ đứng cạnh nhau trên cùng
   * màn (nút đầu trang và badge trạng thái), nên đảo vai là đọc nhầm hồ sơ đã bỏ hay chưa.
   */
  it('nhãn trạng thái là "Đã thanh lý", nhãn nút là "Thanh lý"', () => {
    expect(lookup('devices.statusRetired')).toBe('Đã thanh lý');
    expect(lookup('devices.retire')).toBe('Thanh lý');
  });


  /** Kho thanh lý bày tài khoản dịch vụ đã ngừng: phải đọc đúng chữ của màn gốc. */
  it('kho thanh lý: tài khoản dịch vụ đã ngừng đọc giống màn gốc', () => {
    expect(lookup('disposal.statusDisabled')).toBe(lookup('serviceAccounts.statusDisabled'));
  });
});

/**
 * Panel Lịch sử giữ MỘT BỘ NHÃN RIÊNG (`history.<module>.st*`) song song với nhãn trên bảng
 * (`<module>.status*`). Nghĩa là mỗi trạng thái có hai khoá, và chúng trôi lệch được mà không
 * gì đỏ — đúng hình dạng của các bản sao `display()` ở chính panel này, vốn ĐÃ từng lệch.
 *
 * Chuyện đã xảy ra thật: bảng `/software` đọc 'Đã thanh lý' trong khi dòng lịch sử ngay dưới
 * nó đọc 'Đã bỏ'. Khoá lịch sử dễ bị đếm sót vì chúng không nằm cùng namespace màn; chúng chỉ
 * lộ ra khi bài kiểm dùng `t` THẬT chứ không dùng stub.
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

  /**
   * Q-04 + Q-14: trạng thái cuối là "Đã thanh lý" (kết quả), "Thanh lý" chỉ là nhãn nút. File
   * Excel phía API dùng cùng ba chữ.
   */
  it('đường truyền: Đang dùng / Tạm ngưng / Đã thanh lý', () => {
    expect(lookup('isp.statusActive')).toBe('Đang dùng');
    expect(lookup('isp.statusSuspended')).toBe('Tạm ngưng');
    expect(lookup('isp.statusTerminated')).toBe(lookup('devices.statusRetired'));
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

/**
 * Mọi chuỗi trong cây `vi`, kèm đường khoá — chú thích trong `vi.ts` không nằm ở đây. Bỏ chỗ
 * giữ `{{secrets}}`, `{{rules}}`: đó là tên biến, người dùng không đọc thấy.
 */
function allValues(node: unknown = vi, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node.replace(/\{\{\w+\}\}/g, '')]];
  if (node && typeof node === 'object') {
    return Object.entries(node as Dict).flatMap(([k, v]) => allValues(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/**
 * Q-15: chủ dự án chốt bộ thuật ngữ. Mỗi ô khoá một luật để chữ cũ không quay lại qua một khoá
 * mới viết theo thói quen.
 */
describe('Q-15: thuật ngữ đã chốt', () => {
  const VALUES = allValues();

  /**
   * "Break-glass", "Duyệt yêu cầu", "Xin quyền xem" và "secret" là tên kỹ thuật hoặc tên cũ của
   * cùng một việc. Người dùng chỉ gặp "Xin mở két" / "Duyệt mở két", và mật khẩu trong két gọi
   * là "ngăn" như ở màn két.
   */
  it('không còn tên cũ của việc mở két', () => {
    const bad = VALUES.filter(([, v]) =>
      /break.?glass|\bsecrets?\b|duyệt yêu cầu|xin quyền xem|tủ kính|xem tạm thời|mở két khẩn/i.test(v),
    );
    expect(bad).toEqual([]);
  });

  it('người xin gặp "Xin mở két", người duyệt gặp "Duyệt mở két"', () => {
    expect(lookup('vault.request')).toBe('Xin mở két');
    expect(lookup('nav.approvalsMine')).toBe(lookup('vault.request'));
    expect(lookup('approvals.titleMine')).toBe(lookup('vault.request'));
    expect(lookup('nav.approvals')).toBe('Duyệt mở két');
    expect(lookup('approvals.title')).toBe(lookup('nav.approvals'));
    expect(lookup('approvals.approveTitle')).toBe(lookup('nav.approvals'));
  });

  /**
   * Dải IP, tài khoản dịch vụ và luật NAT nằm cạnh nhau trong khu Mạng. Cùng một việc (cất đi,
   * giữ lịch sử, lấy lại được) phải cùng một cặp động từ, và badge khác nút.
   */
  it('dải IP · tài khoản dịch vụ · luật NAT: "Ngừng dùng / Dùng lại"', () => {
    for (const key of ['ipam.hide', 'serviceAccounts.disable', 'nat.disableRule']) {
      expect(lookup(key), key).toBe('Ngừng dùng');
    }
    for (const key of ['ipam.restore', 'serviceAccounts.enable', 'nat.enableRule']) {
      expect(lookup(key), key).toBe('Dùng lại');
    }
    for (const key of [
      'ipam.disabledBadge',
      'serviceAccounts.statusDisabled',
      'nat.disabled',
      'history.nat.stEnabledOff',
    ]) {
      expect(lookup(key), key).toBe('Đã ngừng dùng');
    }
  });

  /**
   * Danh mục cất một mục đi mà vẫn giữ cho hồ sơ cũ đọc — cùng việc với dải IP, nên cùng cặp
   * động từ. Tài khoản người dùng IMS thì KHÁC việc (khóa người, đóng phiên), nên giữ "Vô hiệu
   * hóa / Bật lại"; hai bên không được trôi về một chữ.
   */
  it('danh mục: "Ngừng dùng / Dùng lại"; tài khoản IMS giữ "Vô hiệu hóa / Bật lại"', () => {
    expect(lookup('catalog.deactivate')).toBe(lookup('ipam.hide'));
    expect(lookup('catalog.activate')).toBe(lookup('ipam.restore'));
    expect(lookup('catalog.inactive')).toBe(lookup('ipam.disabledBadge'));
    expect(lookup('history.catalog.actDeactivated')).toBe(lookup('catalog.deactivate'));
    expect(lookup('history.catalog.actActivated')).toBe(lookup('catalog.activate'));
    expect(lookup('audit.verb.deactivated')).toBe(lookup('catalog.deactivate'));
    expect(lookup('audit.verb.activated')).toBe(lookup('catalog.activate'));
    expect(lookup('formErrors.retiredOption')).toBe('(ngừng dùng)');

    expect(lookup('accounts.disable')).toBe('Vô hiệu hóa');
    expect(lookup('accounts.reactivate')).toBe('Bật lại');
    expect(lookup('accounts.statusDisabled')).toBe('Đã vô hiệu hóa');

    const catalogKeys = VALUES.filter(([k]) => /^(catalog|history\.catalog)\./.test(k));
    expect(catalogKeys.length).toBeGreaterThan(50);
    expect(catalogKeys.filter(([, v]) => /vô hiệu|bật lại/i.test(v))).toEqual([]);
  });

  /** NAT viết thuần Việt như các màn khác: "luật NAT", "cổng ngoài", "cổng trong". */
  it('không còn "rule" ở đâu, không còn "port" trong sổ NAT', () => {
    expect(VALUES.filter(([, v]) => /\brules?\b/i.test(v))).toEqual([]);
    const natKeys = VALUES.filter(([k]) => /^(nat|history\.nat|audit\.actions\.nat)/.test(k));
    expect(natKeys.length).toBeGreaterThan(50);
    expect(natKeys.filter(([, v]) => /\bports?\b|port-forward/i.test(v))).toEqual([]);
    expect(lookup('nat.external')).toBe('Cổng ngoài');
    expect(lookup('nat.internalPort')).toBe('Cổng trong');
    expect(lookup('nat.add')).toBe('Thêm luật NAT');
  });

  /** Menu Hệ thống có "Tài khoản dịch vụ" (Nghiệp vụ) ngay trên — hai chữ đầu giống nhau là bấm nhầm. */
  it('màn tài khoản đăng nhập IMS tên là "Người dùng IMS"', () => {
    expect(lookup('nav.accounts')).toBe('Người dùng IMS');
    expect(lookup('accounts.title')).toBe(lookup('nav.accounts'));
    expect(lookup('audit.objectType.user')).toBe(lookup('nav.accounts'));
    expect(lookup('audit.family.account')).toBe(lookup('nav.accounts'));
  });

  /**
   * Chỉ âm tiết MỞ có hai cách đặt dấu (khoá/khóa, hoá/hóa, tuỳ/tùy). Chốt kiểu dấu trên chữ cái
   * chính. "Quý" không tính: "qu" là phụ âm, dấu vốn nằm trên "y".
   */
  it('dấu đặt trên chữ cái chính: "khóa", "hóa", "tùy"', () => {
    const OLD = /(?:o[áàảãạ]|o[éèẻẽẹ]|(?<![qQ])u[ýỳỷỹỵ])(?!\p{L})/iu;
    expect(VALUES.filter(([, v]) => OLD.test(v))).toEqual([]);
  });
});
