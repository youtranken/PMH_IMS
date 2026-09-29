import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { DashboardService } from './dashboard.service';
import { NoStepUp } from '../auth/step-up.decorator';

/**
 * Bảng điều khiển (FR-025).
 *
 * MỘT lần gọi trả về cả trang. Mỗi khối một request thì trang nhấp nháy sáu nhịp và sếp nhìn
 * thấy nó dựng dần — trong khi cả mục tiêu của story là "ba phút, liếc một cái là nắm". Thêm
 * khối mới thì thêm vào cùng payload này, đừng mở endpoint thứ hai.
 *
 * Nội dung TỰ RÚT GỌN theo vai ở tầng service, không phải bằng cách web ẩn khối đi: ẩn ở web
 * thì dữ liệu vẫn đi qua dây, và Member mở tab mạng ra là đọc được nhật ký break-glass toàn
 * công ty.
 */
@NoStepUp()
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  build(@Req() req: AuthedRequest) {
    const user = req.user!;
    return this.dashboard.build({ email: user.email, role: user.role });
  }
}
