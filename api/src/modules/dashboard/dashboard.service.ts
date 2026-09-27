import { Injectable, Logger } from '@nestjs/common';
import { ApprovalsApiService, type ApprovalRecord } from '../approvals/approvals.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService } from '../devices/devices.api';
import { DisposalApiService } from '../disposal/disposal.api';
import { ExpiryApiService } from '../expiry/expiry.api';
import { IpamApiService } from '../ipam/ipam.api';
import { VaultApiService } from '../vault/vault.api';
import type { UserRole } from '../auth/types';
import { pickLoadedSubnets, pickRecent, pickStaleOwners } from './dashboard-rules';
import { redactMessage } from '../../common/log-redact';

/** Cửa sổ "tuần qua" của các khối tính theo tuần. */
const WEEK_DAYS = 7;
/*
 * KHÔNG CÓ HẰNG SỐ CỬA SỔ "SẮP HẾT HẠN" Ở ĐÂY — và chỗ trống này là cố ý.
 *
 * Từng có `const EXPIRY_WINDOW_DAYS = 30`, kèm chú thích "cùng con số với màn Expiry để hai
 * chỗ khớp nhau". Ý định đúng, hệ quả sai: con số thật nằm ở `expiry.warning_days` trong
 * `system_config` (AD-11, DoD gạch 8), nên truyền 30 vào là GHI ĐÈ cấu hình. Sếp nâng ngưỡng
 * lên 60 ngày thì màn "Sắp hết hạn" nghe lời còn trang chủ vẫn 30 — mà trang chủ mới là chỗ
 * người ta đọc (A-08, vá 21/09).
 *
 * Hai bản sao của một con số chỉ khớp nhau cho tới lần đầu ai đó đổi một bản. Nên dashboard
 * thôi biết gì về cửa sổ: `expiry.list()` không tham số nghĩa là "anh tự quyết theo cấu hình".
 */
/**
 * Số dòng tối đa mỗi khối.
 *
 * Chuyện BÀY BIỆN, nên nằm trong code chứ không vào `system_config` — khác hẳn hai ngưỡng
 * "sắp đầy" và "két cũ" (0038), là luật nghiệp vụ và sẽ được siết dần. Trang này đọc trong ba
 * phút; khối nào dài hơn tám dòng thì người ta cuộn qua chứ không đọc, và cuối mỗi khối đã có
 * đường sang màn đầy đủ.
 */
const MAX_ITEMS = 8;

export interface DashboardBlock<T> {
  /**
   * `available: false` = module chưa deploy (Epic 9 chưa có). UI hiện "chưa có dữ liệu" gọn
   * gàng chứ KHÔNG hiện khối rỗng trông như hỏng, và cũng không giấu khối đi — sếp cần biết
   * là phần đó chưa có, không phải tưởng là không có sự cố nào.
   */
  available: boolean;
  items: T[];
  total: number;
}

export interface BreakGlassEntry {
  id: string;
  requester: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  reason: string;
  state: string;
  decidedBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

/** Dải mạng sắp đầy — FR-020 đã tính sẵn `percent`, đây chỉ chọn dòng nào đáng lên trang. */
export interface SubnetLoadEntry {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
  used: number;
  total: number;
  free: number;
  percent: number;
}

/**
 * Két lâu không đổi. CỐ Ý không có `label`/`kind` của secret — cùng ranh giới mà
 * `VaultOwnerSummary` giữ: nói "hồ sơ nào có két, mấy ngăn, đổi lần cuối bao giờ", không nói
 * trong đó cất gì.
 */
export interface StaleSecretEntry {
  ownerType: string;
  ownerId: string;
  code: string;
  name: string;
  secretCount: number;
  lastChangeAt: Date;
  daysSince: number;
}

/** Hồ sơ vừa vào kho thanh lý — cùng các loại với màn `/disposal`, không tự gộp lại lần nữa. */
export interface DisposedEntry {
  kind: string;
  id: string;
  code: string;
  name: string;
  detail: string | null;
  updatedAt: Date | null;
}

export interface Dashboard {
  expiring: DashboardBlock<{
    kind: string;
    label: string;
    endDate: string;
    daysLeft: number;
    link: string | null;
  }>;
  incidents: DashboardBlock<never>;
  breakGlass: DashboardBlock<BreakGlassEntry>;
  subnetLoad: DashboardBlock<SubnetLoadEntry>;
  staleSecrets: DashboardBlock<StaleSecretEntry>;
  disposed: DashboardBlock<DisposedEntry>;
}

/**
 * Bảng điều khiển (story 7.1, FR-025).
 *
 * Mục tiêu viết trong epic rất cụ thể: "sếp 3 phút sáng thứ Hai tự trả lời mọi câu hỏi". Nên
 * mỗi khối phải trả lời ĐÚNG MỘT câu, và trả lời được mà không cần bấm đi đâu.
 *
 * Mọi số liệu đi qua public api của module chủ (AD-2) — không một câu SQL chéo nào. Đây là
 * chỗ dễ phá AD-2 nhất trong cả hệ thống: một cái `JOIN` ở đây thì nhanh hơn thật, nhưng
 * dashboard sẽ thành nơi mọi bảng của mọi module gặp nhau, và không module nào đổi được lược
 * đồ của mình nữa.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly expiry: ExpiryApiService,
    private readonly approvals: ApprovalsApiService,
    private readonly devices: DevicesApiService,
    private readonly ipam: IpamApiService,
    private readonly vault: VaultApiService,
    private readonly disposal: DisposalApiService,
    private readonly config: SystemConfigService,
  ) {}

  async build(viewer: { email: string; role: UserRole }): Promise<Dashboard> {
    const isBoss = viewer.role === 'sa' || viewer.role === 'admin';
    /*
     * MỘT lần đọc đồng hồ cho cả trang.
     *
     * Mỗi khối tự gọi `new Date()` thì hai khối chạy song song có thể rơi hai bên nửa đêm, và
     * "180 ngày" ở khối này với "180 ngày" ở khối kia đếm từ hai mốc khác nhau — kiểu lệch chỉ
     * lộ ra lúc 0 giờ và không ai dựng lại được.
     */
    const now = new Date();

