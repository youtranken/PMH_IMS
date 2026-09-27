import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { SystemConfigService } from '../config-sys/system-config.service';
import { SweepService } from '../queue/sweep.service';

export interface OutboxEvent {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
}

/** Dữ liệu consumer cần để quyết baseline + gửi (5.1) — payload chỉ ref, tự đọc lại từ DB. */
export interface OutboxConsumerRow {
  payload: Record<string, unknown>;
  createdAt: Date;
  processedAt: Date | null;
}

export interface FailedNotification {
  id: string;
  topic: string;
  failCount: number;
  lastError: string | null;
  lastFailedAt: Date | null;
}

/**
 * Trần re-drive (review P0 3.2): mỗi chu kỳ relay cạn retry tăng fail_count +1. Chạm trần →
 * relay NGỪNG chọn lại row (row vẫn `processed_at IS NULL`, còn hiện ở listFailed cho SA); chỉ
 * requeue tay (reset fail_count=0) mới hồi sinh. Chặn poison message re-drive vô hạn mỗi 5'.
 */
/*
 * OPS-11: lease tăng gấp đôi sau mỗi lần hỏng (5, 10, 20, 40, 80 rồi giữ 160 phút), nên 14 lần hỏng
 * ≈ 24 giờ thử lại. SMTP chết vài giờ (Google bảo trì, mất Internet) không còn làm thư rơi vào
 * trạng thái bỏ sau ~50 phút như khi lease cố định 5 phút và trần 10 lần.
 */
const MAX_RELAY_ATTEMPTS = 14;

