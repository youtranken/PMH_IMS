import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx } from './tx';

/**
 * Sổ đăng ký "máy này còn đang giữ gì" — hỏi trước khi thanh lý, và dọn nếu người dùng chọn.
 *
 * ===== BÀI TOÁN =====
 *
 * Thanh lý một máy hôm nay chỉ lật một chữ trong cột `status`. Máy đã ra khỏi công ty, đã ký
 * biên bản, nhưng IP của nó vẫn `assigned` và vẫn trỏ về chính nó, rule NAT vào IP đó vẫn
 * sống, ghế license vẫn bị chiếm. Hậu quả nặng nhất không nằm ở IPAM mà ở chỗ khác: thanh lý
 * 10 máy cũ thì máy mới đầu tiên đã báo hết seat và BẮT người trực khai một lý do vượt seat
 * **sai sự thật pháp lý** với nhà cung cấp.
 *
 * ===== VÌ SAO PHẢI LÀ SỔ ĐĂNG KÝ =====
 *
 * Cách hiển nhiên là `devices` gọi thẳng `ipam.api` và `software.api`. Không được: `ipam` và
 * `software` đã import `devices.api` rồi (chúng cần tra thiết bị), nên chiều ngược lại tạo
 * VÒNG phụ thuộc và `dependency-cruiser` chặn bằng `no-circular` — chặn đúng.
 *
 * Nên đảo chiều: `devices` ĐỌC sổ, các module giữ tài sản GHI vào sổ lúc khởi động. `devices`
 * chỉ biết "có ai đó đang giữ thứ gì của máy này không", không biết ai giữ và giữ cái gì.
 * Đây là khuôn đã dùng ba lần — `DevicePanelRegistry`, `ExpirySourceRegistry`,
 * `OwnerAccessRegistry` — và cũng vì đúng lý do đó.
 *
 * ===== THỨ TỰ DỌN LÀ MỘT PHẦN CỦA HỢP ĐỒNG =====
 *
 * `releaseWithin` chạy TRONG transaction của lượt thanh lý, nên hoặc máy được thanh lý và mọi
 * thứ nó giữ được trả lại, hoặc không có gì xảy ra. Không có trạng thái nửa vời kiểu "IP đã
 * thu hồi nhưng máy vẫn đang dùng".
 *
 * Mỗi module tự lo thứ tự BÊN TRONG phần của mình. Ví dụ `ipam` phải gỡ rule NAT TRƯỚC rồi mới
 * thu hồi IP: làm ngược lại thì chính hàng rào `IP_HAS_LIVE_NAT` (rà soát 07/09 #6) chặn lượt
 * thu hồi, và cả lượt thanh lý rollback.
 */

/** Một module đang giữ tài sản gắn với thiết bị. */
export interface DeviceReleaser {
  /**
   * Những thứ máy này còn giữ, mô tả bằng tiếng Việt cho NGƯỜI ĐỌC — "IP 172.16.10.5",
   * "2 rule NAT", "1 ghế license Office 2021". Rỗng = không giữ gì.
   *
   * Đây là thứ hiện thẳng trong thông điệp chặn, nên đừng trả về id: người trực cần biết đi
   * gỡ CÁI GÌ, không cần biết uuid của nó.
   */
  holdingsOf(deviceId: string): Promise<string[]>;

  /**
   * Trả lại mọi thứ máy này đang giữ, TRONG transaction của lượt thanh lý.
   *
   * "Trả lại" chứ không phải "xóa theo": thanh lý một MÁY không được kéo theo hồ sơ của thứ
   * khác. License bị GỠ KHỎI MÁY (ghế được trả về), còn hồ sơ phần mềm vẫn nguyên — công ty
   * vẫn sở hữu cái license đó và sẽ gán cho máy mới.
   */
  releaseWithin(tx: Tx, actor: string, deviceId: string): Promise<void>;
}

@Injectable()
export class DeviceRetirementRegistry {
  private readonly releasers: DeviceReleaser[] = [];

  register(releaser: DeviceReleaser): void {
    // Idempotent: `onModuleInit` có thể chạy lại trong test khi dựng nhiều lần TestingModule.
    if (this.releasers.includes(releaser)) return;
    this.releasers.push(releaser);
  }

  /** Gộp mô tả từ mọi module. Rỗng = thanh lý được ngay. */
  async holdings(deviceId: string): Promise<string[]> {
    const lists = await Promise.all(this.releasers.map((r) => r.holdingsOf(deviceId)));
    return lists.flat();
  }

  /**
   * Dọn tuần tự, KHÔNG song song.
   *
   * Cùng một transaction chạy nhiều câu lệnh song song trên một connection là lỗi thời gian
   * chạy của node-postgres, và kể cả nếu chạy được thì thứ tự giữa các module vẫn phải xác
   * định để lỗi (nếu có) luôn tái hiện được y hệt.
   */
  async releaseAllWithin(tx: Tx, actor: string, deviceId: string): Promise<void> {
    for (const releaser of this.releasers) {
      await releaser.releaseWithin(tx, actor, deviceId);
    }
  }
}

@Global()
@Module({ providers: [DeviceRetirementRegistry], exports: [DeviceRetirementRegistry] })
export class DeviceRetirementModule {}