    const [expiring, breakGlass, subnetLoad, staleSecrets, disposed] = await Promise.all([
      this.expiringBlock(),
      // AC: Member thấy dashboard RÚT GỌN — không có khối break-glass toàn cục. Họ vẫn xem
      // được yêu cầu của chính mình ở màn Duyệt yêu cầu.
      isBoss ? this.breakGlassBlock() : emptyBlock<BreakGlassEntry>(),
      this.subnetLoadBlock(),
      /*
       * Khối két CHỈ cho SA/Admin, đúng bằng quyền của `GET /vault/owners` (26/08).
       *
       * Cắt ở TẦNG SERVICE chứ không để web ẩn khối đi: ẩn ở web thì bản đồ "công ty giữ bí
       * mật ở đâu" vẫn đi qua dây và Member mở tab mạng ra là đọc được.
       */
      isBoss ? this.staleSecretsBlock(now) : emptyBlock<StaleSecretEntry>(),
      this.disposedBlock(now),
    ]);

    return {
      expiring,
      subnetLoad,
      staleSecrets,
      disposed,
      /**
       * Epic 9 chưa deploy nên module `incidents` chưa tồn tại. Khai `available: false` thay
       * vì bịa một mảng rỗng: "chưa có phần này" và "tuần qua không có sự cố nào" là hai câu
       * KHÁC HẲN nhau, và sếp đọc nhầm câu thứ hai thì tưởng mọi thứ đang yên.
       */
      incidents: { available: false, items: [], total: 0 },
      breakGlass,
    };
  }

  private async expiringBlock(): Promise<Dashboard['expiring']> {
    try {
      /*
       * XIN ĐÚNG SỐ DÒNG SẼ BÀY, KHÔNG KÉO CẢ KHO VỀ RỒI CẮT (N-01, vá 21/09).
       *
       * Khối này hiện tối đa `MAX_ITEMS` dòng, nhưng bản trước kéo trọn cửa sổ qua ranh giới
       * module — đo được 7.662 bản ghi để bày 8 dòng. `total` nay là con số máy chủ đếm, nên
       * câu "còn bao nhiêu mục sắp hết hạn" vẫn đúng dù chỉ tải về 8 dòng.
       *
       * Nguồn đã sắp theo ngày hết hạn tăng dần, mà `daysLeft` suy ra từ chính ngày ấy — nên
       * `limit` cắt đúng những mục GẤP NHẤT, không cắt bừa.
       */
      const { items, total } = await this.expiry.list({ limit: MAX_ITEMS });
      return {
        available: true,
        total,
        items: items
          .slice()
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .map((row) => ({
            kind: row.kind,
            label: row.label,
            endDate: row.end,
            daysLeft: row.daysLeft,
            link: row.link ?? null,
          })),
      };
    } catch (error) {
      /**
       * Một khối hỏng KHÔNG được làm chết cả trang.
       *
       * Dashboard gom số liệu từ nhiều module; nếu `expiry` lỗi mà cả trang trắng thì sếp mất
       * luôn hai khối còn lại — và mất cả cái tín hiệu "có gì đó đang hỏng". Đây đúng là bài
       * học finding 2 của code review Epic 3, ở một hình dạng khác.
       */
      this.logger.warn(`khối sắp-hết-hạn lỗi: ${message(error)}`);
      return emptyBlock();
    }
  }

  /**
   * "Dải nào sắp hết chỗ" (FR-020).
   *
   * Câu này hôm nay chỉ trả lời được bằng cách mở màn IP rồi đọc từng thanh tiến trình — mà
   * không ai mở màn IP khi chưa có việc, nên dải đầy dần trong im lặng cho tới hôm cần cấp
   * gấp một địa chỉ thì không còn.
   *
   * `total` (số địa chỉ cấp được) đi kèm chứ không chỉ mỗi phần trăm: 95% của một /26 là còn
   * 3 chỗ, 95% của một /24 là còn 12 — hai mức khẩn khác hẳn nhau mà cùng một con số.
   */
  private async subnetLoadBlock(): Promise<Dashboard['subnetLoad']> {
    try {
      const minPercent = await this.config.getNumber('dashboardSubnetFullPercent');
      const loaded = pickLoadedSubnets(await this.ipam.listSubnets(), minPercent);

      return {
        available: true,
        // `total` đếm TẤT CẢ dải đạt ngưỡng, không phải số dòng đã cắt — badge "12" trên một
        // khối 8 dòng chính là thứ nói cho người đọc biết còn phải bấm xem tiếp.
        total: loaded.length,
        items: loaded.slice(0, MAX_ITEMS).map((row) => ({
          id: row.id,
          name: row.name,
          cidr: row.cidr,
          vlan: row.vlan,
          used: row.used,
          total: row.total,
          free: row.free,
          percent: row.percent,
        })),
      };
    } catch (error) {
      this.logger.warn(`khối dải-sắp-đầy lỗi: ${message(error)}`);
      return emptyBlock<SubnetLoadEntry>();
    }
  }

  /**
   * "Ngăn nào lâu quá không ai đụng tới".
   *
   * KHÔNG phải một hạn chót xoay mật khẩu: IMS không ép xoay theo lịch (xem 0038). Đây là một
   * câu rà soát — mật khẩu wifi khách đổi lần cuối năm 2024, tài khoản quản trị firewall của
   * một người đã nghỉ việc, những thứ chỉ lộ ra khi có ai đi nhìn.
   *
   * Dữ liệu đúng bằng `GET /vault/owners`: không nhãn, không loại, không giá trị.
   */
  private async staleSecretsBlock(now: Date): Promise<Dashboard['staleSecrets']> {
    try {
      const staleDays = await this.config.getNumber('dashboardSecretStaleDays');
      const stale = pickStaleOwners(await this.vault.listOwners(), staleDays, now);

      return {
        available: true,
        total: stale.length,
        items: stale.slice(0, MAX_ITEMS).map((row) => ({
          ownerType: row.ownerType,
          ownerId: row.ownerId,
          code: row.code,
          name: row.name,
          secretCount: row.secretCount,
          lastChangeAt: row.lastChangeAt,
          daysSince: row.daysSince,
        })),
      };
    } catch (error) {
      this.logger.warn(`khối két-lâu-không-đổi lỗi: ${message(error)}`);
      return emptyBlock<StaleSecretEntry>();
    }
  }

  /**
   * "Tuần qua công ty bỏ những gì".
   *
   * Đọc qua `disposal.api` chứ KHÔNG tự hỏi từng module rồi tự gộp: kho thanh lý đã là chỗ duy
   * nhất biết "ngừng dùng" gồm những loại nào, và bản gộp thứ hai ở đây sẽ lặng lẽ thiếu một
   * loại đúng vào hôm có ai thêm một loại mới.
   */
  private async disposedBlock(now: Date): Promise<Dashboard['disposed']> {
    try {
      const recent = pickRecent(await this.disposal.list(), WEEK_DAYS, now);

      return {
        available: true,
        total: recent.length,
        items: recent.slice(0, MAX_ITEMS).map((row) => ({
          kind: row.kind,
          id: row.id,
          code: row.code,
          name: row.name,
          detail: row.detail,
          updatedAt: row.updatedAt,
        })),
      };
    } catch (error) {
      this.logger.warn(`khối vừa-thanh-lý lỗi: ${message(error)}`);
      return emptyBlock<DisposedEntry>();
    }
  }

  private async breakGlassBlock(): Promise<Dashboard['breakGlass']> {
    try {
      const since = new Date(Date.now() - WEEK_DAYS * 86_400_000);
      const all = await this.approvals.list({ kind: 'break_glass' });
      const recent = all.filter((row) => row.createdAt.getTime() >= since.getTime());

      return {
        available: true,
        total: recent.length,
        items: await Promise.all(recent.slice(0, 8).map((row) => this.toEntry(row))),
      };
    } catch (error) {
      this.logger.warn(`khối break-glass lỗi: ${message(error)}`);
      return emptyBlock<BreakGlassEntry>();
    }
  }

  /**
   * Đổi `subject_id` thành thứ người đọc được.
   *
   * AC đòi khối này nói rõ "ai, THIẾT BỊ GÌ, lý do". Một dòng chỉ có uuid thì sếp phải đi tra,
   * và trang này sinh ra để KHỎI phải đi tra. Tra qua `devices.api`, không join bảng `device`.
   */
  private async toEntry(row: ApprovalRecord): Promise<BreakGlassEntry> {
    let subjectLabel = row.subjectId.slice(0, 8);
    if (row.subjectType === 'device') {
      const device = await this.devices.getById(row.subjectId).catch(() => null);
      if (device) subjectLabel = `${device.code} — ${device.name}`;
    }
    return {
      id: row.id,
      requester: row.requester,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectLabel,
      reason: row.reason,
      state: row.state,
      decidedBy: row.decidedBy,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
}

function emptyBlock<T>(): DashboardBlock<T> {
  return { available: false, items: [], total: 0 };
}

function message(error: unknown): string {
  return redactMessage(error);
}
