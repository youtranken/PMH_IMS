import { Global, Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
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
 * thu hồi IP: làm ngược lại thì chính hàng rào `IP_HAS_LIVE_NAT` chặn lượt
 * thu hồi, và cả lượt thanh lý rollback.
 */

/** Một module đang giữ tài sản gắn với thiết bị. */
export interface DeviceReleaser {
  /**
   * Tên định danh, dùng cho lượt điểm danh lúc khởi động (`MUST_REGISTER`).
   *
   * Không lấy `constructor.name`: bản build production bị minify thì tên lớp đổi, và lượt
   * điểm danh sẽ đỏ vì một lý do chẳng liên quan gì tới hàng rào.
   */
  readonly name: string;

  /**
   * Những thứ máy này còn giữ, mô tả bằng tiếng Việt cho NGƯỜI ĐỌC — "IP 172.16.10.5",
   * "2 rule NAT", "1 ghế license Office 2021". Rỗng = không giữ gì.
   *
   * Đây là thứ hiện thẳng trong thông điệp chặn, nên đừng trả về id: người trực cần biết đi
   * gỡ CÁI GÌ, không cần biết uuid của nó.
   */
  holdingsOf(tx: Tx, deviceId: string): Promise<string[]>;

  /**
   * Trả lại mọi thứ máy này đang giữ, TRONG transaction của lượt thanh lý.
   *
   * "Trả lại" chứ không phải "xóa theo": thanh lý một MÁY không được kéo theo hồ sơ của thứ
   * khác. License bị GỠ KHỎI MÁY (ghế được trả về), còn hồ sơ phần mềm vẫn nguyên — công ty
   * vẫn sở hữu cái license đó và sẽ gán cho máy mới.
   */
  releaseWithin(tx: Tx, actor: string, deviceId: string): Promise<void>;
}

/**
 * Ai BẮT BUỘC phải có mặt trong sổ lúc api khởi động.
 *
 * ===== VÌ SAO CẦN DANH SÁCH NÀY =====
 *
 * Sổ này FAIL-OPEN theo bản chất: không ai đăng ký thì `holdings()` trả mảng rỗng, và
 * `setStatus` đọc mảng rỗng thành "máy không giữ gì" rồi thanh lý trong im lặng. Không có
 * request nào hỏng, không có test nào đỏ — chỉ có tài sản ở lại trên một cái máy đã ra khỏi
 * công ty.
 *
 * Mà việc đăng ký xảy ra trong `onModuleInit` của bốn lớp nằm ở ba module khác nhau: đổi thứ
 * tự `imports`, tách một module, đặt nhầm một `forwardRef` là đủ để một trong số đó ngừng
 * chạy. `OwnerAccessRegistry` điểm danh lúc boot vì đúng lớp lỗi này, và lý do ở đây giống
 * hệt.
 *
 * ===== VÌ SAO LÀ TÊN CHỨ KHÔNG PHẢI SỐ LƯỢNG =====
 *
 * `releasers.length >= 4` cũng xanh khi ai đó đăng ký nhầm hai lần một module và mất một
 * module khác. Điểm danh theo tên thì thông điệp lỗi nói thẳng ai vắng.
 */
const MUST_REGISTER = ['ipam', 'software', 'device-ports', 'isp-line'] as const;

@Injectable()
export class DeviceRetirementRegistry implements OnApplicationBootstrap {
  private readonly releasers: DeviceReleaser[] = [];

  /**
   * Chạy SAU khi mọi `onModuleInit` đã xong — lúc duy nhất biết được sổ đã đủ người hay chưa.
   * Ném thì Nest dừng khởi động, và đó là hành vi đúng: một api không lên là sự cố nhìn thấy
   * ngay, còn một api chạy mà thanh lý bỏ sót tài sản thì không ai thấy cho tới lúc kiểm kê.
   */
  onApplicationBootstrap(): void {
    const present = new Set(this.releasers.map((releaser) => releaser.name));
    const missing = MUST_REGISTER.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(
        `DeviceRetirementRegistry: thiếu người dọn cho ${missing.join(', ')}. ` +
          'Thiếu thì lượt thanh lý đọc "máy không giữ gì" và đi tiếp trong im lặng, để lại ' +
          'IP/luật NAT/ghế license/cổng đấu chéo/đường truyền treo trên một máy đã ra khỏi ' +
          'công ty. Kiểm `onModuleInit` của lớp tương ứng còn chạy không.',
      );
    }
  }

  register(releaser: DeviceReleaser): void {
    // Idempotent: `onModuleInit` có thể chạy lại trong test khi dựng nhiều lần TestingModule.
    if (this.releasers.includes(releaser)) return;
    this.releasers.push(releaser);
  }

  /**
   * Gộp mô tả từ mọi module. Rỗng = thanh lý được ngay.
   *
   * ===== VÌ SAO ĐỌC TRONG `tx`, KHÔNG PHẢI TRÊN POOL =====
   *
   * Đây là câu hỏi quyết định CHẶN hay CHO ĐI TIẾP, và nó phải nhìn cùng một thế giới với
   * lượt ghi ngay sau nó. Đọc trên pool là mở lại đúng khe hở mà `setStatus` vừa đóng bằng
   * `FOR UPDATE`: giữa lúc đọc "máy không giữ gì" và lúc lật `status` có một khoảng, và
   * người khác kịp gán một IP vào đó trong khoảng ấy.
   *
   * Tuần tự, KHÔNG `Promise.all`: cùng một transaction chạy nhiều câu song song trên một
   * connection là lỗi thời gian chạy của node-postgres — cùng lý do đã ghi ở
   * `releaseAllWithin`. Chỉ lượt đọc trên pool mới chạy song song được.
   */
  async holdingsWithin(tx: Tx, deviceId: string): Promise<string[]> {
    const out: string[] = [];
    for (const releaser of this.releasers) {
      out.push(...(await releaser.holdingsOf(tx, deviceId)));
    }
    return out;
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
