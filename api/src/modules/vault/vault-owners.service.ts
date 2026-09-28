import { Injectable, NotFoundException } from '@nestjs/common';
import { DevicesApiService } from '../devices/devices.api';
import { ServiceAccountsApiService } from '../service-accounts/service-accounts.api';
import { SoftwareApiService } from '../software/software.api';
import { VaultService, type SecretOwnerType } from './vault.service';

/**
 * Một chủ thể đang giữ secret — CỐ Ý không có trường nào nói về nội dung két.
 *
 * Không `label`, không `kind`, không giá trị. Đây là ranh giới của trang tổng: nó trả lời
 * "máy nào / hồ sơ nào có két và có mấy ngăn", không trả lời "trong đó cất gì".
 */
export interface VaultOwnerSummary {
  ownerType: SecretOwnerType;
  ownerId: string;
  code: string;
  name: string;
  /** Site của thiết bị; hồ sơ phần mềm không có site nên luôn null. */
  siteCode: string | null;
  secretCount: number;
  lastChangeAt: Date;
  /** Hồ sơ chủ đã bị xoá mà secret còn treo — phải HIỆN để có người đi dọn. */
  orphan: boolean;
}

/** Chủ thể gọi bằng tên — `orphan` khi hồ sơ chủ đã bị xoá. */
export type OwnerIdentity = Pick<VaultOwnerSummary, 'code' | 'name' | 'siteCode' | 'orphan'>;

/**
 * Trang tổng của Két sắt (`/vault`).
 *
 * Vì sao được phép tồn tại trong khi FR-026 cấm liệt kê secret: nó liệt kê **CHỦ THỂ**, không
 * liệt kê secret. Không có tên ngăn, không có giá trị, và mở một ngăn vẫn phải vào đúng hồ sơ
 * rồi gõ TOTP như cũ (4.2). Lộ danh sách này ra thì kẻ đọc biết "SRV-01 có két" — thứ mà mở
 * màn Thiết bị cũng thấy — chứ không biết trong két có gì.
 *
 * Tra tên hồ sơ qua `*.api.ts` của module chủ (AD-2), không SELECT bảng `device`/`software`.
 * Số chủ thể có két là hàng chục, nên N lượt gọi ở đây là chấp nhận được và đổi lại là ranh
 * giới module còn nguyên.
 */
@Injectable()
export class VaultOwnersService {
  constructor(
    private readonly vault: VaultService,
    private readonly devices: DevicesApiService,
    private readonly software: SoftwareApiService,
    private readonly serviceAccounts: ServiceAccountsApiService,
  ) {}

  async list(): Promise<VaultOwnerSummary[]> {
    const summaries = await this.vault.listOwnerSummaries();

    const rows = await Promise.all(
      summaries.map(async (item): Promise<VaultOwnerSummary> => ({
        ...item,
        ...(await this.describe(item.ownerType, item.ownerId)),
      })),
    );

    // Nhiều ngăn nhất lên đầu — chỗ tập trung nhiều bí mật nhất là chỗ đáng soi trước.
    return rows.sort(
      (a, b) => b.secretCount - a.secretCount || a.code.localeCompare(b.code, 'vi'),
    );
  }

  /**
   * Mã + tên + site của MỘT chủ thể — dùng chung cho trang tổng và cho phiếu break-glass (người
   * duyệt phải biết "máy nào"). Một bản duy nhất để hai nơi không gọi cùng một máy bằng hai tên.
   */
  async describe(ownerType: SecretOwnerType, ownerId: string): Promise<OwnerIdentity> {
    try {
      /*
       * MỘT nhánh cho MỖI loại — không để loại mới rơi vào nhánh cuối.
       *
       * Nhánh cuối không điều kiện (`software.getById(...)`) sẽ lặng lẽ tra một `owner_type`
       * mới trong bảng `software`, không thấy, rồi hiện "hồ sơ đã bị xóa" cho một chủ thể vẫn
       * đang sống. `never` ở nhánh cuối biến chuyện đó thành lỗi biên dịch.
       */
      switch (ownerType) {
        case 'device': {
          const device = await this.devices.getById(ownerId);
          return { code: device.code, name: device.name, siteCode: device.siteCode, orphan: false };
        }
        case 'service_account': {
          const account = await this.serviceAccounts.getById(ownerId);
          return { code: account.code, name: account.name, siteCode: null, orphan: false };
        }
        case 'isp': {
          const line = await this.software.getIspById(ownerId);
          return { code: line.code, name: line.provider, siteCode: line.siteCode, orphan: false };
        }
        case 'software': {
          const software = await this.software.getById(ownerId);
          return { code: software.code, name: software.name, siteCode: null, orphan: false };
        }
        default: {
          const missed: never = ownerType;
          return missed;
        }
      }
    } catch (error) {
      /*
       * CHỈ "không tìm thấy" mới là mồ côi. Bắt trần mọi lỗi thì một trục trặc DB thoáng qua
       * cũng biến một cái máy đang sống thành "hồ sơ đã bị xóa" — và quản trị viên đọc dòng đó
       * rất có thể đi thu hồi những secret vẫn đang dùng. Lỗi khác phải nổi lên để màn hình báo
       * đúng là đang hỏng, không phải báo sai là đang rác.
       */
      if (!(error instanceof NotFoundException)) throw error;
      return { code: '—', name: '', siteCode: null, orphan: true };
    }
  }
}
