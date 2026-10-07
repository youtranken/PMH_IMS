import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { photoThumbnail, type PhotoImage } from '../../common/photo-thumbnail';
import type { Tx } from '../../common/tx';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { FilesApiService, type FileRecord } from '../files/files.api';
import { diffDevice, hasChanges } from './device-changes';
import { MODEL_KEY_SQL, modelKey } from './device-model-key';
import { deviceModelTable, deviceTable } from './devices.schema';
import { DevicesService } from './devices.service';

export type PhotoSide = 'front' | 'back';
export const PHOTO_SIDES: readonly PhotoSide[] = ['front', 'back'];

/** Ảnh hai mặt: id tệp ảnh (`files`), `null` = chưa chọn. */
export interface PhotoPair {
  front: string | null;
  back: string | null;
}

export interface PhotoFile {
  id: string;
  name: string;
}

/** Màn "Ảnh thật" của một máy: ảnh riêng máy, ảnh model, ảnh đang dùng, và ảnh đính kèm chọn được. */
export interface DevicePhotos {
  device: { front: PhotoFile | null; back: PhotoFile | null };
  /** `null` = máy chưa ghi model (không có mức model). `id` = `null` khi model chưa có ảnh nào. */
  model: { id: string | null; label: string; front: PhotoFile | null; back: PhotoFile | null } | null;
  /** Ảnh vào bản vẽ: ảnh riêng máy thắng ảnh model (Q-23). */
  effective: { front: PhotoFile | null; back: PhotoFile | null };
  /** Ảnh đính kèm của máy (chọn làm ảnh riêng) và của model (chọn làm ảnh model). */
  deviceImages: PhotoFile[];
  modelImages: PhotoFile[];
}

/** Ảnh đã thu nhỏ trong bộ nhớ: tệp `files` không bao giờ đổi nội dung (tên đĩa là uuid mới mỗi lần tải). */
const THUMB_CACHE_MAX = 200;

const COLUMN: Record<PhotoSide, 'photoFrontFileId' | 'photoBackFileId'> = { front: 'photoFrontFileId', back: 'photoBackFileId' };

/**
 * Tệp ảnh vừa bị thay / bỏ — xoá mềm để không đọng lại trong Giấy tờ (Q-26 07/10). Tệp vẫn được mặt
 * kia dùng thì giữ.
 */
function replaced(before: Partial<Record<(typeof COLUMN)[PhotoSide], string | null>>, values: Partial<Record<(typeof COLUMN)[PhotoSide], string | null>>): string[] {
  const after = { ...before, ...values };
  const kept = new Set(PHOTO_SIDES.map((side) => after[COLUMN[side]]).filter(Boolean));
  return PHOTO_SIDES.map((side) => before[COLUMN[side]]).filter((id): id is string => Boolean(id) && !kept.has(id));
}

/** Cùng phép chuẩn hoá với cột sinh `device_model.model_key` (0062) — để so với chuỗi model của máy. */

/**
 * Ảnh thật của thiết bị hai mức (Q-23): ảnh riêng từng máy (chọn từ giấy tờ đính kèm của máy, cột
 * `device.photo_*`) đè ảnh theo model (loại thiết bị + chuỗi model, bảng `device_model`, ảnh là tệp
 * `files` mang `owner_type = 'device_model'`). Bản vẽ chỉ hỏi "ảnh nào đang dùng" qua `devices.api`
 * rồi nhúng ảnh đã thu nhỏ khi hydrate (AD-18) — XML lưu không chứa ảnh.
 */
