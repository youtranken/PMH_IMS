import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import type { AuditedMeta } from './audited.decorator';
import type { AuditWriterService } from './audit-writer.service';

function contextFor(): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        user: { email: 'it01@pmh.com.vn' },
        params: { id: 'device-1' },
        method: 'POST',
        path: '/api/v1/devices',
      }),
    }),
  } as unknown as ExecutionContext;
}

function reflectorFor(meta: AuditedMeta | undefined): Reflector {
  return { getAllAndOverride: () => meta } as unknown as Reflector;
}

/**
 * CỐ Ý chỉ cài `appendBestEffort`. Interceptor gọi `append` (bản NÉM lỗi) thì bài test đỏ
 * bằng TypeError — đúng điều cần: interceptor chạy SAU khi mutation đã commit, ném ở đó biến
 * một thao tác đã thành công thành 500 và người dùng bấm lại sẽ tạo bản ghi trùng. Xem khối
 * chú thích của `AuditWriterService` để biết ranh giới giữa ba hàm ghi.
 */
function writerSpy() {
  const calls: unknown[] = [];
  const writer = {
    appendBestEffort: (entry: unknown) => {
      calls.push(entry);
      return Promise.resolve();
    },
  } as unknown as AuditWriterService;
  return { writer, calls };
}

const handler: CallHandler = { handle: () => of({ ok: true }) };

async function run(meta: AuditedMeta | undefined) {
  const { writer, calls } = writerSpy();
  const interceptor = new AuditInterceptor(reflectorFor(meta), writer);
  await new Promise((resolve) =>
    interceptor.intercept(contextFor(), handler).subscribe({ complete: () => resolve(null) }),
  );
  return calls;
}

describe('AuditInterceptor', () => {
  it('route không khai @Audited → không ghi gì', async () => {
    await expect(run(undefined)).resolves.toEqual([]);
  });

  it('route khai @Audited thường → ghi một dòng audit', async () => {
    const calls = await run({
      action: 'device.created',
      actions: ['device.created'],
      objectType: 'device',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      actor: 'it01@pmh.com.vn',
      action: 'device.created',
      objectType: 'device',
      objectId: 'device-1',
    });
  });

  /**
   * Hồi quy: trước đây route vừa có `@Audited` vừa để service ghi audit trong transaction,
   * nên MỖI thao tác đẻ ra hai dòng — một dòng chi tiết và một dòng chung chung, đôi khi
   * còn khác tên hành động. Màn nhật ký (Epic 6) đọc vào sẽ thấy mọi việc lặp đôi.
   */
  it('route khai writtenByService → interceptor ĐỨNG NGOÀI, không ghi dòng thứ hai', async () => {
    const calls = await run({
      action: 'device.created',
      actions: ['device.created'],
      objectType: 'device',
      writtenByService: true,
    });
    expect(calls).toEqual([]);
  });
});
