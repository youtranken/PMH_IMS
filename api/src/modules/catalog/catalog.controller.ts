import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  isUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { parsePageQuery } from '../../common/pagination';
import { parseSortQuery } from '../../common/sorting';
import {
  requireXlsx,
  sendXlsx,
  XLSX_UPLOAD_LIMIT,
} from '../../common/excel/xlsx-http';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { CatalogImportService } from './catalog-import.service';
import { CATALOG_EXPORT_NAME, catalogExportColumns } from './catalog-export';
import { CATALOG_SORT_DEFAULT, CATALOG_SORT_KEYS, CatalogService } from './catalog.service';
import { CATALOG_ENTITIES, type CatalogEntity } from './catalog.types';
import { NoStepUp } from '../auth/step-up.decorator';

class CatalogBodyDto {
  @IsOptional() @IsString() @Length(1, 40) code?: string;
  @IsOptional() @IsString() @Length(1, 160) name?: string;
  @IsOptional() @IsString() @Length(0, 400) address?: string;
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsString() @Length(0, 400) description?: string;
  @IsOptional() @Min(1) @Max(60) @IsInt() uHeight?: number;
  @IsOptional() @IsBoolean() hasPortMap?: boolean;
  @IsOptional() @IsBoolean() isRouter?: boolean;
  @IsOptional() @IsString() @Length(0, 200) supplies?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 200) contact?: string;

  // Ba danh mục của 0028. Một DTO chung cho mọi loại, đúng nếp sẵn có: `toRow` phía service
  // mới là chỗ quyết định loại nào nhận trường nào — DTO chỉ chặn rác và giới hạn độ dài.
  @IsOptional() @IsString() @Length(0, 40) hotline?: string;

  @IsOptional()
  @IsIn(['tcp', 'udp', 'both'], { message: 'Giao thức phải là TCP, UDP hoặc cả hai.' })
  protocol?: string;

  @IsOptional() @Min(1) @Max(65535) @IsInt() portFrom?: number;
  @IsOptional() @Min(1) @Max(65535) @IsInt() portTo?: number;
}

class ActiveDto {
  @IsBoolean() active!: boolean;
}

class EntityParamDto {
  @IsIn([...CATALOG_ENTITIES], {
    message: 'Loại danh mục không hợp lệ.',
  })
  entity!: CatalogEntity;
}

/**
 * Route có `:entity/:id` PHẢI khai cả hai tham số trong cùng một DTO.
 * `ValidationPipe` bật `forbidNonWhitelisted`, nên nhận `@Param()` bằng DTO chỉ có `entity`
 * thì `id` thành "property should not exist" → 400 cho mọi thao tác sửa/vô hiệu/xóa.
 * (Đúng cái bẫy đã dính ở story 1.4 với body; E2E story 2.1 bắt lại lần nữa ở param.)
 */
class EntityIdParamDto extends EntityParamDto {
  @IsUUID(undefined, { message: 'Mã mục danh mục không hợp lệ.' })
  id!: string;
}

/**
 * Danh mục dùng chung (story 2.1, FR-004).
 *
 * Quyền: ai đăng nhập cũng ĐỌC được (form thiết bị của Member cần đổ ô chọn),
 * chỉ Admin/SA được SỬA — AC "Member chỉ xem, không sửa danh mục".
 * Mỗi route khai @Roles tường minh vì RolesGuard mặc định ĐÓNG (AD-9).
 */
/*
 * Ghi chú tên hành động: service ghi tên CỤ THỂ theo loại mục
 * (`catalog.site.created`, `catalog.cabinet.updated`…) vì `:entity` chỉ biết lúc chạy;
 * tên khai ở `@Audited` là tên HỌ, dùng để đọc controller biết route này có audit (AD-9).
 */
