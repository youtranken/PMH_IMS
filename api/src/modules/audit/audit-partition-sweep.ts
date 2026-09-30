import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { SweepService } from '../queue/sweep.service';

/**
 * Ngăn năm của `audit_log` (OLD-DB-03) tự có trước giao thừa.
 *
 * Mỗi lượt sweep gọi `audit_log_ensure_partitions`: đủ ngăn năm nay + năm sau thì hàm chỉ đọc
 * catalog rồi về, nên gọi mỗi phút không tốn gì. Việc dựng ngăn nằm trong hàm SQL
 * SECURITY DEFINER vì worker chạy bằng `ims_app`, role không sở hữu bảng.
 *
 * Ngày tính theo UTC vì ranh giới ngăn là UTC (xem `0011_audit_log.sql`).
 */
@Injectable()
export class AuditPartitionSweep implements OnModuleInit {
  private readonly logger = new Logger(AuditPartitionSweep.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register({ name: 'audit-partitions', run: () => this.ensure().then(() => undefined) });
  }

  /** Trả về số dòng đã dời khỏi ngăn DEFAULT sang ngăn đúng năm. */
  async ensure(now: Date = new Date()): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    const result = await this.db.execute<{ moved: string }>(
      sql`SELECT audit_log_ensure_partitions(${day}::date)::text AS moved`,
    );
    const moved = Number(result.rows[0]?.moved ?? 0);
    if (moved > 0) {
      this.logger.warn(`audit_log: dời ${moved} dòng khỏi ngăn DEFAULT sang ngăn đúng năm`);
    }
    return moved;
  }
}
