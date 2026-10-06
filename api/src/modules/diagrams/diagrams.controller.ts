import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { NoSecretText } from '../../common/no-secret-text';
import { OptionalUuidListQuery, splitUuidList } from '../../common/query-uuid';
import { Audited } from '../audit/audited.decorator';
import { Roles } from '../auth/roles.decorator';
import { NoStepUp, RequiresStepUp } from '../auth/step-up.decorator';
import type { AuthedRequest } from '../auth/types';
import { SystemConfigService } from '../config-sys/system-config.service';
import { diagramDraftKey } from './diagram-draft-key';
import { unplacedColumnSpec } from './diagram-frames';
import { DiagramDriftService } from './diagram-drift.service';
import { DiagramNavigationService } from './diagram-navigation.service';
import { DiagramPruneService } from './diagram-prune.service';
import { DiagramReviewService, type ReviewedNode } from './diagram-review.service';
import { DIAGRAM_NODE_TYPES, type DiagramNodeType } from './diagram.schema';
import { DEVICE_INFO_MAX_IDS, DEVICE_LOOKS_MAX_IDS, DiagramsService } from './diagrams.service';

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

/** Bản vẽ con nhân bản: cha nằm ở đường dẫn, không nhận `parentId` trong thân. */
class CopiedChildDto {
  @IsString() @Length(1, 120, { message: 'Tên bản vẽ từ 1 đến 120 ký tự.' }) name!: string;
  @IsIn(DIAGRAM_NODE_TYPES, { message: 'Loại nút không hợp lệ.' }) nodeType!: DiagramNodeType;
  @IsOptional() @IsUUID(undefined, { message: 'Site không hợp lệ.' }) siteId?: string;
  @IsOptional() @IsUUID(undefined, { message: 'Tủ mạng không hợp lệ.' }) cabinetId?: string;
  @IsOptional() @IsEmail({}, { message: 'Người phụ trách không hợp lệ.' }) ownerEmail?: string;
  /** Phiên bản của bản cha để chép; thiếu = bản mới nhất. Service kiểm nó thuộc đúng bản cha. */
  @IsOptional() @IsUUID(undefined, { message: 'Phiên bản không hợp lệ.' }) versionId?: string;
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

class FindQueryDto {
  @IsString() @Length(2, 100, { message: 'Gõ từ 2 đến 100 ký tự để tìm.' }) q!: string;
}

class PathQueryDto {
  @IsUUID(undefined, { message: 'Máy đầu không hợp lệ.' }) from!: string;
  @IsUUID(undefined, { message: 'Máy cuối không hợp lệ.' }) to!: string;
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

class CabinetParamDto {
  @IsUUID(undefined, { message: 'Mã tủ không hợp lệ.' })
  cabinetId!: string;
}

class SubnetParamDto {
  @IsUUID(undefined, { message: 'Mã dải không hợp lệ.' })
  subnetId!: string;
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

/** Dải phiên bản người dùng đã thấy trong hộp xác nhận ("#13–#17") — service so với dải thật. */
/** Số phiên bản tối đa của một bản vẽ (cột `seq` là `integer`). */
const SEQ_MAX = 2_147_483_647;

class DraftsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số bản nháp bắt đầu không hợp lệ.' })
  @Min(1, { message: 'Số bản nháp bắt đầu không hợp lệ.' })
  @Max(SEQ_MAX, { message: 'Số bản nháp bắt đầu không hợp lệ.' })
  fromSeq?: number;
}

class DiscardDraftsDto extends DraftsQueryDto {
  @IsOptional() @IsString() @MaxLength(2000, { message: 'Dải phiên bản không hợp lệ.' }) ranges?: string;
}

/** Tên gõ lại để xác nhận "Xoá hẳn" / "Xóa vĩnh viễn" — service so với tên thật. */
class PurgeDto {
  @IsString() @Length(1, 120, { message: 'Gõ lại đúng tên bản vẽ để xác nhận.' }) name!: string;
}

export interface DiagramEditorSettings {
  /** `diagram.editor_init_timeout_seconds` */
  initTimeoutSeconds: number;
  /** `diagram.presence_ttl_seconds` */
  presenceTtlSeconds: number;
  /**
   * `diagram.xml_max_kb` — web chặn sớm MỘT ảnh tự do lớn hơn trần này. Ảnh lưu riêng một lần
   * (Q-23) nên trần đo XML khô không tính ảnh; tổng kể cả ảnh do trần XML ướt của cổng chặn.
   */
  xmlMaxKb: number;
  /** `diagram.draft_keep_hours` — bản vẽ dở cất ở trình duyệt quá ngần này giờ thì bỏ. */
  draftKeepHours: number;
  /** `diagram.device_width_px` — bề rộng chuẩn của ô thiết bị trên trang tự do. */
  deviceWidthPx: number;
  /** Cột "Chưa khai U" màn sửa dựng khi Hủy hộp khai U mà trang chưa có cột của tủ (Q-23 06/10 D). */
  rackColumn: { style: string; width: number; top: number; bottom: number; gap: number };
}

/**
 * Sơ đồ mạng (AD-17, AD-18, Q-23). Mọi vai đọc cây và vẽ (Thành viên cũng vẽ); đổi tên, chuyển
 * nhánh, lưu trữ, khôi phục chỉ Admin/SA. Xoá cứng chỉ có "Bỏ bản nháp" và "Xoá hẳn" bản chưa
 * phát hành (Q-23), qua `DiagramPruneService`.
 *
 * Lớp `@NoStepUp()`: cây (tên, trạng thái, tạo nút, đổi tên, lưu trữ) không cần mã. Mọi route
 * XEM hoặc SỬA một bản vẽ có sẵn — nội dung, phiên bản, lịch sử, lưu, đặt tên, khôi phục — khai
 * `@RequiresStepUp('diagram')` từng cái (Q-23: xem và sửa bản vẽ đều hỏi mã; một phiên bị chiếm
 * không ghi đè được bản vẽ khi chưa gõ mã).
 */
@NoStepUp()
@Controller('api/v1/diagrams')
export class DiagramsController {
  constructor(
    private readonly diagrams: DiagramsService,
    private readonly config: SystemConfigService,
    private readonly review: DiagramReviewService,
    private readonly drift: DiagramDriftService,
    private readonly navigation: DiagramNavigationService,
    private readonly prune: DiagramPruneService,
    private readonly crypto: EnvelopeCryptoService,
  ) {}

