import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { DisposalService } from './disposal.service';

/**
 * Kho thanh lý (28/08/2026) — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Đọc thì mọi vai đã đăng nhập: "cái máy này đâu rồi" là câu ai trong team IT cũng hỏi, và
 * câu trả lời "đã thanh lý tháng trước" không phải bí mật gì. GHI thì không có — đưa vào kho
 * là việc của chính module chủ, dưới đúng cái tên mà module đó dùng (Thanh lý / Cắt / Vô hiệu
 * hóa). Màn này chỉ nhìn.
 */
@Controller('api/v1/disposal')
export class DisposalController {
  constructor(private readonly disposal: DisposalService) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list() {
    return this.disposal.list();
  }
}
