import { Injectable } from '@nestjs/common';
import type { StatusEvent } from '../../common/history';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService } from '../devices/devices.api';
import { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import { SoftwareApiService } from '../software/software.api';
import { UsersApiService } from '../users/users.api';
import { queryInventory, type DisposalQuery, type DisposalQueryResult } from './disposal-query';
import type { DisposalItem, DisposalKind } from './disposal.types';

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
export { DISPOSAL_KINDS, type DisposalItem, type DisposalKind } from './disposal.types';

export interface DisposalInventory extends DisposalQueryResult {
  /** Loại có nhiều hồ sơ hơn trần dòng của nguồn — `items` đang thiếu phần của chúng. */
  truncated: DisposalKind[];
}

@Injectable()
export class DisposalService {
  constructor(
    private readonly devices: DevicesApiService,
    private readonly software: SoftwareApiService,
    private readonly accounts: ServiceAccountsApiService,
    private readonly users: UsersApiService,
    private readonly config: SystemConfigService,
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
   * Một trang kho cho màn Kho thanh lý: lọc loại/từ khoá/khoảng ngày vào kho, sắp, cắt trang.
   *
   * Mỗi nguồn chỉ trả tối đa một trần dòng; vượt trần mà im lặng thì người đọc tưởng công ty
   * chỉ bỏ chừng đó thứ. `truncated` để màn hình nói thẳng loại nào đang hiện thiếu.
   */
  async inventory(query: DisposalQuery): Promise<DisposalInventory> {
    const [{ items, truncated }, timeZone] = await Promise.all([
      this.everything(),
      this.config.getString('appTimezone'),
    ]);
    return { ...queryInventory(items, query, timeZone), truncated };
  }

  /** Mọi dòng khớp bộ lọc, không cắt trang — cho file Excel (FR-028: xuất đúng thứ đang xem). */
  async exportRows(
    query: Omit<DisposalQuery, 'page' | 'limit'>,
  ): Promise<{ items: DisposalItem[]; timeZone: string }> {
    const [{ items }, timeZone] = await Promise.all([
      this.everything(),
      this.config.getString('appTimezone'),
    ]);
    const page = { page: 1, limit: Math.max(1, items.length) };
    return { items: queryInventory(items, { ...query, ...page }, timeZone).items, timeZone };
  }

  /**
   * Toàn bộ kho kèm AI đưa vào, KHI NÀO, VÌ SAO — đọc từ lịch sử của từng module chủ qua
   * `*.api.ts` (AD-2), một câu mỗi loại cho cả mẻ id, và một lượt tra họ tên cho cả kho.
   */
  private async everything(): Promise<{ items: DisposalItem[]; truncated: DisposalKind[] }> {
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

    const idsOf = (page: { items: { id: string }[] }) => page.items.map((row) => row.id);
    const [deviceEvents, softwareEvents, accountEvents, ispEvents] = await Promise.all([
      this.devices.retirementEvents(idsOf(devicePage)),
      this.software.retirementEvents(idsOf(softwarePage)),
      this.accounts.disableEvents(idsOf(accountPage)),
      this.software.ispTerminationEvents(idsOf(ispPage)),
    ]);
    const events: Record<DisposalKind, Map<string, StatusEvent>> = {
      device: deviceEvents,
      software: softwareEvents,
      service_account: accountEvents,
      isp: ispEvents,
    };
    const items = merge(devicePage.items, softwarePage.items, accountPage.items, ispPage.items).map(
      (item) => {
        const event = events[item.kind].get(item.id);
        return event
          ? { ...item, disposedAt: event.at, disposedBy: event.by, auto: event.auto, reason: event.reason }
          : item;
      },
    );

    const emails = [
      ...new Set(
        items
          .filter((item) => item.disposedBy && !item.auto)
          .map((item) => (item.disposedBy as string).toLowerCase()),
      ),
    ];
    const names = emails.length > 0 ? await this.users.namesByEmails(emails) : new Map<string, string>();
    return {
      items: items.map((item) => ({
        ...item,
        disposedByName: item.disposedBy ? (names.get(item.disposedBy.toLowerCase()) ?? null) : null,
      })),
      truncated,
    };
  }
}

/** Chưa đọc lịch sử (hoặc lịch sử không có dòng nào): ngày vào kho lùi về `updatedAt`. */
const UNKNOWN_EVENT = (updatedAt: Date | null | undefined) => ({
  disposedAt: updatedAt ?? null,
  disposedBy: null,
  disposedByName: null,
  auto: false,
  reason: null,
});

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
      ...UNKNOWN_EVENT(row.updatedAt),
    })),
    ...software.map((row) => ({
      kind: 'software' as const,
      id: row.id,
      code: row.code,
      name: row.name,
      detail: row.kind,
      status: row.status,
      updatedAt: row.updatedAt ?? null,
      ...UNKNOWN_EVENT(row.updatedAt),
    })),
    ...accounts.map((row) => ({
      kind: 'service_account' as const,
      id: row.id,
      code: row.code,
      name: row.name,
      detail: row.kind,
      status: row.status,
      updatedAt: row.updatedAt ?? null,
      ...UNKNOWN_EVENT(row.updatedAt),
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
      ...UNKNOWN_EVENT(row.updatedAt),
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