@NoStepUp()
@Controller('api/v1/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly imports: CatalogImportService,
    private readonly excel: ExcelExportService,
  ) {}

  /** Bốn danh sách gọn để đổ ô chọn — dùng ở form thiết bị, không phân trang. */
  @Roles('sa', 'admin', 'member')
  @Get()
  lists(@Query('includeInactive') includeInactive?: string) {
    return this.catalog.lists({ includeInactive: includeInactive === 'true' });
  }

  @Roles('sa', 'admin', 'member')
  @Get('template')
  async template(@Res() res: Response) {
    const buffer = await this.imports.buildTemplate();
    sendXlsx(res, buffer, 'mau-danh-muc.xlsx');
  }

  @Roles('sa', 'admin', 'member')
  @Get(':entity')
  list(
    @Param() params: EntityParamDto,
    @Query()
    query: {
      page?: string;
      limit?: string;
      search?: string;
      sort?: string;
      dir?: string;
      active?: string;
      siteId?: string;
    },
  ) {
    const sort = parseSortQuery(
      query,
      CATALOG_SORT_KEYS[params.entity],
      CATALOG_SORT_DEFAULT[params.entity],
    );
    // `siteId` sai dạng mà đi thẳng vào WHERE là lỗi ép kiểu 22P02 của Postgres → 500 trắng.
    if (query.siteId && !isUUID(query.siteId)) {
      throw new BadRequestException({ code: 'BAD_SITE_ID', message: 'Mã site không hợp lệ.' });
    }
    return this.catalog.list(params.entity, parsePageQuery(query), query.search, sort, {
      active: query.active === 'true' ? true : query.active === 'false' ? false : undefined,
      siteId: params.entity === 'cabinet' ? query.siteId || undefined : undefined,
    });
  }

  /**
   * Danh mục đang xem ra Excel — theo đúng tab, ô tìm, bộ lọc và thứ tự sắp của màn (tờ in dán
   * phòng máy: nhà cung cấp + điện thoại, hotline nhà mạng). Ai đọc được danh mục thì xuất được;
   * vẫn ghi nhật ký như mọi đường xuất (FR-028).
   */
  @Roles('sa', 'admin', 'member')
  @Audited('catalog.exported', 'catalog')
  @Get(':entity/export')
  async export(
    @Param() params: EntityParamDto,
    @Query()
    query: { search?: string; sort?: string; dir?: string; active?: string; siteId?: string },
    @Res() res: Response,
  ) {
    if (query.siteId && !isUUID(query.siteId)) {
      throw new BadRequestException({ code: 'BAD_SITE_ID', message: 'Mã site không hợp lệ.' });
    }
    const sort = parseSortQuery(
      query,
      CATALOG_SORT_KEYS[params.entity],
      CATALOG_SORT_DEFAULT[params.entity],
    );
    const page = await this.catalog.list(params.entity, { page: 1, limit: EXPORT_LIMIT }, query.search, sort, {
      active: query.active === 'true' ? true : query.active === 'false' ? false : undefined,
      siteId: params.entity === 'cabinet' ? query.siteId || undefined : undefined,
    });
    const buffer = await this.excel.build({
      sheetName: CATALOG_EXPORT_NAME[params.entity],
      columns: catalogExportColumns(params.entity),
      rows: page.items as never[],
    });
    sendXlsx(res, buffer, `danh-muc-${CATALOG_EXPORT_NAME[params.entity]}.xlsx`);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':entity/:id/history')
  history(@Param() params: EntityIdParamDto) {
    return this.catalog.history(params.entity, params.id);
  }

  // Q-12: member được tạo và sửa; vô hiệu hoá, xoá, nhập Excel vẫn chỉ SA/Admin.
  @Roles('sa', 'admin', 'member')
  @Post(':entity')
  @Audited('catalog.created', 'catalog', { writtenByService: true })
  create(
    @Param() params: EntityParamDto,
    @Body() body: CatalogBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.catalog.create(actor(req), params.entity, body);
  }

  // Q-12: member được tạo và sửa; vô hiệu hoá, xoá, nhập Excel vẫn chỉ SA/Admin.
  @Roles('sa', 'admin', 'member')
  @Patch(':entity/:id')
  @Audited('catalog.updated', 'catalog', { writtenByService: true })
  update(
    @Param() params: EntityIdParamDto,
    @Body() body: CatalogBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.catalog.update(actor(req), params.entity, params.id, body);
  }

  @Roles('sa', 'admin')
  @Patch(':entity/:id/active')
  @Audited('catalog.active.changed', 'catalog', { writtenByService: true })
  async setActive(
    @Param() params: EntityIdParamDto,
    @Body() body: ActiveDto,
    @Req() req: AuthedRequest,
  ) {
    await this.catalog.setActive(actor(req), params.entity, params.id, body.active);
    return { active: body.active };
  }

  @Roles('sa', 'admin')
  @Delete(':entity/:id')
  @Audited('catalog.deleted', 'catalog', { writtenByService: true })
  async remove(@Param() params: EntityIdParamDto, @Req() req: AuthedRequest) {
    await this.catalog.remove(actor(req), params.entity, params.id);
    return { status: 'deleted' };
  }

  /** Bảng đối chiếu — KHÔNG ghi gì (AC 2.1: chỉ khi xác nhận mới ghi). */
  @Roles('sa', 'admin')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  preview(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.imports.preview(requireXlsx(file));
  }

  @Roles('sa', 'admin')
  @Post('import/commit')
  @Audited('catalog.imported', 'catalog', { writtenByService: true })
  @UseInterceptors(FileInterceptor('file', { limits: XLSX_UPLOAD_LIMIT }))
  commit(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.imports.commit(actor(req), requireXlsx(file));
  }
}

/** Trần một file xuất danh mục — danh mục là bảng tra cứu vài trăm dòng là cùng. */
const EXPORT_LIMIT = 5000;

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

