import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { NoSecretText } from '../../common/no-secret-text';
import { OptionalUuidListQuery, splitUuidList } from '../../common/query-uuid';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DiagramReviewService } from './diagram-review.service';
import { DIAGRAM_NODE_TYPES, type DiagramNodeType } from './diagram.schema';
import { DEVICE_INFO_MAX_IDS, DiagramsService } from './diagrams.service';

/** Trần thô của DTO; trần thật (`diagram.xml_max_kb`, `diagram.svg_max_kb`) do cổng kiểm áp. */
const RAW_MAX_BYTES = 6 * 1024 * 1024;

class IdParamDto {
  @IsUUID(undefined, { message: 'Mã bản vẽ không hợp lệ.' })
  id!: string;
}

class VersionParamDto extends IdParamDto {
  @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' })
  versionId!: string;
}

class CreateNodeDto {
  @IsString() @Length(1, 120, { message: 'Tên bản vẽ từ 1 đến 120 ký tự.' }) name!: string;
  @IsIn(DIAGRAM_NODE_TYPES, { message: 'Loại nút không hợp lệ.' }) nodeType!: DiagramNodeType;
  @IsOptional() @IsUUID(undefined, { message: 'Bản vẽ cha không hợp lệ.' }) parentId?: string;
  @IsOptional() @IsUUID(undefined, { message: 'Site không hợp lệ.' }) siteId?: string;
  @IsOptional() @IsUUID(undefined, { message: 'Tủ mạng không hợp lệ.' }) cabinetId?: string;
  @IsOptional() @IsEmail({}, { message: 'Người phụ trách không hợp lệ.' }) ownerEmail?: string;
}

/** `null` ở parentId = đưa lên gốc cây; ở site/tủ/người phụ trách = bỏ gắn. */
class UpdateNodeDto {
  @IsOptional() @IsString() @Length(1, 120, { message: 'Tên bản vẽ từ 1 đến 120 ký tự.' }) name?: string;
  @IsOptional() @IsIn(DIAGRAM_NODE_TYPES, { message: 'Loại nút không hợp lệ.' }) nodeType?: DiagramNodeType;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsUUID(undefined, { message: 'Bản vẽ cha không hợp lệ.' }) parentId?: string | null;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsUUID(undefined, { message: 'Site không hợp lệ.' }) siteId?: string | null;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsUUID(undefined, { message: 'Tủ mạng không hợp lệ.' }) cabinetId?: string | null;
  @ValidateIf((_o, v) => v !== null) @IsOptional() @IsEmail({}, { message: 'Người phụ trách không hợp lệ.' }) ownerEmail?: string | null;
}

class DeviceInfoQueryDto {
  @MaxLength(DEVICE_INFO_MAX_IDS * 38, { message: 'Quá nhiều thiết bị trong một lần hỏi.' })
  @OptionalUuidListQuery('Danh sách thiết bị không hợp lệ.')
  ids?: string;
}

class DeviceParamDto {
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  deviceId!: string;
}

class ContentQueryDto {
  @IsOptional() @IsIn(['view', 'edit'], { message: 'Chế độ mở không hợp lệ.' }) mode?: 'view' | 'edit';
  @IsOptional() @IsUUID(undefined, { message: 'Mã phiên bản không hợp lệ.' }) versionId?: string;
}

class SaveVersionDto {
  @IsString() @MaxLength(RAW_MAX_BYTES, { message: 'Bản vẽ quá lớn.' }) xml!: string;
  @IsString() @MaxLength(RAW_MAX_BYTES, { message: 'Ảnh xem của bản vẽ quá lớn.' }) svg!: string;
  @ValidateIf((_o, v) => v !== null) @IsUUID(undefined, { message: 'Phiên bản gốc không hợp lệ.' }) basedOnVersionId!: string | null;
}

class LinksQueryDto {
  @MaxLength(DEVICE_INFO_MAX_IDS * 38, { message: 'Quá nhiều kết nối trong một lần hỏi.' })
  @OptionalUuidListQuery('Danh sách kết nối không hợp lệ.')
  ids?: string;
}

class CableStatusDto {
  @IsString() @MaxLength(RAW_MAX_BYTES, { message: 'Bản vẽ quá lớn.' }) xml!: string;
}

/** Trần thô của danh sách máy; trần thật là `diagram.autolayout_max_nodes`, service áp. */
class DraftFromPortMapDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000, { message: 'Quá nhiều thiết bị.' })
  @IsUUID(undefined, { each: true, message: 'Danh sách thiết bị không hợp lệ.' })
  deviceIds?: string[];
  @IsOptional() @IsUUID(undefined, { message: 'Tủ mạng không hợp lệ.' }) cabinetId?: string;
  @IsOptional() @IsUUID(undefined, { message: 'Site không hợp lệ.' }) siteId?: string;
}

class PresentationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120, { message: 'Tên bản vẽ từ 1 đến 120 ký tự.' })
  @NoSecretText('Tên bản trình bày')
  name?: string;
}

class LabelDto {
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120, { message: 'Tên phiên bản tối đa 120 ký tự.' })
  @NoSecretText('Tên phiên bản')
  label!: string | null;
}

export interface DiagramEditorSettings {
  /** `diagram.editor_init_timeout_seconds` */
  initTimeoutSeconds: number;
  /** `diagram.presence_ttl_seconds` */
  presenceTtlSeconds: number;
  /** `diagram.xml_max_kb` — ảnh tự do nhúng vào XML, web chặn sớm ảnh không thể lưu được. */
  xmlMaxKb: number;
}

/**
 * Sơ đồ mạng (AD-17, AD-18, Q-23). Mọi vai đọc cây và vẽ (Thành viên cũng vẽ); đổi tên, chuyển
 * nhánh, lưu trữ, khôi phục chỉ Admin/SA. Không có xoá cứng.
 *
 * Lớp `@NoStepUp()`: cây (tên, trạng thái, tạo nút, đổi tên, lưu trữ) không cần mã. Mọi route
 * XEM hoặc SỬA một bản vẽ có sẵn — nội dung, phiên bản, lịch sử, lưu, đặt tên, khôi phục, nhịp
 * "đang sửa" — khai `@RequiresStepUp('diagram')` từng cái (Q-23: xem và sửa bản vẽ đều hỏi mã;
 * một phiên bị chiếm không ghi đè được bản vẽ khi chưa gõ mã).
 */
@NoStepUp()
@Controller('api/v1/diagrams')
export class DiagramsController {
  constructor(
    private readonly diagrams: DiagramsService,
    private readonly config: SystemConfigService,
    private readonly review: DiagramReviewService,
  ) {}

  /** Khai TRƯỚC `:id` để không bị đọc thành một mã bản vẽ. */
  @Roles('sa', 'admin', 'member')
  @Get('editor-settings')
  async editorSettings(): Promise<DiagramEditorSettings> {
    const [initTimeoutSeconds, presenceTtlSeconds, xmlMaxKb] = await Promise.all([
      this.config.getNumber('diagramEditorInitTimeoutSeconds'),
      this.config.getNumber('diagramPresenceTtlSeconds'),
      this.config.getNumber('diagramXmlMaxKb'),
    ]);
    return { initTimeoutSeconds, presenceTtlSeconds, xmlMaxKb };
  }

  /**
   * Thông tin hiện tại của các máy (theo id, ngăn bằng dấu phẩy) — hộp "Thiết bị kho" dựng ô
   * chèn, thẻ thông tin đọc lại. Một lượt cho cả lô (không N+1). Không cần mã sơ đồ: đây là hồ sơ
   * thiết bị mọi vai vốn đọc được ở trang thiết bị, không phải nội dung bản vẽ.
   */
  @Roles('sa', 'admin', 'member')
  @Get('device-info')
  deviceInfo(@Query() query: DeviceInfoQueryDto) {
    const ids = splitUuidList(query.ids) ?? [];
    if (ids.length > DEVICE_INFO_MAX_IDS) {
      throw new BadRequestException({ code: 'DIAGRAM_DEVICE_INFO_TOO_MANY', message: 'Quá nhiều thiết bị trong một lần hỏi.' });
    }
    return this.diagrams.deviceInfos(ids);
  }

  /**
   * Dòng sơ đồ cổng theo id (= `ims_link_id`) — thẻ dây, nét vừa khai. Không cần mã sơ đồ: đây là
   * sơ đồ cổng mọi vai vốn đọc được ở trang thiết bị. CHỈ ĐỌC: `diagrams` không có route nào ghi
   * sơ đồ cổng (AD-18) — "Khai"/"Gỡ" là web gọi thẳng endpoint của `devices`.
   */
  @Roles('sa', 'admin', 'member')
  @Get('links')
  links(@Query() query: LinksQueryDto) {
    const ids = splitUuidList(query.ids) ?? [];
    if (ids.length > DEVICE_INFO_MAX_IDS) {
      throw new BadRequestException({ code: 'DIAGRAM_LINKS_TOO_MANY', message: 'Quá nhiều kết nối trong một lần hỏi.' });
    }
    return this.diagrams.links(ids);
  }

  /**
   * Trạng thái dây trên XML người dùng ĐANG VẼ (chưa lưu) — "Có N kết nối mới chưa vẽ" sau khi chèn
   * máy. POST vì XML đi trong body; chỉ đọc, không lưu, không ghi nhật ký. Không cần mã sơ đồ: XML
   * là của chính người gửi, thứ trả về là sơ đồ cổng.
   */
  @Roles('sa', 'admin', 'member')
  @Post('cable-status')
  cableStatus(@Body() dto: CableStatusDto) {
    return this.diagrams.cableStatus(dto.xml);
  }

