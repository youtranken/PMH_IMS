import { BadRequestException, Injectable } from '@nestjs/common';
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
   * "Thiết bị này còn nhận thêm được không?" — cửa DUY NHẤT cho module khác hỏi trước khi ghi
   * bất cứ thứ gì trỏ tới một `deviceId` người dùng chọn.
   *
   * ===== VÌ SAO THAY `exists()` =====
   *
   * Bản cũ chỉ trả lời "có hàng này trong bảng không". Rà soát 07/09 đếm được TÁM điểm ghi hở
   * vì đúng lý do đó: module khác muốn hỏi "máy này còn dùng được không" thì không có cửa nào,
   * mà AD-2 cấm chúng tự query bảng `device`. Nên cả bốn nơi đều hỏi câu duy nhất hỏi được rồi
   * đi tiếp — và máy đã thanh lý, đã ký biên bản, đã ra khỏi công ty vẫn nhận được license,
   * vẫn được cấp IP, vẫn dựng được rule NAT trỏ vào nó. Hàng rào không thiếu vì ai đó lười;
   * nó thiếu vì cái api không cho hỏi.
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
    let device: DeviceListItem;
    try {
      device = await this.devices.findOne(id);
    } catch {
      throw new BadRequestException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Thiết bị được chọn không tồn tại.',
      });
    }
    if (device.status === 'retired') {
      throw new BadRequestException({
        code: 'DEVICE_RETIRED',
        message: `Thiết bị ${device.code} đã thanh lý nên không nhận thêm được nữa. Chọn thiết bị khác, hoặc mở lại hồ sơ trong Kho thanh lý nếu thanh lý nhầm.`,
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
    const page = await this.devices.list({ page: 1, limit: 500 }, { status: 'retired' });
    return page.items;
  }

  /** Gợi ý cho ô chọn thiết bị ở màn khác (port map, IP, secret). */
  async search(term: string, limit = 20): Promise<DeviceListItem[]> {
    const page = await this.devices.list({ page: 1, limit }, { search: term });
    return page.items;
  }
}
