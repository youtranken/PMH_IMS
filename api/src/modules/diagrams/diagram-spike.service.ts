import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { diagramSpikeTable } from './diagram-spike.schema';

export interface DiagramSpikeView {
  name: string;
  /** `null` = tên này chưa có bản vẽ — màn mở ra khung trống, không phải trang lỗi. */
  xml: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * Bản thử nhúng draw.io (Q-23): lưu nguyên XML draw.io theo tên, bản lưu sau thắng.
 *
 * XML là nội dung người dùng tự do. API không dựng lại hay hiển thị nó; chỗ duy nhất vẽ nó là
 * khung draw.io chạy trong iframe sandbox (xem `web/src/features/diagrams-spike`). Ở đây chỉ
 * kiểm nó TRÔNG như một tệp draw.io, để màn không phải nạp một thứ chắc chắn hỏng.
 */
@Injectable()
export class DiagramSpikeService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
  ) {}

  async get(name: string): Promise<DiagramSpikeView> {
    const [row] = await this.db
      .select()
      .from(diagramSpikeTable)
      .where(eq(diagramSpikeTable.name, name));
    if (!row) return { name, xml: null, updatedBy: null, updatedAt: null };
    return {
      name: row.name,
      xml: row.xml,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(actor: string, name: string, xml: string): Promise<DiagramSpikeView> {
    if (!/^<mxfile[\s>]/.test(xml.trimStart())) {
      throw new BadRequestException({
        code: 'DIAGRAM_XML_INVALID',
        message: 'Nội dung không phải tệp draw.io.',
      });
    }
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(diagramSpikeTable)
        .values({ name, xml, updatedBy: actor, updatedAt: now })
        .onConflictDoUpdate({
          target: diagramSpikeTable.name,
          set: { xml, updatedBy: actor, updatedAt: now },
        })
        .returning({ id: diagramSpikeTable.id });
      // Ghi KÍCH THƯỚC, không chép XML: audit_log không xoá được, bản vẽ thì có thể mang ghi chú.
      await this.audit.appendWithin(tx, {
        actor,
        action: 'diagram_spike.saved',
        objectType: 'diagram_spike',
        objectId: row.id,
        detail: { name, bytes: Buffer.byteLength(xml) },
      });
    });
    return this.get(name);
  }
}
