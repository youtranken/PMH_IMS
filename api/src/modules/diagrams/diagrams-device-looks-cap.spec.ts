import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiagramsController } from './diagrams.controller';
import { DEVICE_LOOKS_MAX_IDS, type DiagramsService } from './diagrams.service';

/**
 * `device-looks` nhúng tới hai ảnh thật mỗi máy vào câu trả lời — trần riêng, nhỏ hơn
 * `device-info`; web hỏi một lượt cho một trang kết quả "Thiết bị kho", trang đó không được vượt trần.
 */
describe('GET /diagrams/device-looks — trần số máy một lần hỏi', () => {
  const looks = jest.fn().mockResolvedValue({ imsStyleKeys: [], items: [] });
  const controller = new DiagramsController({ deviceLooks: looks } as unknown as DiagramsService, ...([null, null, null, null, null, null] as unknown as [never, never, never, never, never, never]));
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID()).join(',');

  it('đúng trần thì qua', async () => {
    await controller.deviceLooks({ ids: ids(DEVICE_LOOKS_MAX_IDS) });
    expect(looks).toHaveBeenCalledTimes(1);
  });

  it('một trang "Thiết bị kho" của web (STOCK_LIMIT) không vượt trần này', () => {
    const web = readFileSync(join(__dirname, '../../../../web/src/features/diagrams/stock-device-picker.tsx'), 'utf8');
    const limit = Number(/const STOCK_LIMIT = (\d+);/.exec(web)?.[1]);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(DEVICE_LOOKS_MAX_IDS);
  });

  it('quá trần một máy → 400, không đọc ảnh nào', () => {
    looks.mockClear();
    expect(() => controller.deviceLooks({ ids: ids(DEVICE_LOOKS_MAX_IDS + 1) })).toThrow(expect.objectContaining({ status: 400 }) as Error);
    expect(looks).not.toHaveBeenCalled();
  });
});
