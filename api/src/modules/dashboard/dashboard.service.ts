import { Injectable, Logger } from '@nestjs/common';
import { ApprovalsApiService } from '../approvals/approvals.api';
import type { ApprovalRecord } from '../approvals/approvals.service';
import { DevicesApiService } from '../devices/devices.api';
import { ExpiryApiService } from '../expiry/expiry.api';
import type { UserRole } from '../auth/types';

/** Cửa sổ "tuần qua" của các khối tính theo tuần. */
const WEEK_DAYS = 7;
/** Cửa sổ mặc định của khối "sắp hết hạn" — cùng con số với màn Expiry để hai chỗ khớp nhau. */
const EXPIRY_WINDOW_DAYS = 30;

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
  ) {}

  async build(viewer: { email: string; role: UserRole }): Promise<Dashboard> {
    const isBoss = viewer.role === 'sa' || viewer.role === 'admin';
    const [expiring, breakGlass] = await Promise.all([
      this.expiringBlock(),
      // AC: Member thấy dashboard RÚT GỌN — không có khối break-glass toàn cục. Họ vẫn xem
      // được yêu cầu của chính mình ở màn Duyệt yêu cầu.
      isBoss ? this.breakGlassBlock() : emptyBlock<BreakGlassEntry>(),
    ]);

    return {
      expiring,
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
      const { items } = await this.expiry.list(EXPIRY_WINDOW_DAYS);
      return {
        available: true,
        total: items.length,
        // Gấp nhất lên đầu — sếp đọc từ trên xuống và thường chỉ đọc mấy dòng đầu.
        items: items
          .slice()
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .slice(0, 8)
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
  return error instanceof Error ? error.message : 'không rõ';
}
