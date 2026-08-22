import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReadStream } from 'node:fs';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { AuditWriterService } from '../audit/audit-writer.service';
import { detectFileType, SIZE_LIMITS } from './file-validation';
import type { FileKind } from './file-validation';
import { filesTable } from './files.schema';

/**
 * Chủ thể được phép có file đính kèm. Whitelist chứ không nhận chuỗi tự do: người dùng
 * gửi `ownerType` bịa ra thì file thành mồ côi, không màn nào hiển thị và không ai dọn.
 * Epic sau thêm loại thì thêm vào đây.
 */
export const FILE_OWNER_TYPES = ['device'] as const;
export type FileOwnerType = (typeof FILE_OWNER_TYPES)[number];

export interface FileRecord {
  id: string;
  originalName: string;
  mimeType: string;
  kind: FileKind;
  sizeBytes: number;
  ownerType: string;
  ownerId: string;
  uploadedBy: string;
  createdAt: Date;
}

/** Thư mục lưu file trên volume (AD-6) — tên file = uuid, không đoán được. */
function storageDir(): string {
  const dir = process.env.FILE_STORAGE_DIR;
  if (!dir) {
    throw new Error('FILE_STORAGE_DIR chưa đặt — kiểm tra docker-compose/env.');
  }
  return dir;
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
  ) {}

  /**
   * Lưu file: whitelist magic-byte + trần theo loại; ghi đĩa TRƯỚC, row SAU — insert fail
   * thì xóa file mồ côi (đĩa có mà DB không = rác vô hại; DB có mà đĩa không = tải về 500).
   */
  async save(input: {
    buffer: Buffer;
    originalName: string;
    ownerType: FileOwnerType;
    ownerId: string;
    uploadedBy: string;
    actor: string;
  }): Promise<FileRecord> {
    const detected = detectFileType(input.buffer, input.originalName);
    if (!detected) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message:
          'Định dạng không được hỗ trợ — chỉ nhận ảnh (jpg/png/webp) và giấy tờ (pdf/xlsx).',
      });
    }
    const limit = SIZE_LIMITS[detected.kind];
    if (input.buffer.length > limit) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `File vượt trần ${Math.round(limit / 1024 / 1024)}MB.`,
      });
    }

    const dir = storageDir();
    await mkdir(dir, { recursive: true });
    const storedName = randomUUID();
    await writeFile(join(dir, storedName), input.buffer);

    try {
      const rows = await this.db
        .insert(filesTable)
        .values({
          originalName: input.originalName,
          storedName,
          mimeType: detected.mime,
          sizeBytes: input.buffer.length,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          uploadedBy: input.uploadedBy,
        })
        .returning();
      await this.audit.append({
        actor: input.actor,
        action: 'file.uploaded',
        objectType: input.ownerType,
        objectId: input.ownerId,
        detail: {
          fileId: rows[0].id,
          originalName: input.originalName,
          mime: detected.mime,
          sizeBytes: input.buffer.length,
        },
      });
      return toRecord(rows[0]);
    } catch (error) {
      await unlink(join(dir, storedName)).catch(() => undefined);
      throw error;
    }
  }

  /** Danh sách file còn sống của một chủ thể. */
  async listFor(ownerType: FileOwnerType, ownerId: string): Promise<FileRecord[]> {
    const rows = await this.db
      .select()
      .from(filesTable)
      .where(
        and(
          eq(filesTable.ownerType, ownerType),
          eq(filesTable.ownerId, ownerId),
          isNull(filesTable.deletedAt),
        ),
      )
      .orderBy(asc(filesTable.createdAt));
    return rows.map(toRecord);
  }

  /** Metadata + stream để download — controller set header attachment. */
  async openForDownload(id: string, actor: string) {
    const meta = await this.requireAlive(id);
    // NFR-03: kênh đưa dữ liệu ra ngoài phải có vết — ghi TRƯỚC khi stream.
    await this.audit.append({
      actor,
      action: 'file.downloaded',
      objectType: meta.ownerType,
      objectId: meta.ownerId,
      detail: { fileId: id, originalName: meta.originalName },
    });
    const stream: ReadStream = createReadStream(join(storageDir(), meta.storedName));
    return { meta: toRecord(meta), stream };
  }

  /**
   * XÓA MỀM: đánh dấu `deleted_at`, giữ nguyên blob trên đĩa. Người dùng lỡ tay xóa biên bản
   * bảo hành thì còn lấy lại được; dọn đĩa (nếu cần) là việc của một job riêng, có kiểm soát.
   */
  async remove(actor: string, id: string): Promise<void> {
    const meta = await this.requireAlive(id);
    await this.db.transaction(async (tx) => {
      await this.removeWithin(tx, actor, id, meta.ownerType, meta.ownerId, meta.originalName);
    });
  }

  async removeWithin(
    tx: Tx,
    actor: string,
    id: string,
    ownerType: string,
    ownerId: string,
    originalName: string,
  ): Promise<void> {
    await tx.update(filesTable).set({ deletedAt: new Date() }).where(eq(filesTable.id, id));
    await this.audit.appendWithin(tx, {
      actor,
      action: 'file.deleted',
      objectType: ownerType,
      objectId: ownerId,
      detail: { fileId: id, originalName },
    });
  }

  private async requireAlive(id: string): Promise<typeof filesTable.$inferSelect> {
    const rows = await this.db
      .select()
      .from(filesTable)
      .where(and(eq(filesTable.id, id), isNull(filesTable.deletedAt)));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'Không tìm thấy file này (có thể đã bị xóa).',
      });
    }
    return rows[0];
  }
}

/** Loại file suy từ mime — không lưu thêm cột, một nguồn sự thật là `mime_type`. */
export function kindOfMime(mime: string): FileKind {
  return mime.startsWith('image/') ? 'image' : 'document';
}

function toRecord(row: typeof filesTable.$inferSelect): FileRecord {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    kind: kindOfMime(row.mimeType),
    sizeBytes: Number(row.sizeBytes),
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}