@Injectable()
export class DevicePhotosService {
  private readonly thumbs = new Map<string, PhotoImage | null>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly devices: DevicesService,
    private readonly files: FilesApiService,
    private readonly config: SystemConfigService,
    private readonly audit: AuditWriterService,
  ) {}

  async photos(deviceId: string): Promise<DevicePhotos> {
    const device = await this.devices.requireRowWithin(this.db, deviceId);
    const model = await this.modelOf(device);
    const [deviceFiles, modelFiles] = await Promise.all([
      this.files.listFor('device', deviceId),
      model ? this.files.listFor('device_model', model.id) : Promise.resolve([] as FileRecord[]),
    ]);
    const images = await this.files.imagesByIds(
      [device.photoFrontFileId, device.photoBackFileId, model?.photoFrontFileId, model?.photoBackFileId].filter((id): id is string => Boolean(id)),
    );
    const ref = (id: string | null | undefined): PhotoFile | null => {
      const file = id ? images.get(id) : undefined;
      return file ? { id: file.id, name: file.originalName } : null;
    };
    const own = { front: ref(device.photoFrontFileId), back: ref(device.photoBackFileId) };
    const byModel = { front: ref(model?.photoFrontFileId), back: ref(model?.photoBackFileId) };
    const label = model?.model ?? device.model?.trim();
    return {
      device: own,
      model: label ? { id: model?.id ?? null, label, ...byModel } : null,
      // Ảnh model thắng ảnh riêng (Q-26 07/10): đổi ảnh của cả loạt máy chỉ ở một chỗ.
      effective: { front: byModel.front ?? own.front, back: byModel.back ?? own.back },
      deviceImages: deviceFiles.filter((f) => f.kind === 'image').map((f) => ({ id: f.id, name: f.originalName })),
      modelImages: modelFiles.filter((f) => f.kind === 'image').map((f) => ({ id: f.id, name: f.originalName })),
    };
  }

  /**
   * Chọn ảnh riêng cho máy (mặt trước/sau) từ ảnh đính kèm của CHÍNH máy đó; `null` = bỏ, dùng lại
   * ảnh model. Lịch sử thiết bị ghi thay đổi như mọi trường hồ sơ khác (AD-13).
   */
  async setDevicePhotos(actor: string, deviceId: string, input: Partial<PhotoPair>): Promise<DevicePhotos> {
    await this.db.transaction(async (tx) => {
      const before = await this.devices.requireRowWithin(tx, deviceId, 'update');
      this.devices.assertNotRetired(before);
      await this.assertNotFromModel(before, input, tx);
      const values = await this.chosen(input, 'device', deviceId);
      const changes = diffDevice(before, values);
      if (!hasChanges(changes)) return;
      await this.devices.updateWithin(tx, deviceId, values);
      await this.devices.recordWithin(tx, actor, deviceId, 'photos-changed', changes);
      await this.files.trashWithin(tx, actor, replaced(before, values));
    });
    return this.photos(deviceId);
  }

  /**
   * Hàng `device_model` của máy, tạo nếu chưa có — để tải ảnh model lên làm tệp `files` của hàng đó.
   * Máy đã gán model (Q-26) dùng đúng model đó. Máy "chưa có Model" dò theo loại + khoá chuẩn hoá;
   * hàng tạo ở đây mang Số U đang khai trên máy, để model sinh ra từ một máy trong tủ vẫn là model
   * gắn tủ. Máy không được tự gán vào model — gán là việc của form thiết bị.
   */
  async ensureModel(actor: string, deviceId: string): Promise<{ id: string; label: string }> {
    const device = await this.devices.requireRowWithin(this.db, deviceId);
    const linked = await this.modelOf(device);
    if (linked && device.deviceModelId) return { id: linked.id, label: linked.model };
    const label = device.model?.trim();
    if (!label) {
      throw new BadRequestException({ code: 'DEVICE_MODEL_MISSING', message: 'Máy chưa ghi model — ghi model ở hồ sơ trước khi tải ảnh theo model.' });
    }
    return this.db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: deviceModelTable.id, deviceTypeId: deviceModelTable.deviceTypeId })
        .from(deviceModelTable)
        .where(eq(deviceModelTable.modelKey, modelKey(label)));
      if (taken && taken.deviceTypeId !== device.deviceTypeId) {
        throw new ConflictException({
          code: 'DEVICE_MODEL_DUPLICATE',
          message: `Mã model "${label}" đã có trong danh mục với loại thiết bị khác — gán model đó cho máy ở hồ sơ thiết bị.`,
        });
      }
      const racked = device.rackUSize !== null;
      const [created] = await tx
        .insert(deviceModelTable)
        .values({ deviceTypeId: device.deviceTypeId, model: label, rackMountable: racked, uSize: device.rackUSize })
        .onConflictDoNothing()
        .returning({ id: deviceModelTable.id });
      if (created) {
        await this.audit.appendWithin(tx, {
          actor,
          action: 'device.model-created',
          objectType: 'device_model',
          objectId: created.id,
          detail: { deviceTypeId: device.deviceTypeId, model: label },
        });
        return { id: created.id, label };
      }
      const existing = await this.modelOf(device, tx);
      return { id: existing!.id, label };
    });
  }

  /** Chọn ảnh model (mặt trước/sau) từ ảnh đã tải lên cho model đó; áp cho mọi máy cùng model. */
  async setModelPhotos(actor: string, deviceId: string, input: Partial<PhotoPair>): Promise<DevicePhotos> {
    const device = await this.devices.requireRowWithin(this.db, deviceId);
    const model = await this.modelOf(device);
    if (!model) throw new NotFoundException({ code: 'DEVICE_MODEL_NOT_FOUND', message: 'Model này chưa có ảnh nào — tải ảnh lên trước.' });
    await this.setModelPhotosById(actor, model.id, input, { deviceId });
    return this.photos(deviceId);
  }

  /** Như `setModelPhotos` nhưng theo id model — màn Danh mục Model (Q-26). */
  async setModelPhotosById(actor: string, modelId: string, input: Partial<PhotoPair>, detail: Record<string, unknown> = {}): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(deviceModelTable).where(eq(deviceModelTable.id, modelId)).for('update');
      if (!locked) throw new NotFoundException({ code: 'DEVICE_MODEL_NOT_FOUND', message: 'Không tìm thấy model này.' });
      const values = await this.chosen(input, 'device_model', modelId);
      const changes = diffDevice(locked, values);
      if (!hasChanges(changes)) return;
      await tx
        .update(deviceModelTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(deviceModelTable.id, modelId));
      await this.files.trashWithin(tx, actor, replaced(locked, values));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'device.model-photos-changed',
        objectType: 'device_model',
        objectId: modelId,
        detail: { ...detail, model: locked.model, ...changes },
      });
    });
  }

  /** Ảnh thu nhỏ một mặt của model — ô ảnh ở Danh mục Model. Ảnh đã xoá khỏi giấy tờ coi như chưa có. */
  async modelPreview(modelId: string, side: PhotoSide): Promise<PhotoImage | null> {
    const [model] = await this.db.select().from(deviceModelTable).where(eq(deviceModelTable.id, modelId));
    const fileId = model?.[COLUMN[side]];
    if (!fileId || !(await this.files.imagesByIds([fileId])).has(fileId)) return null;
    return this.thumbnail(fileId);
  }

  /**
   * Ảnh đang dùng (id tệp) của nhiều máy MỘT lượt — sơ đồ hỏi qua `devices.api`. Ảnh đã xoá khỏi
   * giấy tờ coi như chưa chọn, nên ảnh model lại thế chỗ thay vì ô hiện ảnh hỏng.
   */
  async effectivePhotos(deviceIds: string[]): Promise<Map<string, PhotoPair>> {
    const ids = [...new Set(deviceIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: deviceTable.id,
        front: deviceTable.photoFrontFileId,
        back: deviceTable.photoBackFileId,
        modelFront: deviceModelTable.photoFrontFileId,
        modelBack: deviceModelTable.photoBackFileId,
      })
      .from(deviceTable)
      .leftJoin(
        deviceModelTable,
        or(
          eq(deviceModelTable.id, deviceTable.deviceModelId),
          and(isNull(deviceTable.deviceModelId), eq(deviceModelTable.deviceTypeId, deviceTable.deviceTypeId), sql`${deviceModelTable.modelKey} = ${MODEL_KEY_SQL(deviceTable.model)}`),
        ),
      )
      .where(inArray(deviceTable.id, ids));
    const alive = await this.files.imagesByIds(rows.flatMap((r) => [r.front, r.back, r.modelFront, r.modelBack]).filter((id): id is string => Boolean(id)));
    const pick = (...candidates: (string | null)[]) => candidates.find((id): id is string => Boolean(id && alive.has(id))) ?? null;
    return new Map(rows.map((r) => [r.id, { front: pick(r.modelFront, r.front), back: pick(r.modelBack, r.back) }]));
  }

  /** Ảnh đã thu nhỏ theo `diagram.photo_max_px`; ảnh không đọc/giải mã được thì `null`. */
  async thumbnail(fileId: string): Promise<PhotoImage | null> {
    const maxPx = await this.config.getNumber('diagramPhotoMaxPx');
    const key = `${fileId}:${maxPx}`;
    if (this.thumbs.has(key)) return this.thumbs.get(key)!;
    const source = await this.files.readImage(fileId);
    const image = source ? await photoThumbnail(source.bytes, source.mime, maxPx) : null;
    const oldest = this.thumbs.keys().next();
    if (this.thumbs.size >= THUMB_CACHE_MAX && !oldest.done) this.thumbs.delete(oldest.value);
    // Blob mất trên đĩa có thể quay lại (khôi phục từ sao lưu): chỉ nhớ kết quả có ảnh.
    if (image) this.thumbs.set(key, image);
    return image;
  }

  /** Ảnh thu nhỏ của mặt đang dùng — ảnh xem trước trên trang thiết bị. */
  async preview(deviceId: string, side: PhotoSide): Promise<PhotoImage | null> {
    const pair = (await this.effectivePhotos([deviceId])).get(deviceId);
    const fileId = pair?.[side];
    return fileId ? this.thumbnail(fileId) : null;
  }

  /**
   * Mặt nào model đã có ảnh thì máy không đặt ảnh riêng được (Q-26 07/10) — ảnh đó sẽ không bao giờ
   * hiện. Chặn ở server, không chỉ ẩn nút. Bỏ ảnh riêng (`null`) luôn được.
   */
  private async assertNotFromModel(device: typeof deviceTable.$inferSelect, input: Partial<PhotoPair>, tx: Tx): Promise<void> {
    const model = await this.modelOf(device, tx);
    const sides = PHOTO_SIDES.filter((side) => input[side] && model?.[COLUMN[side]]);
    if (sides.length === 0) return;
    throw new ConflictException({
      code: 'DEVICE_PHOTO_FROM_MODEL',
      message: `Model ${model!.model} đã có ảnh ${sides.map((side) => (side === 'front' ? 'mặt trước' : 'mặt sau')).join(' và ')} — máy dùng ảnh model. Đổi ảnh ở Danh mục › Model thiết bị.`,
    });
  }

  /** Model của máy: khoá ngoại nếu đã gán (Q-26), không thì dò theo loại + khoá chuẩn hoá như trước. */
  private async modelOf(
    device: { deviceTypeId: string; model: string | null; deviceModelId: string | null },
    db: Pick<Database, 'select'> | Tx = this.db,
  ): Promise<typeof deviceModelTable.$inferSelect | null> {
    if (device.deviceModelId) {
      const [linked] = await db.select().from(deviceModelTable).where(eq(deviceModelTable.id, device.deviceModelId));
      return linked ?? null;
    }
    const label = device.model?.trim();
    if (!label) return null;
    const [row] = await db
      .select()
      .from(deviceModelTable)
      .where(and(eq(deviceModelTable.deviceTypeId, device.deviceTypeId), eq(deviceModelTable.modelKey, modelKey(label))));
    return row ?? null;
  }

  /** Cột ảnh từ ô chọn: tệp phải là ẢNH còn sống của đúng chủ thể (máy, hoặc model). */
  private async chosen(input: Partial<PhotoPair>, ownerType: 'device' | 'device_model', ownerId: string): Promise<Record<string, string | null>> {
    const picked = PHOTO_SIDES.filter((side) => input[side] !== undefined);
    const ids = picked.map((side) => input[side]).filter((id): id is string => Boolean(id));
    const images = await this.files.imagesByIds(ids);
    const values: Record<string, string | null> = {};
    for (const side of picked) {
      const id = input[side] || null;
      if (id) {
        const file = images.get(id);
        // `files` nhận WebP, nhưng bộ vẽ ảnh của server (`@resvg/resvg-js` 2.x) không giải mã được: ô sẽ
        // lặng lẽ về biểu tượng và file xuất PNG/PDF mất ảnh — chặn ngay lúc chọn, nói rõ cách làm.
        if (file && file.mimeType === 'image/webp') {
          throw new BadRequestException({
            code: 'DEVICE_PHOTO_FORMAT',
            message: 'Ảnh WebP chưa đưa lên sơ đồ được — chọn ảnh JPG hoặc PNG (chụp màn hình hay lưu lại ảnh dạng JPG rồi đính kèm).',
          });
        }
        if (!file || file.ownerType !== ownerType || file.ownerId !== ownerId) {
          throw new BadRequestException({
            code: 'DEVICE_PHOTO_INVALID',
            message:
              ownerType === 'device'
                ? 'Ảnh chọn phải là ảnh (jpg/png/webp) trong giấy tờ đính kèm của chính máy này.'
                : 'Ảnh chọn phải là ảnh (jpg/png/webp) đã tải lên cho model này.',
          });
        }
      }
      values[COLUMN[side]] = id;
    }
    return values;
  }
}
