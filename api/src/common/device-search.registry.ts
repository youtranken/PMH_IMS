import { Global, Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';

/**
 * Sổ đăng ký "từ khoá này chỉ tới thiết bị nào" cho ô tìm ở danh sách thiết bị.
 *
 * Câu hỏi hằng ngày "10.77.1.50 là máy nào?" có câu trả lời nằm ở bảng `ip_address` của
 * `ipam`, không ở bảng `device`. `devices` không gọi thẳng `ipam.api` được: `ipam` đã import
 * `devices.api` (nó cần tra thiết bị), chiều ngược lại là vòng phụ thuộc mà
 * `dependency-cruiser` chặn (`no-circular`). Nên đảo chiều như `DeviceRetirementRegistry`:
 * `ipam` tự ghi vào sổ lúc khởi động, `devices` chỉ đọc sổ.
 */
export interface DeviceSearchContributor {
  /** Tên cho lượt điểm danh lúc khởi động — không dùng `constructor.name` (bị minify). */
  readonly name: string;

  /**
   * Id thiết bị khớp với từ khoá theo dữ liệu của module này. Từ khoá không thuộc loại module
   * hiểu (ví dụ không phải dạng IP) thì trả mảng rỗng, KHÔNG ném.
   */
  deviceIdsMatching(term: string): Promise<string[]>;
}

/**
 * Thiếu `ipam` thì tìm theo IP im lặng ra 0 dòng và màn hình khẳng định "không có thiết bị
 * nào khớp" — một câu sai. Điểm danh lúc khởi động để lỗi nối dây lộ ra ngay.
 */
const MUST_REGISTER = ['ipam'] as const;

@Injectable()
export class DeviceSearchRegistry implements OnApplicationBootstrap {
  private readonly contributors: DeviceSearchContributor[] = [];

  onApplicationBootstrap(): void {
    const present = new Set(this.contributors.map((c) => c.name));
    const missing = MUST_REGISTER.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(
        `DeviceSearchRegistry: thiếu ${missing.join(', ')}. Thiếu thì ô tìm thiết bị theo IP ` +
          'luôn ra 0 dòng mà không báo lỗi. Kiểm `onModuleInit` của lớp tương ứng.',
      );
    }
  }

  register(contributor: DeviceSearchContributor): void {
    if (this.contributors.includes(contributor)) return;
    this.contributors.push(contributor);
  }

  /** Hợp các id từ mọi module. Rỗng = không module nào nhận ra từ khoá. */
  async deviceIdsMatching(term: string): Promise<string[]> {
    const out = new Set<string>();
    for (const contributor of this.contributors) {
      for (const id of await contributor.deviceIdsMatching(term)) out.add(id);
    }
    return [...out];
  }
}

@Global()
@Module({ providers: [DeviceSearchRegistry], exports: [DeviceSearchRegistry] })
export class DeviceSearchModule {}
