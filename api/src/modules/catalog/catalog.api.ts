import { BadRequestException, Injectable } from '@nestjs/common';
import { CatalogService, type CatalogLists } from './catalog.service';
import { CATALOG_REF_INACTIVE, inactiveRefMessage } from './catalog-refs';
export { CATALOG_REF_INACTIVE, inactiveRefMessage } from './catalog-refs';
import { normalizeKey } from '../../common/import-plan';
import type { CatalogSnapshot, IspProviderRecord } from './catalog.types';

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

/** Bộ tham chiếu danh mục của một hồ sơ — rỗng/`null` = không gắn. */
export interface CatalogRefs {
  siteId?: string | null;
  cabinetId?: string | null;
  deviceTypeId?: string | null;
  vendorId?: string | null;
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
  async validateRefs(refs: CatalogRefs): Promise<string[]> {
    return refErrors(await this.catalog.lists({ includeInactive: true }), refs);
  }

  /**
   * Cửa ghi dùng cái này, không dùng `validateRefs`: ngoài tham chiếu sai, nó còn từ chối lựa
   * chọn MỚI trỏ vào mục đã vô hiệu (Q-14).
   *
   * "Mới" = khác giá trị hồ sơ đang có (`current`; `null` khi tạo). Form gửi lại ĐỦ mọi ô kể
   * cả ô không đổi, nên chặn theo giá trị gửi lên sẽ khoá chết mọi hồ sơ cũ đang trỏ vào một
   * mục đã vô hiệu — sửa hotline thôi cũng bị từ chối. `current` là tham số bắt buộc để nơi gọi
   * phải nghĩ tới chuyện đó, không để mặc định âm thầm chọn hộ.
   *
   * Tham chiếu sai (`CATALOG_REF_INVALID`) báo trước; mục ngừng dùng là `CATALOG_REF_INACTIVE`.
   */
  async assertRefs(next: CatalogRefs, current: CatalogRefs | null): Promise<void> {
    const lists = await this.catalog.lists({ includeInactive: true });
    const errors = refErrors(lists, next);
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'CATALOG_REF_INVALID', message: errors.join(' ') });
    }
    const retired = inactiveRefErrors(lists, next, current);
    if (retired.length > 0) {
      throw new BadRequestException({ code: CATALOG_REF_INACTIVE, message: retired.join(' ') });
    }
  }

  /**
   * Vế "mục đã vô hiệu" của `assertRefs` cho đường HÀNG LOẠT (import Excel): đọc danh mục MỘT
   * lần rồi trả hàm kiểm từng dòng, trả câu lỗi thay vì ném.
   *
   * Import phải báo lỗi THEO DÒNG ở bước Đối chiếu: cả file là một transaction, ném lúc ghi thì
   * không ai biết dòng nào hỏng. Luật và câu chữ vẫn là MỘT bản với cửa HTTP (Q-14, AD-15).
   */
  async inactiveRefCheck(): Promise<(next: CatalogRefs, current: CatalogRefs | null) => string[]> {
    const lists = await this.catalog.lists({ includeInactive: true });
    return (next, current) => inactiveRefErrors(lists, next, current);
  }

  /**
   * Một nhà mạng theo id, KỂ CẢ mục đã ngừng dùng (`null` = không có). Đường truyền cần biết
   * `active` để chặn chọn MỚI một mục ngừng dùng mà vẫn cho sửa hồ sơ cũ đang trỏ vào nó.
   */
  async ispProvider(id: string): Promise<IspProviderRecord | null> {
    const lists = await this.catalog.lists({ includeInactive: true });
    return lists.ispProviders.find((provider) => provider.id === id) ?? null;
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

/**
 * Lựa chọn MỚI trỏ vào mục đã vô hiệu (Q-14). "Mới" = khác giá trị hồ sơ đang có (`current`;
 * `null` khi tạo) — xem `assertRefs` vì sao không chặn theo giá trị gửi lên.
 */
function inactiveRefErrors(
  lists: CatalogLists,
  next: CatalogRefs,
  current: CatalogRefs | null,
): string[] {
  const retired: string[] = [];
  const check = <T extends { id: string; active: boolean }>(
    key: keyof CatalogRefs,
    rows: readonly T[],
    kind: string,
    label: (row: T) => string,
  ) => {
    const chosen = next[key];
    if (!chosen || chosen === (current?.[key] ?? null)) return;
    const row = rows.find((item) => item.id === chosen);
    if (row && !row.active) retired.push(inactiveRefMessage(kind, label(row)));
  };
  check('deviceTypeId', lists.deviceTypes, 'Loại thiết bị', (row) => row.name);
  check('siteId', lists.sites, 'Site', (row) => row.code);
  check('cabinetId', lists.cabinets, 'Tủ mạng', (row) => row.code);
  check('vendorId', lists.vendors, 'Nhà cung cấp', (row) => row.name);
  return retired;
}

/** Tham chiếu sai của một bộ ref (rỗng = hợp lệ). Tách khỏi class để `assertRefs` dùng lại MỘT lượt đọc danh mục. */
function refErrors(lists: CatalogLists, refs: CatalogRefs): string[] {
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
