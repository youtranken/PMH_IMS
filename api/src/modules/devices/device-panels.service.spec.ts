import { DevicePanelsService } from './device-panels.service';
import type { DevicePanel, DevicePanelProvider } from '../../common/device-panels';

function provider(
  key: string,
  result: DevicePanel | null | (() => never),
): DevicePanelProvider {
  return {
    panelKey: key,
    buildFor: () => {
      if (typeof result === 'function') result();
      return Promise.resolve(result as DevicePanel | null);
    },
  };
}

const IP_PANEL: DevicePanel = {
  key: 'ipam',
  title: 'Địa chỉ IP',
  items: [{ label: 'LAN', value: '172.16.10.25' }],
};

describe('DevicePanelsService — khu mở rộng của trang chi tiết (story 2.5)', () => {
  it('chưa module nào đăng ký → danh sách rỗng, trang vẫn mở được', async () => {
    const service = new DevicePanelsService();
    await expect(service.listFor('device-1')).resolves.toEqual([]);
  });

  it('module đăng ký thì panel của nó xuất hiện', async () => {
    const service = new DevicePanelsService([provider('ipam', IP_PANEL)]);
    await expect(service.listFor('device-1')).resolves.toEqual([IP_PANEL]);
  });

  it('provider trả null = không liên quan tới thiết bị này → không hiện panel trống', async () => {
    const service = new DevicePanelsService([
      provider('ipam', IP_PANEL),
      provider('vault', null),
    ]);
    const panels = await service.listFor('device-1');
    expect(panels.map((panel) => panel.key)).toEqual(['ipam']);
  });

  /**
   * Điểm quan trọng nhất: trang chi tiết thiết bị là màn tra cứu lúc đang có sự cố.
   * Một module phụ hỏng mà kéo sập cả trang thì đúng lúc cần nhất lại không xem được gì.
   */
  it('một provider ném lỗi thì bị bỏ qua, các panel còn lại vẫn hiện', async () => {
    const service = new DevicePanelsService([
      provider('vault', () => {
        throw new Error('két sắt sập');
      }),
      provider('ipam', IP_PANEL),
    ]);
    const panels = await service.listFor('device-1');
    expect(panels.map((panel) => panel.key)).toEqual(['ipam']);
  });
});