@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register({
      name: 'outbox-purge',
      run: () => this.purgeProcessed().then(() => undefined),
    });
  }

  /**
   * Dọn dòng ĐÃ XỬ LÝ XONG và đã quá hạn giữ. Chạy từ sweep.
   *
   * ===== VÌ SAO BẢNG NÀY CẦN RETENTION =====
   *
   * Đo trên DB dev 21/09: 69.583 hàng, 100% đã xử lý, và không có đường dọn nào — nó chỉ có
   * một chiều. Trong đó 109 hàng `security.probe.alert` mang `who: <email>`.
   *
   * Email trong payload là NGOẠI LỆ CÓ TÊN, khai sẵn cạnh luật "payload không PII"
   * (AD-11/NFR-04) — không phải vi phạm, và không đụng tới ở đây. Nhưng ngoại lệ ấy được cấp
   * cho việc ĐI ĐƯỜNG: để email tới được consumer mail. Giữ lại VĨNH VIỄN sau khi đã gửi
   * xong chưa bao giờ nằm trong phần được cấp — và mỗi bản `pg_dump` đêm chở theo danh sách
   * những người từng bị nghi dò két.
   *
   * ===== `processed_at IS NOT NULL` LÀ ĐIỀU KIỆN KHÔNG ĐƯỢC BỎ =====
   *
   * Chưa xử lý nghĩa là việc CHƯA XONG: relay còn phải đẩy lại (`relayBatch` chọn đúng những
   * hàng ấy), và SA còn thấy chúng ở `listFailed`. Dọn nhầm một hàng như thế là đánh mất một
   * lá thư mà không ai biết, vĩnh viễn — nên dù cũ tới đâu cũng không đụng.
   *
   * Ngưỡng đọc từ `system_config` (AD-11, DoD gạch 8).
   */
  async purgeProcessed(): Promise<number> {
    const days = await this.config.getNumber('outboxRetentionDays');
    const { rowCount } = await this.db.execute(sql`
      DELETE FROM outbox
      WHERE processed_at IS NOT NULL
        AND processed_at < now() - make_interval(days => ${days})
    `);
    return rowCount ?? 0;
  }

  /**
   * Ghi sự kiện nghiệp vụ vào outbox TRONG transaction nghiệp vụ (AD-11) — enqueue
   * sang BullMQ tách rời (relay). Payload CHỈ id tham chiếu, KHÔNG PII.
   *
   * Lý do luật: bảng `outbox` KHÔNG có retention. Mọi hàng nằm lại vĩnh viễn và đi vào mọi
   * bản `pg_dump` đêm, nên thứ gì rơi vào đây là tự nhân bản ra nhiều nơi.
   *
   * ===== NGOẠI LỆ DUY NHẤT, CÓ TÊN: `security.probe.alert` (18/09/2026) =====
   *
   * Topic ấy mang `who: <email>` chứ không mang id, và đó là lựa chọn có cân nhắc chứ không
   * phải sơ sót — rà soát 18/09 bắt đúng chỗ này rồi quyết giữ:
   *
   *   · Email KHÔNG phải PII lạc chỗ ở đây, nó LÀ nội dung của cảnh báo. Lá thư báo "có người
   *     đang dò quanh két" mà không nói được ai thì báo để làm gì.
   *   · Đổi sang `userId` thì cửa két không tra được: người dò đã đăng nhập hợp lệ rồi, chỗ
   *     gọi (`SecurityProbeService`) chỉ nhận được `actor` là email. Muốn có id phải cho
   *     `audit` gọi sang `users.api` — một cạnh phụ thuộc MỚI giữa hai module đang cố giữ
   *     tách rời (AD-2). Đắt hơn hẳn thứ nó sửa.
   *
   * Thêm ngoại lệ thứ hai thì khai Ở ĐÂY, ngay cạnh luật — đừng để nó sống trong một chú
   * thích ở file khác rồi hai nơi nói ngược nhau.
   */
  async enqueueWithin(
    tx: Pick<Database, 'execute'>,
    topic: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO outbox (topic, payload) VALUES (${topic}, ${JSON.stringify(payload)}::jsonb)
    `);
  }

  /**
   * Relay (F1 + F3): claim event CHƯA XỬ (`processed_at IS NULL`) — không phải "chưa đẩy" —
   * bằng FOR UPDATE SKIP LOCKED (2 relay không tranh chấp), gán lease `claimed_at=now()`;
   * lease hết (dài dần theo fail_count, xem MAX_RELAY_ATTEMPTS) thì re-drive (row job cạn retry/DLQ hoặc Redis mất job KHÔNG bị nuốt — AD-11,
   * AD-9 "quét lại được"). Consumer check-and-set `processed_at` khi xử xong → hết re-drive.
   *
   * `queue.add` chạy NGOÀI transaction claim (F3: không giữ FOR UPDATE + connection suốt I/O
   * Redis). jobId = event.id (dedup — add lại trong lease/retention KHÔNG sinh job đúp, AD-11
   * at-least-once). add lỗi → lease hết hạn tự re-drive; add xong nhưng crash trước khi consumer
   * mark → job vẫn chạy (jobId còn) hoặc re-drive sau lease. Trả số event đã đẩy.
   */
  async relayBatch(queue: Queue, limit = 100): Promise<number> {
    // 1) Claim + lease trong tx NGẮN (không I/O Redis trong tx).
    const claimed = await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        id: string;
        topic: string;
        payload: Record<string, unknown>;
      }>(sql`
        SELECT id, topic, payload FROM outbox
        WHERE processed_at IS NULL
          AND fail_count < ${MAX_RELAY_ATTEMPTS}
          AND (
            claimed_at IS NULL
            OR claimed_at < now() - make_interval(mins => (5 * power(2, least(fail_count, 5)))::int)
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      if (rows.rows.length === 0) return [];
      await tx.execute(sql`
        UPDATE outbox SET claimed_at = now()
        WHERE id IN (${sql.join(
          rows.rows.map((r) => sql`${r.id}`),
          sql`, `,
        )})
      `);
      return rows.rows;
    });
    if (claimed.length === 0) return 0;
    // 2) Đẩy vào BullMQ NGOÀI tx. id đặt SAU spread → payload không shadow envelope id.
    for (const ev of claimed) {
      await queue.add(ev.topic, { ...ev.payload, id: ev.id }, { jobId: ev.id });
    }
    this.logger.debug(`relay: ${claimed.length} event`);
    return claimed.length;
  }

  /**
   * Consumer đã xử xong event → check-and-set `processed_at` (idempotent, AD-11 dedup bền):
   * 0 dòng = đã xử trước đó → bỏ qua. Sau khi set, relay KHÔNG re-drive nữa. Trả true nếu
   * lần này là lần mark thật (để consumer quyết gửi mail / skip khi đã xử — Epic 5).
   */
  async markProcessed(eventId: string): Promise<boolean> {
    const r = await this.db.execute<{ id: string }>(sql`
      UPDATE outbox SET processed_at = now()
      WHERE id = ${eventId} AND processed_at IS NULL
      RETURNING id
    `);
    return r.rows.length === 1;
  }

  /**
   * Job cạn retry (DLQ) → ghi marker BỀN vào Postgres (F2): tăng fail_count + last_error để
   * dashboard SA đếm "X thông báo gửi lỗi" (AD-9/AD-11 — không chết im lặng). Row vẫn
   * `processed_at IS NULL` nên relay re-drive tiếp (backstop lỗi tạm thời) CHO ĐẾN khi
   * fail_count chạm MAX_RELAY_ATTEMPTS thì dừng (điểm terminal, review P0 3.2).
   */
  async markFailed(eventId: string, error: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE outbox
      SET fail_count = fail_count + 1, last_error = ${error.slice(0, 1000)},
          last_failed_at = now()
      WHERE id = ${eventId}
    `);
  }

  /** Consumer đọc lại event theo id (5.1): created_at cho baseline, processed_at cho idempotent. */
  async loadForConsumer(eventId: string): Promise<OutboxConsumerRow | null> {
    const r = await this.db.execute<{
      payload: Record<string, unknown>;
      created_at: Date;
      processed_at: Date | null;
    }>(sql`
      SELECT payload, created_at, processed_at FROM outbox WHERE id = ${eventId}
    `);
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      payload: row.payload,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : null,
    };
  }

  /**
   * Badge SA (AD-11): event gửi lỗi CHƯA xử (fail_count>0, processed_at IS NULL). total = tổng
   * để đếm badge; items giới hạn để hiển thị danh sách.
   */
  async listFailed(): Promise<{ total: number; items: FailedNotification[] }> {
    const count = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM outbox
      WHERE fail_count > 0 AND processed_at IS NULL
    `);
    const r = await this.db.execute<{
      id: string;
      topic: string;
      fail_count: number;
      last_error: string | null;
      last_failed_at: Date | null;
    }>(sql`
      SELECT id, topic, fail_count, last_error, last_failed_at FROM outbox
      WHERE fail_count > 0 AND processed_at IS NULL
      ORDER BY last_failed_at DESC NULLS LAST
      LIMIT 200
    `);
    return {
      total: count.rows[0]?.n ?? 0,
      items: r.rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        failCount: row.fail_count,
        lastError: row.last_error,
        lastFailedAt: row.last_failed_at ? new Date(row.last_failed_at) : null,
      })),
    };
  }

  /** Requeue tay (AC3): reset marker lỗi + lease → relay re-drive event chưa xử. Trả true nếu có. */
  async requeue(eventId: string): Promise<boolean> {
    const r = await this.db.execute<{ id: string }>(sql`
      UPDATE outbox
      SET claimed_at = NULL, fail_count = 0, last_error = NULL, last_failed_at = NULL
      WHERE id = ${eventId} AND processed_at IS NULL
      RETURNING id
    `);
    return r.rows.length === 1;
  }
}
