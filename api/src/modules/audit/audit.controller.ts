import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { AuditQueryService, COUNT_CAP } from './audit-query.service';
import { NoStepUp } from '../auth/step-up.decorator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ngày lịch THẬT (regex chỉ chặn định dạng) — mẫu reports.controller. */
function assertValidDate(s: string): void {
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new BadRequestException(`Ngày không hợp lệ: ${s}`);
  }
}

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  objectType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  objectId?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'from phải dạng YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'to phải dạng YYYY-MM-DD' })
  to?: string;

  /*
   * Trần = `COUNT_CAP`: câu đếm không bao giờ báo quá ngần ấy dòng, nên với `pageSize` nhỏ
   * nhất (1) cũng không có trang hợp lệ nào vượt nó. Không trần thì `?page=1e15` bắt
   * Postgres đi `OFFSET` qua toàn bộ một bảng chỉ-thêm giữ vĩnh viễn.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COUNT_CAP)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

/** Viewer audit log (6.2, FR-43) — SA + Admin (delegation 10.1). Chỉ đọc (AD-10). */
/*
 * Tiền tố `api/v1` là BẮT BUỘC: nginx chỉ chuyển tiếp `/api/`, `= /api` và `= /health` sang
 * backend; mọi đường khác rơi vào `location /` tức SPA fallback. Bản trước khai
 * `@Controller('admin/audit')` — controller DUY NHẤT trong 17 cái thiếu tiền tố — nên endpoint
 * này không tiếp cận được từ trình duyệt, trả về HTML của SPA chứ không phải dữ liệu.
 * Cộng với lỗi `u.sub` ở audit-query.service.ts, màn Nhật ký hỏng ở hai tầng cùng lúc.
 * Không gì phát hiện được vì màn web còn `planned: true` và endpoint có 0 test (F-QA-01).
 */
@NoStepUp()
@Controller('api/v1/admin/audit')
@Roles('sa', 'admin')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  list(@Query() q: AuditQueryDto) {
    if (q.from) assertValidDate(q.from);
    if (q.to) assertValidDate(q.to);
    if (q.from && q.to && q.to < q.from) {
      throw new BadRequestException('to phải ≥ from');
    }
    return this.audit.listAudit({
      actor: q.actor,
      action: q.action,
      objectType: q.objectType,
      objectId: q.objectId,
      from: q.from,
      to: q.to,
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  @Get('actions')
  actions() {
    return this.audit.distinctActions();
  }
}
