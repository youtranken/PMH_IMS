import { DashboardService } from './dashboard.service';
import type { ExpiryApiService } from '../expiry/expiry.api';
import type { ApprovalsApiService } from '../approvals/approvals.api';
import type { ApprovalKindRegistry } from '../../common/approvals/approvals-registry';
import type { UsersApiService } from '../users/users.api';
import type { IpamApiService } from '../ipam/ipam.api';
import type { VaultApiService } from '../vault/vault.api';
import type { DisposalApiService } from '../disposal/disposal.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

/**
 * DASHBOARD KHÔNG ĐƯỢC TỰ ĐẶT CỬA SỔ "SẮP HẾT HẠN" (A-08, rà soát 19/09).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `dashboard.service.ts` khai `const EXPIRY_WINDOW_DAYS = 30` với chú thích "cùng con số với
 * màn Expiry để hai chỗ khớp nhau", rồi truyền thẳng con số ấy vào `expiry.list(...)`.
 *
 * Nhưng con số thật nằm ở `system_config` dưới khóa `expiry.warning_days` (AD-11, DoD gạch
 * 8), và `ExpiryService.clampWindow` đã lấy đúng nó làm mặc định. Truyền 30 vào là GHI ĐÈ cấu
 * hình: sếp đổi ngưỡng cảnh báo lên 60 ngày, màn "Sắp hết hạn" nghe lời, còn khối trên trang
 * chủ vẫn 30 — và trang chủ mới là chỗ người ta đọc.
 *
 * Chú thích hứa "hai chỗ khớp nhau" chính là thứ làm nó khó thấy: nó mô tả đúng ý định, và
 * sai về hệ quả. Hai bản sao của một con số chỉ khớp nhau cho tới lần đầu ai đó đổi một bản.
 *
 * ===== VÌ SAO ASSERT "KHÔNG TRUYỀN GÌ" CHỨ KHÔNG PHẢI "TRUYỀN ĐÚNG SỐ" =====
 *
 * Có hai cách vá. Cách thứ hai — dashboard tự đọc `expiry.warning_days` rồi truyền vào — chạy
 * được, nhưng nó đẻ ra người đọc thứ hai cho cùng một khóa, tức đúng cái hình dạng vừa gây ra
 * lỗi này, chỉ chậm hơn một nhịp. AD-15 nói ngược lại: một tài sản, một chủ.
 *
 * Nên hợp đồng đúng là dashboard KHÔNG biết gì về cửa sổ. Module `expiry` là chủ của câu hỏi
 * "sắp hết hạn nghĩa là trong bao nhiêu ngày", và nó đã trả lời sẵn khi không ai ép.
 */

/**
 * Cửa sổ mà dashboard hỏi module `expiry` — `undefined` = "anh tự quyết theo cấu hình".
 *
 * Từ 21/09 `list()` nhận một object (thêm `limit` cho N-01), nên bài này đọc `options.withinDays`
 * thay vì tham số vị trí thứ nhất. HỢP ĐỒNG không đổi: dashboard không được áp cửa sổ của
 * riêng mình. Chỉ hình dạng lời gọi đổi.
 */
let windowAsked: number | undefined | 'chưa hỏi' = 'chưa hỏi';

function buildService(): DashboardService {
  windowAsked = 'chưa hỏi';
  const expiry = {
    list: (options: { withinDays?: number } = {}) => {
      windowAsked = options.withinDays;
      return Promise.resolve({ items: [], total: 0, summary: {}, failedKinds: [] });
    },
  } as unknown as ExpiryApiService;

  const empty = () => Promise.resolve([]);
  const approvals = { list: empty } as unknown as ApprovalsApiService;
  const kinds = { describe: () => Promise.resolve(null) } as unknown as ApprovalKindRegistry;
  const users = { namesByEmails: () => Promise.resolve(new Map()) } as unknown as UsersApiService;
  const ipam = { listSubnets: empty } as unknown as IpamApiService;
  const vault = { listOwners: empty } as unknown as VaultApiService;
  const disposal = { list: empty } as unknown as DisposalApiService;
  const config = { getNumber: (name: string) => Promise.resolve(name === 'dashboardMaxItems' ? 8 : 80) } as unknown as SystemConfigService;

  return new DashboardService(expiry, approvals, kinds, ipam, vault, disposal, config, users);
}

describe('Khối "sắp hết hạn" của trang chủ', () => {
  it('KHÔNG áp cửa sổ của riêng mình — để module expiry đọc `expiry.warning_days`', async () => {
    await buildService().build({ email: 'sep@pmh.com.vn', role: 'admin' });
    expect(windowAsked).toBeUndefined();
  });

  it('Member cũng vậy — bản rút gọn không được đổi luật đọc hạn', async () => {
    await buildService().build({ email: 'nhan.vien@pmh.com.vn', role: 'member' });
    expect(windowAsked).toBeUndefined();
  });

  it('và nó có hỏi thật — vế đối chứng cho hai ca trên', async () => {
    await buildService().build({ email: 'sep@pmh.com.vn', role: 'admin' });
    expect(windowAsked).not.toBe('chưa hỏi');
  });
});
