import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { dateTimeInTz } from '../../common/today';
import { Roles } from '../auth/roles.decorator';
import { SystemConfigService } from '../config-sys/system-config.service';
import { Audited } from './audited.decorator';
import { AuditQueryService, COUNT_CAP, type AuditRow } from './audit-query.service';
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

  /** `1` = chỉ sự kiện an ninh; tập mã do API giữ (`security-actions.ts`), web không gửi danh sách. */
  @IsOptional()
  @IsIn(['1'])
  security?: string;

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
  constructor(
    private readonly audit: AuditQueryService,
    private readonly excel: ExcelExportService,
    private readonly config: SystemConfigService,
  ) {}

  @Get()
  list(@Query() q: AuditQueryDto) {
    assertRange(q);
    return this.audit.listAudit({
      actor: q.actor,
      action: q.action,
      objectType: q.objectType,
      objectId: q.objectId,
      security: q.security === '1',
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

  /**
   * Nhật ký ra Excel THEO BỘ LỌC đang xem — kiểm toán viên xin "mọi lần xem két trong quý".
   * Trần `EXPORT_CAP` dòng (mới nhất trước): quá trần thì dòng cuối file nói rõ đã cắt, lọc hẹp
   * lại mà xuất tiếp. Bản thân việc xuất cũng vào nhật ký (FR-028).
   */
  @Audited('audit.exported', 'audit')
  @Get('export')
  async export(@Query() q: AuditQueryDto, @Res() res: Response) {
    assertRange(q);
    const result = await this.audit.listAudit({
      actor: q.actor,
      action: q.action,
      objectType: q.objectType,
      objectId: q.objectId,
      security: q.security === '1',
      from: q.from,
      to: q.to,
      page: 1,
      pageSize: EXPORT_CAP,
    });
    const tz = await this.config.getString('appTimezone');
    const rows: (AuditRow | { note: string })[] = [...result.items];
    if (result.total > result.items.length || result.totalCapped) {
      rows.push({
        note: `Đã cắt ở ${result.items.length} dòng mới nhất — lọc hẹp khoảng ngày rồi xuất tiếp.`,
      });
    }
    const buffer = await this.excel.build({
      sheetName: 'Nhat ky',
      columns: [
        {
          header: 'Thời điểm',
          width: 18,
          value: (r) => ('note' in r ? r.note : dateTimeInTz(new Date(r.createdAt), tz)),
        },
        { header: 'Người thao tác', width: 26, value: (r) => ('note' in r ? '' : (r.actorName ?? r.actor)) },
        { header: 'Email', width: 30, value: (r) => ('note' in r ? '' : r.actor) },
        { header: 'Hành động (mã)', width: 30, value: (r) => ('note' in r ? '' : r.action) },
        { header: 'Loại đối tượng', width: 16, value: (r) => ('note' in r ? '' : (r.objectType ?? '')) },
        {
          header: 'Đối tượng',
          width: 32,
          value: (r) => ('note' in r ? '' : (r.objectLabel ?? r.objectId ?? '')),
        },
        { header: 'Mã đối tượng', width: 38, value: (r) => ('note' in r ? '' : (r.objectId ?? '')) },
        { header: 'IP', width: 16, value: (r) => ('note' in r ? '' : (r.ip ?? '')) },
        {
          header: 'Chi tiết',
          width: 60,
          value: (r) => ('note' in r || r.detail == null ? '' : JSON.stringify(r.detail)),
        },
      ],
      rows,
    });
    sendXlsx(res, buffer, 'nhat-ky.xlsx');
  }
}

/** Trần một file xuất nhật ký — đủ cho một quý của đội IT nhỏ, không kéo sập API. */
const EXPORT_CAP = 5000;

function assertRange(q: AuditQueryDto): void {
  if (q.from) assertValidDate(q.from);
  if (q.to) assertValidDate(q.to);
  if (q.from && q.to && q.to < q.from) {
    throw new BadRequestException('to phải ≥ from');
  }
}
