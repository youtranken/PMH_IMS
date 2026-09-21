import { Injectable } from '@nestjs/common';
import { CatalogService, type CatalogLists } from './catalog.service';
import { normalizeKey } from '../../common/import-plan';
import type { CatalogSnapshot } from './catalog.types';

/**
 * Câu từ chối cho "gắn tủ mà không khai site" — MỘT bản chữ cho CẢ HAI cửa (AD-15).
 *
 * Cửa Excel (`device-import.ts`) chặn chuyện này từ 08/09; cửa HTTP thì không, và đó là A-11.
 * Vá xong mà mỗi cửa tự viết một câu thì hai câu sẽ trôi khỏi nhau đúng như hai phép kiểm vừa
 * trôi khỏi nhau — nên chữ cũng phải dùng chung, không chỉ luật.
 *
 * Câu phải nêu được MÃ TỦ (người sửa cần biết vướng cái nào) và cả HAI đường ra: khai site,
 * hoặc bỏ tủ. Chỉ nói "thiếu site" thì người đang cố gỡ một hồ sơ cũ khỏi tủ sẽ không biết
 * rằng họ được phép làm thế.
 */
export function cabinetWithoutSiteMessage(cabinetCode: string): string {
  return `Thiết bị đang gắn tủ "${cabinetCode}" mà không có site. Khai Site, hoặc bỏ trống ô Tủ mạng.`;
}

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
      } else if (!refs.siteId) {
        /*
         * TỦ MÀ KHÔNG CÓ SITE — A-11, vá 21/09.
         *
         * Bản trước viết `else if (refs.siteId && cabinet.siteId !== refs.siteId)`. Vế
         * `refs.siteId &&` ở đầu làm cả phép kiểm BIẾN MẤT khi site trống, nên
         * `{"siteId": ""}` trên một thiết bị đang gắn tủ đi qua cửa trọn vẹn — và hàng ra có
         * `cabinet_id` mà không có `site_id`: không lọc được bằng site nào, và trang chi tiết
         * hiện một cái tủ không biết nằm ở đâu.
         *
         * Cái điều kiện ấy sinh ra để tránh báo oan khi người dùng KHÔNG chọn site. Nhưng
         * "không chọn site" chỉ vô hại khi cũng không có tủ; có tủ rồi thì nó là một câu hỏi
         * chưa trả lời, không phải một ô để trống.
         */
        errors.push(cabinetWithoutSiteMessage(cabinet.code));
      } else if (cabinet.siteId !== refs.siteId) {
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
