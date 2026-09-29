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
import { OwnerExistsRegistry } from '../../common/owner-exists.registry';
import { UsersApiService } from '../users/users.api';
import { detectFileType, SIZE_LIMITS } from './file-validation';
import type { FileKind } from './file-validation';
import { filesTable } from './files.schema';

/**
 * Chủ thể được phép có file đính kèm. Whitelist chứ không nhận chuỗi tự do: người dùng
 * gửi `ownerType` bịa ra thì file thành mồ côi, không màn nào hiển thị và không ai dọn.
 * Thêm loại mới (phiếu ISO, sự cố) thì thêm vào đây.
 */
/*
 * `subnet` và `nat_rule` có mặt vì: sơ đồ mạng của một dải, biên bản
 * bàn giao dải IP tĩnh từ nhà mạng, ảnh chụp cấu hình Draytek kèm rule NAT — cả ba đều là
 * giấy tờ thật và cả ba đang nằm trong thư mục chia sẻ của phòng IT chứ không trong IMS.
 */
export const FILE_OWNER_TYPES = [
  'device',
  'isp',
  'software',
  'service_account',
  'subnet',
  'nat_rule',
] as const;
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
  /** Họ tên người tải — chỉ `listFor` tra (danh sách giấy tờ); `null` khi không tra ra. */
  uploadedByName?: string | null;
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
    private readonly owners: OwnerExistsRegistry,
    private readonly users: UsersApiService,
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

    /*
     * XÁC MINH CHỦ THỂ TRƯỚC KHI GHI RA ĐĨA.
     *
     * Chú thích ở đầu file này đã ghi rõ rủi ro từ lâu — "gửi `ownerType` bịa ra thì file thành
     * mồ côi, không màn nào hiển thị và không ai dọn" — mà không có hàng rào nào đi kèm. Blob
     * vẫn nằm trên đĩa và vẫn tính vào dung lượng, vĩnh viễn.
     *
     * Đặt trước `writeFile` chứ không sau: viết ra đĩa rồi mới phát hiện chủ thể không có thật
     * thì đã tạo đúng cái file mồ côi cần tránh, và phải trông vào nhánh dọn ở `catch`.
     */
    await this.owners.assertExists(input.ownerType, input.ownerId);

    const dir = storageDir();
    await mkdir(dir, { recursive: true });
    const storedName = randomUUID();
    await writeFile(join(dir, storedName), input.buffer);

    try {
      /*
       * Hàng file + dòng audit đi CHUNG một transaction (AD-5).
       *
       * INSERT commit ngay rồi mới ghi audit bằng hàm nuốt lỗi thì file lên kho mà không có
       * vết ai đưa lên. Chung transaction thì audit hỏng kéo hàng file rollback theo, và
       * `catch` bên dưới dọn luôn blob vừa ghi ra đĩa — không còn file mồ côi.
       */
      return await this.db.transaction(async (tx) => {
        const rows = await tx
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
        await this.audit.appendWithin(tx, {
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
      });
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
    // Một lượt hỏi tên cho cả danh sách, qua cửa công khai của `users` (AD-2).
    const names = await this.users.namesByIds([...new Set(rows.map((row) => row.uploadedBy))]);
    return rows.map((row) => ({ ...toRecord(row), uploadedByName: names.get(row.uploadedBy) ?? null }));
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

  /**
   * Chủ thể của một file — để nơi gọi hỏi quyền TRƯỚC khi mở luồng tải.
   *
   * Tách riêng chứ không nhét kiểm quyền vào `openForDownload`: quyết định "ai được xem gì"
   * thuộc về ma trận của `vault`, và module `files` không được biết tới nó (AD-2). Controller
   * là chỗ duy nhất thấy cả hai — nó có `req.user` (vai + email) lẫn cửa `VaultApiService`.
   */
  async metaOf(id: string): Promise<{ ownerType: FileOwnerType; ownerId: string }> {
    const row = await this.requireAlive(id);
    return { ownerType: row.ownerType as FileOwnerType, ownerId: row.ownerId };
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
function kindOfMime(mime: string): FileKind {
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
