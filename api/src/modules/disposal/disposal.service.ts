import { Injectable } from '@nestjs/common';
import { DevicesApiService } from '../devices/devices.api';
import { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import { SoftwareApiService } from '../software/software.api';

/**
 * KHO THANH LÝ — một MÀN TỔNG, không phải một bảng mới.
 *
 * Vì sao không thêm cột `disposed` hay bảng `disposal`: mỗi module ĐÃ CÓ trạng thái "ngừng
 * dùng" của riêng mình và đang là chủ vòng đời hồ sơ mình (AD-3) — thiết bị `retired`, phần
 * mềm `retired`, tài khoản dịch vụ `disabled`. Thêm một cờ thứ hai là tạo ra hai nguồn sự
 * thật, và chúng sẽ lệch nhau đúng vào lúc có người đi đối chiếu.
 *
 * Cái THIẾU không phải trạng thái, mà là một chỗ để nhìn thấy chúng cùng lúc: ba trạng thái
 * nằm ở ba màn khác nhau, dưới ba cái tên khác nhau, nên câu "công ty đã bỏ những gì" không
 * ai trả lời được.
 *
 * KHÔNG gom đường truyền (chốt 28/08/2026, sau khi xem bản chạy thật): một hợp đồng đã cắt
 * vẫn là hợp đồng có số, có ngày, có nhà mạng — người ta tra nó ở chính màn Đường truyền.
 * Kho là chỗ cho những thứ RỜI KHỎI hệ thống: cái máy đã bán, license đã bỏ, tài khoản đã đóng.
 *
 * Chuyện "không tính hạn và không vào email digest" thì các module đã lo sẵn: mọi nguồn hạn
 * đều lọc `status <> retired` trong chính câu truy vấn `findExpiringBetween`. Màn này KHÔNG
 * được tự lọc lại lần nữa — hai chỗ cùng quyết định một luật là hai chỗ có thể trôi lệch.
 *
 * Đọc qua `*.api.ts` của module chủ (AD-2), không SELECT bảng của họ.
 */
export const DISPOSAL_KINDS = ['device', 'software', 'service_account'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  /** Nhãn phụ: loại thiết bị, loại phần mềm, loại tài khoản — thứ giúp nhận ra nó là cái gì. */
  detail: string | null;
  /** Trạng thái THẬT trong module chủ, giữ nguyên tên gốc để tra ngược không nhầm. */
  status: string;
  updatedAt: Date | null;
}

@Injectable()
export class DisposalService {
  constructor(
    private readonly devices: DevicesApiService,
    private readonly software: SoftwareApiService,
    private readonly accounts: ServiceAccountsApiService,
  ) {}

  async list(): Promise<DisposalItem[]> {
    /*
     * Ba lượt gọi CHẠY SONG SONG. Nối tiếp thì màn này chờ bằng tổng ba lượt, mà chúng không
     * phụ thuộc nhau chút nào.
     */
    const [devices, software, accounts] = await Promise.all([
      this.devices.listRetired(),
      this.software.listRetired(),
      this.accounts.listDisabled(),
    ]);

    const items: DisposalItem[] = [
      ...devices.map((row) => ({
        kind: 'device' as const,
        id: row.id,
        code: row.code,
        name: row.name,
        detail: row.deviceTypeName ?? null,
        status: row.status,
        updatedAt: row.updatedAt ?? null,
      })),
      ...software.map((row) => ({
        kind: 'software' as const,
        id: row.id,
        code: row.code,
        name: row.name,
        detail: row.kind,
        status: row.status,
        updatedAt: row.updatedAt ?? null,
      })),
      ...accounts.map((row) => ({
        kind: 'service_account' as const,
        id: row.id,
        code: row.code,
        name: row.name,
        detail: row.kind,
        status: row.status,
        updatedAt: row.updatedAt ?? null,
      })),
    ];

    /*
     * Mới bỏ nhất lên đầu — người mở màn này thường đang hỏi "vừa thanh lý cái gì", không
     * phải "hồi 2019 bỏ cái gì". Hồ sơ chưa có `updatedAt` xuống cuối chứ không nhảy lên đầu.
     */
    return items.sort(
      (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    );
  }
}
