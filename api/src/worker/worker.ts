import { writeFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { AppModule } from '../app.module';
import { MailConsumer } from '../modules/mail/mail.consumer';
import { OutboxService } from '../modules/outbox/outbox.service';
import { SweepService } from '../modules/queue/sweep.service';
import {
  EVENTS_QUEUE,
  EVENTS_JOB_OPTIONS,
  SWEEP_QUEUE,
  redisConnectionOptions,
} from '../modules/queue/queue.constants';
import { scheduleSweep } from '../modules/queue/sweep-schedule';
import { redactMessage, redactPii } from '../common/log-redact';

const RELAY_INTERVAL_MS = 2_000;
const SWEEP_EVERY_MS = 60_000;
const SHUTDOWN_GRACE_MS = 20_000;
/** Healthcheck của compose đọc mtime file này (OPS-03). */
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker-heartbeat';

/**
 * Lỗi của một job, đã chà hai lớp trước khi ghi ra log hoặc vào `outbox.fail_reason`.
 *
 *   · `redactMessage` bỏ THAM SỐ ĐÃ BIND của lỗi truy vấn (hash Argon2, ciphertext TOTP,
 *     email, họ tên — NFR-04/AD-4);
 *   · `redactPii` che địa chỉ email, vì lỗi SMTP hay nhúng nguyên địa chỉ người nhận.
 *
 * Chỉ có lớp thứ hai thì một job hỏng vì lỗi DB vẫn in trọn `params`.
 */
function jobFailure(error: unknown): string {
  return redactPii(redactMessage(error));
}

/**
 * Process THỨ HAI của cùng codebase: gọi service in-process qua DI — không HTTP nội bộ.
 * Nhiệm vụ: relay outbox → BullMQ, consumer gửi mail, sweep định kỳ.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const connection = redisConnectionOptions(process.env.REDIS_URL);
  if (!connection) throw new Error('Worker cần REDIS_URL — không khởi động.');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const outbox = app.get(OutboxService);
  const sweep = app.get(SweepService);
  const mail = app.get(MailConsumer);

  const eventsQueue = new Queue(EVENTS_QUEUE, {
    connection,
    defaultJobOptions: EVENTS_JOB_OPTIONS,
  });
  const sweepQueue = new Queue(SWEEP_QUEUE, { connection });

  const eventsWorker = new Worker(
    EVENTS_QUEUE,
    async (job: Job) => {
      const data = job.data as { id?: string };
      if (data?.id) await mail.handle(job.name, data.id);
    },
    // SMTP chậm không được chặn cả hàng đợi: 4 thư gửi song song.
    { connection, concurrency: 4 },
  );

  /*
   * Không có listener 'error' thì lỗi kết nối Redis (Redis khởi động lại, mạng chớp) thành
   * uncaught exception và giết process — container restart lặp, job đang gửi bị gửi lại.
   * Ghi log và để ioredis tự nối lại.
   */
  const onRedisError = (name: string) => (err: Error) =>
    logger.error(`${name} lỗi Redis: ${jobFailure(err)}`);
  eventsQueue.on('error', onRedisError('eventsQueue'));
  sweepQueue.on('error', onRedisError('sweepQueue'));
  eventsWorker.on('error', onRedisError('eventsWorker'));

  // BullMQ phát 'failed' MỖI attempt — chỉ ghi DLQ khi đã cạn retry, nếu không fail_count phồng.
  eventsWorker.on('failed', (job, err) => {
    const made = job?.attemptsMade ?? 0;
    const max = job?.opts.attempts ?? 1;
    const reason = jobFailure(err);
    if (made < max) {
      logger.warn(`EVENTS job ${job?.id} attempt ${made}/${max} lỗi: ${reason}`);
      return;
    }
    const id = (job?.data as { id?: string })?.id;
    logger.error(`EVENTS job ${job?.id} cạn retry → DLQ: ${reason}`);
    if (id) {
      void outbox
        .markFailed(id, reason)
        .catch((e) => logger.error(`markFailed lỗi: ${jobFailure(e)}`));
    }
  });

  const sweepWorker = new Worker(SWEEP_QUEUE, async () => sweep.runAll(), { connection });
  sweepWorker.on('error', onRedisError('sweepWorker'));
  sweepWorker.on('failed', (job, err) => {
    logger.error(`SWEEP job ${job?.id} lỗi: ${jobFailure(err)}`);
  });

  await scheduleSweep(sweepQueue, SWEEP_EVERY_MS);

  /*
   * Heartbeat chỉ được ghi khi một lượt relay chạy xong VÀ Redis trả lời: healthcheck của compose
   * đọc mtime file này, nên DB hỏng hay Redis mất đều làm worker báo unhealthy.
   */
  let inflight: Promise<void> | null = null;
  const relayTimer = setInterval(() => {
    if (inflight) return;
    inflight = outbox
      .relayBatch(eventsQueue)
      .then(async () => {
        await eventsQueue.count(); // một lượt hỏi Redis thật
        await writeFile(HEARTBEAT_FILE, String(Date.now()));
      })
      .catch((e) => logger.error(`relay lỗi: ${jobFailure(e)}`))
      .finally(() => {
        inflight = null;
      });
  }, RELAY_INTERVAL_MS);

  logger.log(
    `Worker sẵn sàng — relay ${RELAY_INTERVAL_MS}ms, sweep ${SWEEP_EVERY_MS}ms, handlers=${sweep.registeredCount}`,
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(relayTimer);
    // Đợi lượt relay đang chạy xong trước khi đóng pool, có trần để không treo quá stop_grace_period.
    if (inflight) {
      await Promise.race([inflight, new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS))]);
    }
    await eventsWorker.close();
    await sweepWorker.close();
    await eventsQueue.close();
    await sweepQueue.close();
    await app.close();
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void bootstrap();
