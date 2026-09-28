import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { sendXlsx } from '../../common/excel/xlsx-http';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import { isoDateInTz } from '../../common/today';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp } from '../auth/step-up.decorator';
import { DISPOSAL_SORT_KEYS, type DisposalQuery } from './disposal-query';
import { DisposalService } from './disposal.service';
import { DISPOSAL_KINDS, type DisposalItem, type DisposalKind } from './disposal.types';

interface RawQuery {
  kind?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
  limit?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Bộ lọc lạ (sửa tay trên URL) rơi về "không lọc" chứ không thành lỗi 400 cho một màn chỉ đọc. */
function filterOf(query: RawQuery): Omit<DisposalQuery, 'page' | 'limit'> {
  const sort = parseSortQuery(query, DISPOSAL_SORT_KEYS, { key: 'disposedAt', dir: 'desc' });
  return {
    kind: DISPOSAL_KINDS.includes(query.kind as DisposalKind)
      ? (query.kind as DisposalKind)
      : undefined,
    search: query.search?.trim() || undefined,
    from: query.from && ISO_DATE.test(query.from) ? query.from : undefined,
    to: query.to && ISO_DATE.test(query.to) ? query.to : undefined,
    sort: sort.key,
    dir: sort.dir,
  };
}

/* Nhãn tiếng Việt cho file — auditor cầm tờ giấy phải đọc cùng chữ với màn hình. */
const KIND_LABEL: Record<DisposalKind, string> = {
  device: 'Thiết bị',
  software: 'Phần mềm',
  service_account: 'Tài khoản dịch vụ',
  isp: 'Đường truyền',
};
const STATUS_LABEL: Record<string, string> = {
  retired: 'Đã thanh lý',
  terminated: 'Đã thanh lý',
  disabled: 'Đã vô hiệu hóa',
};

function byText(item: DisposalItem): string {
  if (item.auto) return 'Hệ thống (tự thanh lý khi quá hạn)';
  return item.disposedByName ?? item.disposedBy ?? '';
}

/**
 * Kho thanh lý — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Đọc thì mọi vai đã đăng nhập: "cái máy này đâu rồi" là câu ai trong team IT cũng hỏi, và
 * câu trả lời "đã thanh lý tháng trước" không phải bí mật gì. GHI thì không có — đưa vào kho
 * là việc của chính module chủ, dưới đúng cái tên mà module đó dùng (Thanh lý / Cắt / Vô hiệu
 * hóa). Màn này chỉ nhìn.
 */
@NoStepUp()
@Controller('api/v1/disposal')
export class DisposalController {
  constructor(
    private readonly disposal: DisposalService,
    private readonly excel: ExcelExportService,
  ) {}

  @Roles('sa', 'admin', 'member')
  @Get()
  list(@Query() query: RawQuery) {
    return this.disposal.inventory({ ...filterOf(query), ...parsePageQuery(query) });
  }

  /** FR-028: xuất đúng bộ lọc đang xem — biên bản "quý này đã bỏ những gì". */
  @Roles('sa', 'admin', 'member')
  @Audited('disposal.exported', 'disposal')
  @Get('export.xlsx')
  async export(@Query() query: RawQuery, @Res() res: Response) {
    const { items, timeZone } = await this.disposal.exportRows(filterOf(query));
    const buffer = await this.excel.build({
      sheetName: 'Kho thanh ly',
      columns: [
        { header: 'Loại', width: 18, value: (r) => KIND_LABEL[r.kind] },
        { header: 'Mã', width: 20, value: (r) => r.code },
        { header: 'Tên', width: 32, value: (r) => r.name },
        { header: 'Chi tiết', width: 20, value: (r) => r.detail ?? '' },
        { header: 'Trạng thái', width: 16, value: (r) => STATUS_LABEL[r.status] ?? r.status },
        {
          header: 'Ngày thanh lý',
          width: 14,
          value: (r) => (r.disposedAt ? isoDateInTz(timeZone, r.disposedAt) : ''),
        },
        { header: 'Người thanh lý', width: 28, value: byText },
        { header: 'Lý do', width: 40, value: (r) => r.reason ?? '' },
      ],
      rows: items,
    });
    sendXlsx(res, buffer, 'kho-thanh-ly.xlsx');
  }
}