  /** Bản vẽ có máy này ở phiên bản mới nhất — chỉ tên + id (thông tin của cây, không cần mã). */
  @Roles('sa', 'admin', 'member')
  @Get('by-device/:deviceId')
  byDevice(@Param() params: DeviceParamDto) {
    return this.diagrams.diagramsWithDevice(params.deviceId);
  }

  @Roles('sa', 'admin', 'member')
  @Get()
  async tree() {
    // Trạng thái "chờ duyệt" + số phiên bản chính thức (Q-23) — vẫn chỉ là thông tin của cây.
    return this.review.overlay(await this.diagrams.tree());
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('diagram.created', 'diagram', { writtenByService: true })
  create(@Body() dto: CreateNodeDto, @Req() req: AuthedRequest) {
    return this.diagrams.create(req.user!.email, dto);
  }

  /** Tên + loại + trạng thái của một nút — màn mở bản vẽ hiện tên trước khi hỏi mã. */
  @Roles('sa', 'admin', 'member')
  @Get(':id')
  async node(@Param() params: IdParamDto) {
    const [reviewed] = await this.review.overlay([await this.diagrams.node(params.id)]);
    return reviewed;
  }

  @Roles('sa', 'admin')
  @Patch(':id')
  @Audited('diagram.updated', 'diagram', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() dto: UpdateNodeDto, @Req() req: AuthedRequest) {
    return this.diagrams.update(req.user!.email, params.id, dto);
  }

  @Roles('sa', 'admin')
  @Post(':id/archive')
  @Audited('diagram.archived', 'diagram', { writtenByService: true })
  async archive(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    await this.diagrams.archive(req.user!.email, params.id);
    return { ok: true };
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/content')
  content(@Param() params: IdParamDto, @Query() query: ContentQueryDto, @Req() req: AuthedRequest) {
    return this.diagrams.content(req.user!.email, params.id, { mode: query.mode ?? 'view', versionId: query.versionId });
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/versions')
  versions(@Param() params: IdParamDto) {
    return this.diagrams.versions(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/versions/:versionId/changes')
  changes(@Param() params: VersionParamDto) {
    return this.diagrams.changes(params.id, params.versionId);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/history')
  history(@Param() params: IdParamDto) {
    return this.diagrams.history(params.id);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/versions')
  @Audited('diagram.saved', 'diagram', { writtenByService: true })
  save(@Param() params: IdParamDto, @Body() dto: SaveVersionDto, @Req() req: AuthedRequest) {
    return this.diagrams.save(req.user!.email, params.id, dto);
  }

  /** "Dựng nháp từ sơ đồ cổng" (FR-048): một phiên bản mới — sửa bản vẽ nên hỏi mã như lưu. */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/versions/from-port-map')
  @Audited('diagram.saved', 'diagram', { writtenByService: true })
  draftFromPortMap(@Param() params: IdParamDto, @Body() dto: DraftFromPortMapDto, @Req() req: AuthedRequest) {
    return this.diagrams.draftFromPortMap(req.user!.email, params.id, dto);
  }

  /** Mọi vai gọi được; service chỉ cho Thành viên đặt tên phiên bản do chính họ lưu. */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/versions/:versionId/label')
  @Audited('diagram.version_labeled', 'diagram', { writtenByService: true })
  async label(@Param() params: VersionParamDto, @Body() dto: LabelDto, @Req() req: AuthedRequest) {
    await this.diagrams.label({ email: req.user!.email, role: req.user!.role }, params.id, params.versionId, dto.label);
    return { ok: true };
  }

  @Roles('sa', 'admin')
  @RequiresStepUp('diagram')
  @Post(':id/versions/:versionId/restore')
  @Audited('diagram.version_restored', 'diagram', { writtenByService: true })
  restore(@Param() params: VersionParamDto, @Req() req: AuthedRequest) {
    return this.diagrams.restore(req.user!.email, params.id, params.versionId);
  }

  /**
   * "Tạo bản trình bày" từ bản chính thức (Q-23): mọi vai. Đòi mã sơ đồ vì nó chép NỘI DUNG bản
   * chính thức sang một bản người gọi mở được.
   */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/presentations')
  @Audited('diagram.presentation_created', 'diagram', { writtenByService: true })
  async createPresentation(@Param() params: IdParamDto, @Body() dto: PresentationDto, @Req() req: AuthedRequest) {
    const [reviewed] = await this.review.overlay([await this.diagrams.createPresentation(req.user!.email, params.id, dto)]);
    return reviewed;
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/presence')
  @Audited('diagram.editing_started', 'diagram', { writtenByService: true })
  presence(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.diagrams.heartbeat({ email: req.user!.email, fullName: req.user!.fullName }, params.id);
  }
}
