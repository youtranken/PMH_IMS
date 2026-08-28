import { Injectable } from '@nestjs/common';
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
   * Có tồn tại không — dùng khi module khác nhận `deviceId` từ người dùng và cần chặn
   * tham chiếu ma. Trả boolean thay vì ném để nơi gọi gom lỗi theo dòng khi import.
   */
  async exists(id: string): Promise<boolean> {
    try {
      await this.devices.findOne(id);
      return true;
    } catch {
      return false;
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
