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
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { parsePageQuery } from '../../common/pagination';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthedRequest } from '../auth/types';
import { CatalogImportService } from './catalog-import.service';
import { CatalogService } from './catalog.service';
import { CATALOG_ENTITIES, type CatalogEntity } from './catalog.types';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Trần file danh mục: 4 sheet vài trăm dòng — 5MB đã là rộng rãi. */
const IMPORT_LIMIT = { fileSize: 5 * 1024 * 1024 };

class CatalogBodyDto {
  @IsOptional() @IsString() @Length(1, 40) code?: string;
  @IsOptional() @IsString() @Length(1, 160) name?: string;
  @IsOptional() @IsString() @Length(0, 400) address?: string;
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsString() @Length(0, 400) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) uHeight?: number;
  @IsOptional() @IsBoolean() hasPortMap?: boolean;
  @IsOptional() @IsString() @Length(0, 200) supplies?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 200) contact?: string;
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
@Controller('api/v1/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly imports: CatalogImportService,
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
    @Query() query: { page?: string; limit?: string; search?: string },
  ) {
    return this.catalog.list(params.entity, parsePageQuery(query), query.search);
  }

  @Roles('sa', 'admin', 'member')
  @Get(':entity/:id/history')
  history(@Param() params: EntityIdParamDto) {
    return this.catalog.history(params.entity, params.id);
  }

  @Roles('sa', 'admin')
  @Post(':entity')
  @Audited('catalog.created', 'catalog')
  create(
    @Param() params: EntityParamDto,
    @Body() body: CatalogBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.catalog.create(actor(req), params.entity, body);
  }

  @Roles('sa', 'admin')
  @Patch(':entity/:id')
  @Audited('catalog.updated', 'catalog')
  update(
    @Param() params: EntityIdParamDto,
    @Body() body: CatalogBodyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.catalog.update(actor(req), params.entity, params.id, body);
  }

  @Roles('sa', 'admin')
  @Patch(':entity/:id/active')
  @Audited('catalog.active.changed', 'catalog')
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
  @Audited('catalog.deleted', 'catalog')
  async remove(@Param() params: EntityIdParamDto, @Req() req: AuthedRequest) {
    await this.catalog.remove(actor(req), params.entity, params.id);
    return { status: 'deleted' };
  }

  /** Bảng đối chiếu — KHÔNG ghi gì (AC 2.1: chỉ khi xác nhận mới ghi). */
  @Roles('sa', 'admin')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: IMPORT_LIMIT }))
  preview(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.imports.preview(requireXlsx(file));
  }

  @Roles('sa', 'admin')
  @Post('import/commit')
  @Audited('catalog.imported', 'catalog')
  @UseInterceptors(FileInterceptor('file', { limits: IMPORT_LIMIT }))
  commit(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.imports.commit(actor(req), requireXlsx(file));
  }
}

function actor(req: AuthedRequest): string {
  return req.user!.email;
}

/**
 * Chỉ nhận .xlsx. Kiểm bằng MAGIC BYTE (`PK\x03\x04`) chứ không tin Content-Type client gửi,
 * cùng nguyên tắc với module files (NFR-9); đuôi file thêm một lớp vì zip nào cũng có magic đó.
 */
function requireXlsx(file: Express.Multer.File | undefined): Buffer {
  if (!file?.buffer?.length) {
    throw new BadRequestException({
      code: 'FILE_REQUIRED',
      message: 'Chưa chọn file. Hãy tải file mẫu, điền rồi tải lên.',
    });
  }
  const isZip =
    file.buffer.length > 4 &&
    file.buffer[0] === 0x50 &&
    file.buffer[1] === 0x4b &&
    file.buffer[2] === 0x03 &&
    file.buffer[3] === 0x04;
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8').toLowerCase();
  if (!isZip || !name.endsWith('.xlsx')) {
    throw new BadRequestException({
      code: 'UNSUPPORTED_FILE',
      message: 'Chỉ nhận file .xlsx. File .xls đời cũ hãy mở bằng Excel rồi "Lưu thành" .xlsx.',
    });
  }
  return file.buffer;
}

function sendXlsx(res: Response, buffer: Buffer, fileName: string): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buffer);
}
