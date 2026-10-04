import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiagramsController } from './diagrams.controller';
import { DEVICE_LOOKS_MAX_IDS, type DiagramsService } from './diagrams.service';

/**
 * `device-looks` nhúng tới hai ảnh thật mỗi máy vào câu trả lời — trần riêng, nhỏ hơn
 * `device-info`; web chia lô theo đúng trần này.
 */
describe('GET /diagrams/device-looks — trần số máy một lần hỏi', () => {
  const looks = jest.fn().mockResolvedValue({ imsStyleKeys: [], items: [] });
  const controller = new DiagramsController({ deviceLooks: looks } as unknown as DiagramsService, ...([null, null, null, null, null] as unknown as [never, never, never, never, never]));
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID()).join(',');

  it('đúng trần thì qua', async () => {
    await controller.deviceLooks({ ids: ids(DEVICE_LOOKS_MAX_IDS) });
    expect(looks).toHaveBeenCalledTimes(1);
  });

  it('web chia lô đúng bằng trần này (DEVICE_LOOKS_BATCH)', () => {
    const web = readFileSync(join(__dirname, '../../../../web/src/features/diagrams/use-photo-bridge.tsx'), 'utf8');
    expect(/DEVICE_LOOKS_BATCH = (\d+);/.exec(web)?.[1]).toBe(String(DEVICE_LOOKS_MAX_IDS));
  });

  it('quá trần một máy → 400, không đọc ảnh nào', () => {
    looks.mockClear();
    expect(() => controller.deviceLooks({ ids: ids(DEVICE_LOOKS_MAX_IDS + 1) })).toThrow(expect.objectContaining({ status: 400 }) as Error);
    expect(looks).not.toHaveBeenCalled();
  });
});
