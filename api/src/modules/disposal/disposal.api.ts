import { Injectable } from '@nestjs/common';
import { DisposalService, type DisposalItem } from './disposal.service';

/**
 * AD-2: public api DUY NHẤT của module `disposal`.
 *
 * Chỉ có bảng điều khiển gọi, cho khối "vừa đưa vào kho". Nó gọi qua ĐÂY chứ không tự hỏi
 * `devices` + `software` + `service-accounts` rồi tự gộp: bản gộp thứ hai sẽ trôi khỏi bản
 * gốc đúng lúc có ai thêm loại thứ tư vào kho, và khi đó bảng điều khiển im lặng thiếu một
 * loại mà không test nào đỏ.
 *
 * Đổi lại, `dashboard` chỉ phụ thuộc một module thay vì ba.
 */
@Injectable()
export class DisposalApiService {
  constructor(private readonly disposal: DisposalService) {}

  /** Toàn bộ kho, mới bỏ nhất lên đầu. Cắt theo thời gian là việc của bên gọi. */
  list(): Promise<DisposalItem[]> {
    return this.disposal.list();
  }
}
