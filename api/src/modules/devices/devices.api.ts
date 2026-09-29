import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { StatusEvent } from '../../common/history';
import type { Page } from '../../common/pagination';
import type { Tx } from '../../common/tx';
import { DevicesService } from './devices.service';
import type { DeviceListItem } from './devices.types';

/**
 * AD-2: public api DUY NHẤT của module `devices`.
 *
 * Epic sau dùng: ipam gắn IP vào thiết bị (5.1), vault gắn secret vào thiết bị (4.1),
 * software gán license theo seat (3.2), phiếu sự cố trỏ tới thiết bị (9.1).
 * Các module đó KHÔNG được import `devices.service`/`devices.schema` hay query bảng `device`.
 */
@Injectable()
export class DevicesApiService {
  constructor(private readonly devices: DevicesService) {}

  /** Hồ sơ đầy đủ kèm tên danh mục đã tra sẵn. Ném NotFound nếu không có. */
  getById(id: string): Promise<DeviceListItem> {
    return this.devices.findOne(id);
  }

  /**
   * Tra NHIỀU thiết bị trong MỘT lượt. **Đây là cửa cho mọi đường DANH SÁCH.**
   *
   * `getById` KHÔNG rẻ: nó tốn 8 truy vấn (một câu đọc hàng `device`, rồi `catalog.lists()`
   * bắn 7 câu không cache). Gọi nó trong vòng lặp là nhân 8 với số dòng — một dải /24 gán đầy
   * từng tốn ~2000 câu cho một lần mở màn.
   *
   * Id không tồn tại thì VẮNG MẶT trong map chứ không ném: nơi gọi tự quyết hiện gì cho hàng
   * dữ liệu hỏng ("(thiết bị không còn)"), và một hàng hỏng không được làm sập cả bảng.
   */
  getByIds(ids: string[]): Promise<Map<string, DeviceListItem>> {
    return this.devices.findByIds(ids);
  }

  /**
   * "Thiết bị này còn nhận thêm được không?" — cửa DUY NHẤT cho module khác hỏi trước khi ghi
   * bất cứ thứ gì trỏ tới một `deviceId` người dùng chọn.
   *
   * ===== VÌ SAO THAY `exists()` =====
   *
   * `exists()` chỉ trả lời "có hàng này trong bảng không". Module khác muốn hỏi "máy này còn
   * dùng được không" thì cần một cửa, vì AD-2 cấm chúng tự query bảng `device`. Không có cửa
   * này thì mọi nơi chỉ hỏi được câu `exists()` rồi đi tiếp — và máy đã thanh lý, đã ký biên
   * bản, đã ra khỏi công ty vẫn nhận được license, vẫn được cấp IP, vẫn dựng được rule NAT
   * trỏ vào nó. Hàng rào thiếu không vì ai đó lười; nó thiếu khi cái api không cho hỏi.
   *
   * Nên hàm này NÉM thay vì trả boolean, và ném hai lỗi KHÁC NHAU: "không tồn tại" và "đã
   * thanh lý" là hai chuyện khác nhau với người đang đứng trước màn hình — gộp làm một thì họ
   * đi tìm một thiết bị vốn đang nằm rành rành trong Kho thanh lý.
   *
   * `broken` (hỏng, chờ sửa) VẪN qua: máy đó còn trong công ty, còn giữ license và IP của nó.
   * Chỉ `retired` mới là "đã ra khỏi sổ". Chặn rộng hơn thì cả phòng IT hết cấp được IP cho
   * máy đang sửa — một hàng rào chặn việc hợp lệ là hàng rào sẽ bị tìm cách lách.
   */
  async assertUsable(id: string): Promise<void> {
    await this.guarded(() => this.devices.assertUsable(id));
  }

  /**
   * Bản dùng cho ĐƯỜNG GHI: hỏi câu y hệt, nhưng GIỮ KHOÁ trên hàng thiết bị tới hết
   * transaction của người gọi.
   *
   * Mọi module ghi thứ gì đó trỏ tới một `deviceId` phải gọi bản NÀY, bên trong `tx` của
   * chính lượt ghi — bản không khoá ở trên chỉ còn dành cho đường đọc. Xem
   * `DevicesService.assertUsableWithin` để biết khoảng hở mà nó đóng, và vì sao `FOR SHARE`
   * chứ không phải `FOR UPDATE`.
   */
  async assertUsableWithin(tx: Tx, id: string): Promise<void> {
    await this.guarded(() => this.devices.assertUsableWithin(tx, id));
  }

  /** Phần dịch lỗi dùng chung cho hai cửa trên — một bản chữ, một cách cư xử. */
  private async guarded(run: () => Promise<void>): Promise<void> {
    try {
      /*
       * Uỷ quyền cho `DevicesService`: câu "còn nhận thêm được không" và câu chữ của lỗi chỉ
       * được có MỘT bản (AD-15). Đặt nó ở đây thì ba đường ghi nội bộ của chính module
       * `devices` không với tới được.
       */
      await run();
    } catch (error) {
      /*
       * CHỈ nuốt đúng lỗi "không tìm thấy". `catch` trần ở đây biến một sự cố DB thành câu
       * "Thiết bị được chọn không tồn tại" — người dùng đi tìm một thiết bị đang nằm rành
       * rành trong kho, còn nguyên nhân thật thì mất luôn. Cùng lớp lỗi với `catch` trần ở
       * `AuditWriterService`.
       */
      if (!(error instanceof NotFoundException)) throw error;
      throw new BadRequestException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Thiết bị được chọn không tồn tại.',
      });
    }
  }

  /**
   * Thiết bị ĐÃ THANH LÝ — màn Kho thanh lý gom qua đây.
   *
   * Module `disposal` chỉ là một MÀN TỔNG: nó không giữ bảng nào, không đặt ra trạng thái
   * mới. Mỗi module vẫn là chủ của vòng đời hồ sơ mình (AD-3), và "đã ngừng dùng" ở đây gọi
   * đúng cái tên mà module đó vốn dùng — thiết bị là `retired`.
   */
  async listRetired(): Promise<DeviceListItem[]> {
    return (await this.retiredPage()).items;
  }

  /** Như `listRetired`, kèm `total` thật để kho biết mình có bị cắt ở trần 500 dòng không. */
  retiredPage(): Promise<Page<DeviceListItem>> {
    return this.devices.list({ page: 1, limit: 500 }, { status: 'retired' });
  }

  /** Ai thanh lý, khi nào — kho thanh lý hỏi theo mẻ id (đọc `device_history`). */
  retirementEvents(ids: string[]): Promise<Map<string, StatusEvent>> {
    return this.devices.statusEvents(ids, 'retired');
  }

  /** Gợi ý cho ô chọn thiết bị ở màn khác (port map, IP, secret). */
  async search(term: string, limit = 20): Promise<DeviceListItem[]> {
    const page = await this.devices.list({ page: 1, limit }, { search: term });
    return page.items;
  }
}
