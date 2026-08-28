import { Injectable } from '@nestjs/common';
import { DevicesApiService } from '../devices/devices.api';
import { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import { SoftwareApiService } from '../software/software.api';

/**
 * KHO THANH LÝ — một MÀN TỔNG, không phải một bảng mới.
 *
 * Vì sao không thêm cột `disposed` hay bảng `disposal`: mỗi module ĐÃ CÓ trạng thái "ngừng
 * dùng" của riêng mình và đang là chủ vòng đời hồ sơ mình (AD-3) — thiết bị `retired`, phần
 * mềm `retired`, đường truyền `terminated`, tài khoản dịch vụ `disabled`. Thêm một cờ thứ hai
 * là tạo ra hai nguồn sự thật, và chúng sẽ lệch nhau đúng vào lúc có người đi đối chiếu.
 *
 * Cái THIẾU không phải trạng thái, mà là một chỗ để nhìn thấy chúng cùng lúc: bốn trạng thái
 * nằm ở bốn màn khác nhau, dưới bốn cái tên khác nhau, nên câu "công ty đã bỏ những gì" không
 * ai trả lời được.
 *
 * Chuyện "không tính hạn và không vào email digest" thì các module đã lo sẵn: cả ba nguồn hạn
 * (`devices`, `software`, `isp`) đều lọc `status <> retired/terminated` trong chính câu truy
 * vấn `findExpiringBetween`. Màn này KHÔNG được tự lọc lại lần nữa — hai chỗ cùng quyết định
 * một luật là hai chỗ có thể trôi lệch.
 *
 * Đọc qua `*.api.ts` của module chủ (AD-2), không SELECT bảng của họ.
 */
export const DISPOSAL_KINDS = ['device', 'software', 'isp', 'service_account'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  /** Nhãn phụ: loại thiết bị, loại phần mềm, nhà mạng… — thứ giúp nhận ra nó là cái gì. */
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
     * Bốn lượt gọi CHẠY SONG SONG. Nối tiếp thì màn này chờ bằng tổng bốn lượt, mà chúng
     * không phụ thuộc nhau chút nào.
     */
    const [devices, software, isp, accounts] = await Promise.all([
      this.devices.listRetired(),
      this.software.listRetired(),
      this.software.listTerminatedIsp(),
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
      ...isp.map((row) => ({
        kind: 'isp' as const,
        id: row.id,
        code: row.code,
        name: row.provider,
        detail: row.bandwidth ?? null,
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
