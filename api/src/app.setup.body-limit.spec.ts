import { Body, Controller, Module, Post, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { setupApp } from './app.setup';

/*
 * Trần body: route LƯU phiên bản bản vẽ nhận tới 12 MB (XML + SVG), route soát dây trên XML đang
 * vẽ nhận cùng cỡ XML đó, route tải biểu tượng sơ đồ nhận tới trần `diagram.icon_svg_max_kb` lớn
 * nhất; mọi route khác — kể cả route khác của chính module sơ đồ — giữ trần mặc định 100 KB.
 *
 * Kiểm bằng HTTP thật vì điều cần chứng minh là THỨ TỰ middleware: parser riêng phải chạy trước
 * parser mặc định Nest gắn lúc `listen`. Đảo thứ tự thì parser mặc định từ chối body 1 MB trước
 * khi parser riêng kịp thấy nó.
 */
@Controller()
class EchoController {
  @Post('api/v1/diagrams/7b0c1c1e-0000-4000-8000-000000000001/versions')
  diagram(@Body() body: { xml: string }) {
    return { bytes: body.xml.length };
  }

  @Post('api/v1/diagrams/cable-status')
  cableStatus(@Body() body: { xml: string }) {
    return { bytes: body.xml.length };
  }

  @Post('api/v1/catalog/device-types/7b0c1c1e-0000-4000-8000-000000000002/diagram-icon')
  icon(@Body() body: { xml: string }) {
    return { bytes: body.xml.length };
  }

  @Post('api/v1/catalog/device-types/7b0c1c1e-0000-4000-8000-000000000002')
  deviceType(@Body() body: { xml: string }) {
    return { bytes: body.xml.length };
  }

  @Post('api/v1/diagrams')
  createNode(@Body() body: { xml: string }) {
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
    ['route lưu bản vẽ, 9 MB', '/api/v1/diagrams/7b0c1c1e-0000-4000-8000-000000000001/versions', 9 * 1024 * 1024, 201],
    ['route lưu bản vẽ, quá 12 MB', '/api/v1/diagrams/7b0c1c1e-0000-4000-8000-000000000001/versions', 12 * 1024 * 1024 + 10, 413],
    ['route soát dây trên XML đang vẽ, 6 MB', '/api/v1/diagrams/cable-status', 6 * 1024 * 1024, 201],
    ['route soát dây, quá 12 MB', '/api/v1/diagrams/cable-status', 12 * 1024 * 1024 + 10, 413],
    ['route tải biểu tượng sơ đồ, 600 KB', '/api/v1/catalog/device-types/7b0c1c1e-0000-4000-8000-000000000002/diagram-icon', 600 * 1024, 201],
    ['route tải biểu tượng, quá 2 MB', '/api/v1/catalog/device-types/7b0c1c1e-0000-4000-8000-000000000002/diagram-icon', 2 * 1024 * 1024 + 10, 413],
    ['route khác của danh mục, 1 MB', '/api/v1/catalog/device-types/7b0c1c1e-0000-4000-8000-000000000002', 1024 * 1024, 413],
    ['route tạo nút cây sơ đồ, 1 MB', '/api/v1/diagrams', 1024 * 1024, 413],
    ['route khác, 1 MB', '/api/v1/other', 1024 * 1024, 413],
    ['route khác, 50 KB', '/api/v1/other', 50 * 1024, 201],
  ])('%s → %i', async (_label, path, size, status) => {
    const res = await post(path, size);
    expect(res.status).toBe(status);
  });
});
