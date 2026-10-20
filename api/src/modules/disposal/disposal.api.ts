import { Injectable } from '@nestjs/common';
import { DisposalService, type DisposalItem } from './disposal.service';

/**
 * AD-2: public api DUY NHẤT của module `disposal`.
 *
 * Chỉ có bảng điều khiển gọi, cho khối "vừa đưa vào kho". Nó gọi qua ĐÂY chứ không tự hỏi
 * `devices` + `software` + `service-accounts` rồi tự gộp: bản gộp thứ hai sẽ trôi khỏi bản
 * gốc đúng lúc có ai thêm một loại mới vào kho, và khi đó bảng điều khiển im lặng thiếu một
 * loại mà không test nào đỏ.
 *
 * Đổi lại, `dashboard` chỉ phụ thuộc một module thay vì ba.
 */
@Injectable()
export class DisposalApiService {
  constructor(private readonly disposal: DisposalService) {}

  /** Hồ sơ trong kho đổi từ `since` trở đi, có `disposedAt` thật (lịch sử). Cắt chính xác là việc của bên gọi. */
  changedSince(since: Date): Promise<DisposalItem[]> {
    return this.disposal.changedSince(since);
  }
}
