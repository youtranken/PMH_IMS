import { IspDevicePanel } from './isp-device-panel';
import type { DevicePanelRegistry } from '../../common/device-panels.registry';
import type { IspLineService } from './isp-line.service';

/**
 * Một đường truyền là MỘT dòng trên trang thiết bị biên: trải thành bốn dòng nhãn–giá trị thì
 * bản đồ quan hệ đếm "Đường truyền ISP 4" cho một đường, và hộp Thanh lý liệt kê "Hotline"
 * như một thứ sẽ bị gỡ.
 */
describe('IspDevicePanel', () => {
  const build = (lines: unknown[]) =>
    new IspDevicePanel(
      {} as DevicePanelRegistry,
      { listForDevice: () => Promise.resolve(lines) } as unknown as IspLineService,
    ).buildFor('d-1');

  it('mỗi đường một dòng: mã (link) + nhà mạng · hotline · hợp đồng · WAN', async () => {
    const panel = await build([
      {
        id: 'l-1',
        code: 'ISP-VNPT-01',
        provider: 'VNPT',
        hotline: '1800 1166',
        contractNo: 'HD-9',
        wanIps: ['113.161.10.20', '113.161.10.21'],
      },
    ]);
    expect(panel?.items).toHaveLength(1);
    expect(panel?.items[0]).toMatchObject({
      label: 'ISP-VNPT-01',
      value: 'VNPT · Hotline 1800 1166 · HĐ HD-9 · WAN 113.161.10.20, 113.161.10.21',
    });
    expect(panel?.items[0].link).toContain('l-1');
  });

  it('bỏ mảnh trống, không để lại dấu "·" thừa', async () => {
    const panel = await build([
      { id: 'l-2', code: 'ISP-FPT-02', provider: 'FPT', hotline: null, contractNo: null, wanIps: [] },
    ]);
    expect(panel?.items[0].value).toBe('FPT');
  });

  it('không cắm đường nào thì không có khu', async () => {
    expect(await build([])).toBeNull();
  });
});
