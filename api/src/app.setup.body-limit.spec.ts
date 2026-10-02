import { Body, Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { setupApp } from './app.setup';

/*
 * Trần body: route bản vẽ nhận tới 5 MB, mọi route khác giữ trần mặc định 100 KB.
 *
 * Kiểm bằng HTTP thật vì điều cần chứng minh là THỨ TỰ middleware: parser riêng phải chạy trước
 * parser mặc định Nest gắn lúc `listen`. Đảo thứ tự thì parser mặc định từ chối body 1 MB trước
 * khi parser riêng kịp thấy nó.
 */
@Controller()
class EchoController {
  @Post('api/v1/diagram-spike/E2E')
  diagram(@Body() body: { xml: string }) {
    return { bytes: body.xml.length };
  }

  @Post('api/v1/other')
  other(@Body() body: { xml: string }) {
    return { bytes: body.xml.length };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('setupApp · trần body JSON', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(EchoModule, { logger: false });
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (path: string, size: number) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xml: 'x'.repeat(size) }),
    });

  it.each([
    ['route bản vẽ, 1 MB', '/api/v1/diagram-spike/E2E', 1024 * 1024, 201],
    ['route bản vẽ, quá 5 MB', '/api/v1/diagram-spike/E2E', 5 * 1024 * 1024 + 10, 413],
    ['route khác, 1 MB', '/api/v1/other', 1024 * 1024, 413],
    ['route khác, 50 KB', '/api/v1/other', 50 * 1024, 201],
  ])('%s → %i', async (_label, path, size, status) => {
    const res = await post(path, size);
    expect(res.status).toBe(status);
  });
});