  /** Cây kèm "lệch kho (N)" của bản chính thức hiện hành — đọc bộ đệm, không đọc kho (Q-23). */
  private async withDrift(nodes: ReviewedNode[]): Promise<(ReviewedNode & { driftCount: number })[]> {
    const counts = await this.drift.counts(nodes.map((n) => n.id));
    return nodes.map((node) => ({ ...node, driftCount: counts.get(node.id) ?? 0 }));
  }

  /** Khai TRƯỚC `:id` để không bị đọc thành một mã bản vẽ. */
  @Roles('sa', 'admin', 'member')
  @Get('editor-settings')
  async editorSettings(): Promise<DiagramEditorSettings> {
    const [initTimeoutSeconds, presenceTtlSeconds, xmlMaxKb, draftKeepHours, deviceWidthPx] = await Promise.all([
      this.config.getNumber('diagramEditorInitTimeoutSeconds'),
      this.config.getNumber('diagramPresenceTtlSeconds'),
      this.config.getNumber('diagramXmlMaxKb'),
      this.config.getNumber('diagramDraftKeepHours'),
      this.config.getNumber('diagramDeviceWidthPx'),
    ]);
    return { initTimeoutSeconds, presenceTtlSeconds, xmlMaxKb, draftKeepHours, deviceWidthPx, rackColumn: unplacedColumnSpec(deviceWidthPx) };
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
   * Hình "Biểu tượng" / "Ảnh thật" (từng mặt) của các máy — công tắc Ảnh thật trên màn sửa. Ảnh
   * nhúng dạng data URI đã thu nhỏ. Không cần mã sơ đồ: ảnh và biểu tượng là hồ sơ thiết bị mọi vai
   * vốn xem được ở trang thiết bị, không phải nội dung bản vẽ.
   */
  @Roles('sa', 'admin', 'member')
  @Get('device-looks')
  deviceLooks(@Query() query: DeviceInfoQueryDto) {
    const ids = splitUuidList(query.ids) ?? [];
    if (ids.length > DEVICE_LOOKS_MAX_IDS) {
      throw new BadRequestException({
        code: 'DIAGRAM_DEVICE_INFO_TOO_MANY',
        message: `Quá nhiều thiết bị trong một lần hỏi (tối đa ${DEVICE_LOOKS_MAX_IDS}).`,
      });
    }
    return this.diagrams.deviceLooks(ids);
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

  /**
   * Khung tủ dựng sẵn để chèn ("Chèn tủ"): máy còn dùng trong tủ + bố cục theo U. Không cần mã sơ
   * đồ: đây là danh mục tủ + hồ sơ thiết bị mọi vai vốn đọc được, không phải nội dung bản vẽ.
   */
  @Roles('sa', 'admin', 'member')
  @Get('cabinet-frame/:cabinetId')
  cabinetFrame(@Param() params: CabinetParamDto) {
    return this.diagrams.cabinetFrame(params.cabinetId);
  }

  /** Thẻ khung VLAN: CIDR, VLAN, site, IP đã cấp / còn trống — dữ liệu IPAM mọi vai đọc được. */
  @Roles('sa', 'admin', 'member')
  @Get('subnet-info/:subnetId')
  subnetInfo(@Param() params: SubnetParamDto) {
    return this.diagrams.subnetInfo(params.subnetId);
  }

  /** Bản vẽ có máy này ở phiên bản mới nhất — chỉ tên + id (thông tin của cây, không cần mã). */
  @Roles('sa', 'admin', 'member')
  @Get('by-device/:deviceId')
  byDevice(@Param() params: DeviceParamDto) {
    return this.diagrams.diagramsWithDevice(params.deviceId);
  }

  /**
   * Ô tìm của trình xem: máy khớp mã/tên/IP + bản vẽ chính thức chứa nó (tên + id) — máy không có
   * trên bản đang xem thì bấm mở bản vẽ kia rồi bay tới. Thông tin của cây, không cần mã sơ đồ.
   */
  @Roles('sa', 'admin', 'member')
  @Get('find')
  find(@Query() query: FindQueryDto) {
    return this.navigation.find(query.q);
  }

  /**
   * "Chỉ đường" giữa hai máy trên sơ đồ cổng (chỉ đọc qua `devices.api`). Trả máy + dây + tên bản vẽ
   * chứa từng máy, không trả nội dung bản vẽ: web tự tô đoạn nằm trên bản đang mở.
   */
  @Roles('sa', 'admin', 'member')
  @Get('path')
  path(@Query() query: PathQueryDto) {
    return this.navigation.path(query.from, query.to);
  }

  @Roles('sa', 'admin', 'member')
  @Get()
  async tree() {
    // Trạng thái "chờ duyệt" + số phiên bản chính thức (Q-23) — vẫn chỉ là thông tin của cây.
    return this.withDrift(await this.review.overlay(await this.diagrams.tree()));
  }

  /** Khu "Đã lưu trữ" (Q-23): chỉ tên / trạng thái / ai cất — như cây, không cần mã. ĐẶT TRƯỚC `:id`. */
  @Roles('sa', 'admin', 'member')
  @Get('archived')
  archivedList() {
    return this.diagrams.archivedList();
  }

  @Roles('sa', 'admin', 'member')
  @Post()
  @Audited('diagram.created', 'diagram', { writtenByService: true })
  create(@Body() dto: CreateNodeDto, @Req() req: AuthedRequest) {
    return this.diagrams.create(req.user!.email, dto);
  }

  /**
   * "Dựng từ kho": bản vẽ cấp tủ ra đời cùng phiên bản #1 là mặt tủ từ kho. Đòi mã sơ đồ vì nó
   * ghi NỘI DUNG bản vẽ, như "Dựng lại mặt tủ".
   */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post('from-stock')
  @Audited(['diagram.created', 'diagram.saved'], 'diagram', { writtenByService: true })
  createFromStock(@Body() dto: CreateNodeDto, @Req() req: AuthedRequest) {
    return this.diagrams.createFromStock(req.user!.email, dto);
  }

  /**
   * "Thêm bản vẽ con" kiểu nhân bản: con mang sẵn nội dung mới nhất của bản cha. Đòi mã sơ đồ vì
   * nó chép NỘI DUNG bản cha (như tạo bản trình bày); "Bản trống" vẫn đi `POST /diagrams`.
   */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/copied-children')
  @Audited(['diagram.created', 'diagram.saved'], 'diagram', { writtenByService: true })
  createCopiedChild(@Param() params: IdParamDto, @Body() dto: CopiedChildDto, @Req() req: AuthedRequest) {
    return this.diagrams.createCopiedChild(req.user!.email, params.id, dto);
  }

  /** Tên + loại + trạng thái của một nút — màn mở bản vẽ hiện tên trước khi hỏi mã. */
  @Roles('sa', 'admin', 'member')
  @Get(':id')
  async node(@Param() params: IdParamDto) {
    const [reviewed] = await this.withDrift(await this.review.overlay([await this.diagrams.node(params.id)]));
    return reviewed;
  }

  /** Thành viên vào được để đổi tên bản trình bày của mình; service chặn mọi việc khác (403). */
  @Roles('sa', 'admin', 'member')
  @Patch(':id')
  @Audited('diagram.updated', 'diagram', { writtenByService: true })
  update(@Param() params: IdParamDto, @Body() dto: UpdateNodeDto, @Req() req: AuthedRequest) {
    return this.diagrams.update({ email: req.user!.email, role: req.user!.role }, params.id, dto);
  }

  /** Thành viên chỉ lưu trữ được bản trình bày của mình — service kiểm (403). */
  @Roles('sa', 'admin', 'member')
  @Post(':id/archive')
  @Audited('diagram.archived', 'diagram', { writtenByService: true })
  async archive(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    await this.diagrams.archive({ email: req.user!.email, role: req.user!.role }, params.id);
    return { ok: true };
  }

  /** "Bỏ lưu trữ": cùng luật người được lưu trữ — service kiểm (403), bản cha còn cất thì 409. */
  @Roles('sa', 'admin', 'member')
  @Post(':id/unarchive')
  @Audited('diagram.unarchived', 'diagram', { writtenByService: true })
  unarchive(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.diagrams.unarchive({ email: req.user!.email, role: req.user!.role }, params.id);
  }

  /**
   * "Bỏ bản nháp" (Q-23): xem trước sẽ xoá bao nhiêu lần lưu (hộp xác nhận nói số này), rồi xoá.
   * Số và dải phiên bản là nội dung bản vẽ nên hỏi mã như xem phiên bản. Thành viên chỉ dọn bản
   * trình bày của mình — service kiểm (403). `fromSeq` = chỉ bỏ từ bản nháp đó trở về sau.
   */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/drafts')
  drafts(@Param() params: IdParamDto, @Query() query: DraftsQueryDto, @Req() req: AuthedRequest) {
    return this.prune.draftPreview({ email: req.user!.email, role: req.user!.role }, params.id, query.fromSeq);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/drafts/discard')
  @Audited('diagram.drafts_discarded', 'diagram', { writtenByService: true })
  discardDrafts(@Param() params: IdParamDto, @Body() dto: DiscardDraftsDto, @Req() req: AuthedRequest) {
    return this.prune.discardDrafts({ email: req.user!.email, role: req.user!.role }, params.id, dto.ranges, dto.fromSeq);
  }

  /** "Xoá hẳn" bản vẽ chưa phát hành lần nào (Q-23): Admin/SA hoặc người tạo — service kiểm. */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/purge')
  @Audited('diagram.deleted', 'diagram', { writtenByService: true })
  purge(@Param() params: IdParamDto, @Body() dto: PurgeDto, @Req() req: AuthedRequest) {
    return this.prune.purge({ email: req.user!.email, role: req.user!.role }, params.id, dto.name);
  }

  /**
   * "Xóa vĩnh viễn" bản vẽ đã lưu trữ, kể cả bản từng phát hành (Q-23): chỉ Admin/SA, gõ lại tên —
   * service kiểm thêm đã lưu trữ, không còn con, không chờ duyệt.
   */
  @Roles('sa', 'admin')
  @RequiresStepUp('diagram')
  @Post(':id/erase')
  @Audited('diagram.erased', 'diagram', { writtenByService: true })
  erase(@Param() params: IdParamDto, @Body() dto: PurgeDto, @Req() req: AuthedRequest) {
    return this.prune.erase({ email: req.user!.email, role: req.user!.role }, params.id, dto.name);
  }

  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get(':id/content')
  async content(@Param() params: IdParamDto, @Query() query: ContentQueryDto, @Req() req: AuthedRequest) {
    const mode = query.mode ?? 'view';
    const content = await this.diagrams.content(req.user!.email, params.id, { mode, versionId: query.versionId });
    // Lệch kho so với bản chụp của CHÍNH phiên bản đang mở (Q-23): chỉ báo, không sửa gì.
    const drift = content.version ? await this.drift.forVersion(params.id, content.version.id) : [];
    // Khoá mã bản vẽ dở chỉ cho tab Sửa — tab Xem không có gì để cất (Q-23 06/10).
    return mode === 'edit' ? { ...content, drift, draftKey: diagramDraftKey(this.crypto, req.user!.id, params.id) } : { ...content, drift };
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

  /** "Dựng lại mặt tủ" (bản vẽ loại tủ): một phiên bản nháp mới từ kho — sửa bản vẽ nên hỏi mã như lưu. */
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Post(':id/versions/rebuild-rack')
  @Audited('diagram.saved', 'diagram', { writtenByService: true })
  rebuildRack(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.diagrams.rebuildRack(req.user!.email, params.id);
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

  /**
   * Nhịp "đang mở sửa": chỉ trả tên người đang mở cùng bản vẽ — siêu dữ liệu như tên và trạng thái
   * trên cây, không phải nội dung, nên không đòi mã sơ đồ. Đòi mã thì hết ân hạn giữa lúc vẽ nhịp
   * nhận 401 và người khác thôi thấy "Đang có … mở sửa" trong khi người này vẫn đang vẽ.
   */
  @Roles('sa', 'admin', 'member')
  @NoStepUp()
  @Post(':id/presence')
  @Audited('diagram.editing_started', 'diagram', { writtenByService: true })
  presence(@Param() params: IdParamDto, @Req() req: AuthedRequest) {
    return this.diagrams.heartbeat({ email: req.user!.email, fullName: req.user!.fullName }, params.id);
  }
}
