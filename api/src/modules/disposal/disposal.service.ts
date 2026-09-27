import { Injectable } from '@nestjs/common';
import { DevicesApiService } from '../devices/devices.api';
import { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import { SoftwareApiService } from '../software/software.api';

/**
 * KHO THANH LÝ — một MÀN TỔNG, không phải một bảng mới.
 *
 * Vì sao không thêm cột `disposed` hay bảng `disposal`: mỗi module ĐÃ CÓ trạng thái "ngừng
 * dùng" của riêng mình và đang là chủ vòng đời hồ sơ mình (AD-3) — thiết bị `retired`, phần
 * mềm `retired`, tài khoản dịch vụ `disabled`, đường truyền `terminated`. Thêm một cờ thứ hai
 * là tạo ra hai nguồn sự thật, và chúng sẽ lệch nhau đúng vào lúc có người đi đối chiếu.
 *
 * Cái THIẾU không phải trạng thái, mà là một chỗ để nhìn thấy chúng cùng lúc: bốn trạng thái
 * nằm ở bốn màn khác nhau, dưới bốn cái tên khác nhau, nên câu "công ty đã bỏ những gì" không
 * ai trả lời được.
 *
 * Đường truyền có mặt vì Q-10 (`docs/QUYET-DINH.md`): một đường đã cắt cũng là thứ công ty
 * đã bỏ, và thiếu nó thì câu trả lời ở đây hụt đúng một loại. Hồ sơ vẫn tra được ở màn Đường
 * truyền — kho chỉ nhìn, link dẫn về đúng trang chi tiết của nó.
 *
 * Chuyện "không tính hạn và không vào email digest" thì các module đã lo sẵn: mọi nguồn hạn
 * đều lọc `status <> retired` trong chính câu truy vấn `findExpiringBetween`. Màn này KHÔNG
 * được tự lọc lại lần nữa — hai chỗ cùng quyết định một luật là hai chỗ có thể trôi lệch.
 *
 * Đọc qua `*.api.ts` của module chủ (AD-2), không SELECT bảng của họ.
 */
export const DISPOSAL_KINDS = ['device', 'software', 'service_account', 'isp'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  /**
   * Nhãn phụ: loại thiết bị, loại phần mềm, loại tài khoản, băng thông đường truyền — thứ giúp
   * nhận ra nó là cái gì.
   */
  detail: string | null;
  /** Trạng thái THẬT trong module chủ, giữ nguyên tên gốc để tra ngược không nhầm. */
  status: string;
  updatedAt: Date | null;
}

export interface DisposalInventory {
  items: DisposalItem[];
  /** Loại có nhiều hồ sơ hơn trần dòng của nguồn — `items` đang thiếu phần của chúng. */
  truncated: DisposalKind[];
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
    const [devices, software, accounts, ispLines] = await Promise.all([
      this.devices.listRetired(),
      this.software.listRetired(),
      this.accounts.listDisabled(),
      this.software.listTerminatedIsp(),
    ]);
    return merge(devices, software, accounts, ispLines);
  }

  /**
   * Như `list`, kèm danh sách loại bị cắt ở trần dòng của nguồn — cho màn Kho thanh lý.
   *
   * Mỗi nguồn chỉ trả tối đa một trần dòng; vượt trần mà im lặng thì người đọc tưởng công ty
   * chỉ bỏ chừng đó thứ. `truncated` để màn hình nói thẳng loại nào đang hiện thiếu.
   */
  async inventory(): Promise<DisposalInventory> {
    const [devicePage, softwarePage, accountPage, ispPage] = await Promise.all([
      this.devices.retiredPage(),
      this.software.retiredPage(),
      this.accounts.disabledPage(),
      this.software.terminatedIspPage(),
    ]);
    const cut = (page: { items: unknown[]; total: number }) => page.total > page.items.length;
    const truncated = (
      [
        ['device', devicePage],
        ['software', softwarePage],
        ['service_account', accountPage],
        ['isp', ispPage],
      ] as const
    )
      .filter(([, page]) => cut(page))
      .map(([kind]) => kind);
    return {
      items: merge(devicePage.items, softwarePage.items, accountPage.items, ispPage.items),
      truncated,
    };
  }
}

function merge(
  devices: Awaited<ReturnType<DevicesApiService['listRetired']>>,
  software: Awaited<ReturnType<SoftwareApiService['listRetired']>>,
  accounts: Awaited<ReturnType<ServiceAccountsApiService['listDisabled']>>,
  ispLines: Awaited<ReturnType<SoftwareApiService['listTerminatedIsp']>>,
): DisposalItem[] {
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
    // Đường truyền không có "tên": nhà mạng là thứ người ta gọi nó bằng miệng ("line VNPT").
    ...ispLines.map((row) => ({
      kind: 'isp' as const,
      id: row.id,
      code: row.code,
      name: row.provider,
      detail: row.bandwidth ?? null,
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
