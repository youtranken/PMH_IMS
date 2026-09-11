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
  SWEEP_JOB_OPTIONS,
  redisConnectionOptions,
} from '../modules/queue/queue.constants';
import { redactMessage, redactPii } from '../common/log-redact';

const RELAY_INTERVAL_MS = 2_000;
const SWEEP_EVERY_MS = 60_000;

/**
 * Lỗi của một job, đã chà hai lớp trước khi ghi ra log hoặc vào `outbox.fail_reason`.
 *
 *   · `redactMessage` bỏ THAM SỐ ĐÃ BIND của lỗi truy vấn (hash Argon2, ciphertext TOTP,
 *     email, họ tên — NFR-04/AD-4);
 *   · `redactPii` che địa chỉ email, vì lỗi SMTP hay nhúng nguyên địa chỉ người nhận.
 *
 * Trước 11/09 chỗ này chỉ có lớp thứ hai, nên một job hỏng vì lỗi DB vẫn in trọn `params`.
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
    { connection },
  );

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
  sweepWorker.on('failed', (job, err) => {
    logger.error(`SWEEP job ${job?.id} lỗi: ${jobFailure(err)}`);
  });

  await sweepQueue.add(
    'tick',
    {},
    { ...SWEEP_JOB_OPTIONS, repeat: { every: SWEEP_EVERY_MS }, jobId: 'sweep-tick' },
  );

  const relayTimer = setInterval(() => {
    void outbox
      .relayBatch(eventsQueue)
      .catch((e) => logger.error(`relay lỗi: ${jobFailure(e)}`));
  }, RELAY_INTERVAL_MS);

  logger.log(
    `Worker sẵn sàng — relay ${RELAY_INTERVAL_MS}ms, sweep ${SWEEP_EVERY_MS}ms, handlers=${sweep.registeredCount}`,
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(relayTimer);
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
