import { Injectable } from '@nestjs/common';
import { CatalogService, type CatalogLists } from './catalog.service';
import { normalizeKey } from '../../common/import-plan';
import type { CatalogSnapshot } from './catalog.types';

/**
 * AD-2: public api DUY NHẤT của module `catalog`. Module `devices` (và sau này ipam,
 * software, sheets) inject class này — KHÔNG import catalog.service/catalog.schema và
 * KHÔNG query bảng site/cabinet/device_type/vendor.
 */
@Injectable()
export class CatalogApiService {
  constructor(private readonly catalog: CatalogService) {}

  /** Bốn danh sách để đổ vào ô chọn của form thiết bị. Mặc định chỉ mục còn hiệu lực. */
  lists(options: { includeInactive?: boolean } = {}): Promise<CatalogLists> {
    return this.catalog.lists(options);
  }

  /** Ảnh chụp theo mã/tên đã chuẩn hóa — import thiết bị (2.6) đối chiếu bằng cái này. */
  snapshot(): Promise<CatalogSnapshot> {
    return this.catalog.snapshot();
  }

  /**
   * Kiểm tra bộ tham chiếu của một hồ sơ thiết bị. Trả về danh sách lỗi tiếng Việt
   * (rỗng = hợp lệ) thay vì ném: nơi gọi thường đang duyệt nhiều dòng import và cần
   * gom hết lỗi của một dòng, không phải dừng ở lỗi đầu tiên.
   */
  async validateRefs(refs: {
    siteId?: string | null;
    cabinetId?: string | null;
    deviceTypeId?: string | null;
    vendorId?: string | null;
  }): Promise<string[]> {
    const lists = await this.catalog.lists({ includeInactive: true });
    const errors: string[] = [];

    const site = refs.siteId ? lists.sites.find((s) => s.id === refs.siteId) : null;
    if (refs.siteId && !site) errors.push('Site không tồn tại.');

    if (refs.cabinetId) {
      const cabinet = lists.cabinets.find((c) => c.id === refs.cabinetId);
      if (!cabinet) {
        errors.push('Tủ mạng không tồn tại.');
      } else if (refs.siteId && cabinet.siteId !== refs.siteId) {
        // Bẫy hay gặp khi import: chọn site A nhưng gõ mã tủ của site B.
        errors.push(`Tủ "${cabinet.code}" không thuộc site đã chọn.`);
      }
    }
    if (refs.deviceTypeId && !lists.deviceTypes.some((t) => t.id === refs.deviceTypeId)) {
      errors.push('Loại thiết bị không tồn tại.');
    }
    if (refs.vendorId && !lists.vendors.some((v) => v.id === refs.vendorId)) {
      errors.push('Nhà cung cấp không tồn tại.');
    }
    return errors;
  }

  /** Loại này có bảng port map không (FR-006) — trang chi tiết thiết bị hỏi cái này. */
  async hasPortMap(deviceTypeId: string): Promise<boolean> {
    const lists = await this.catalog.lists({ includeInactive: true });
    return lists.deviceTypes.find((t) => t.id === deviceTypeId)?.hasPortMap ?? false;
  }

  /**
   * Tra id theo mã/tên người dùng gõ trong file Excel (không phân biệt hoa-thường).
   * Trả `null` khi không có — import thiết bị BÁO LỖI chứ không tự tạo danh mục (AC 2.6).
   */
  resolve(snapshot: CatalogSnapshot): CatalogResolver {
    return {
      site: (code) => snapshot.sites.get(normalizeKey(code))?.id ?? null,
      cabinet: (siteCode, code) =>
        snapshot.cabinets.get(`${normalizeKey(siteCode)} ${normalizeKey(code)}`)?.id ?? null,
      deviceType: (name) => snapshot.deviceTypes.get(normalizeKey(name))?.id ?? null,
      vendor: (name) => snapshot.vendors.get(normalizeKey(name))?.id ?? null,
    };
  }
}

export interface CatalogResolver {
  site(code: string): string | null;
  cabinet(siteCode: string, code: string): string | null;
  deviceType(name: string): string | null;
  vendor(name: string): string | null;
}
