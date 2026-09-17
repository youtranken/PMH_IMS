import { DevicePanelRegistry } from './device-panels.registry';
import type { DevicePanel, DevicePanelProvider, PanelViewer } from './device-panels';

/** Ai dang xem. Registry chi CHUYEN TIEP xuong provider chu khong tu kiem quyen. */
const SA: PanelViewer = { email: 'sa@pmh.com.vn', role: 'sa' };

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

function serviceWith(providers: DevicePanelProvider[]): DevicePanelRegistry {
  const service = new DevicePanelRegistry();
  for (const item of providers) service.register(item);
  return service;
}

describe('DevicePanelRegistry — khu mở rộng của trang chi tiết (story 2.5)', () => {
  it('chưa module nào đăng ký → danh sách rỗng, trang vẫn mở được', async () => {
    await expect(new DevicePanelRegistry().listFor('device-1', SA)).resolves.toEqual([]);
  });

  it('module đăng ký thì panel của nó xuất hiện', async () => {
    const service = serviceWith([provider('ipam', IP_PANEL)]);
    await expect(service.listFor('device-1', SA)).resolves.toEqual([IP_PANEL]);
  });

  it('đăng ký hai lần cùng một khóa thì không nhân đôi panel', async () => {
    const service = serviceWith([provider('ipam', IP_PANEL), provider('ipam', IP_PANEL)]);
    await expect(service.listFor('device-1', SA)).resolves.toHaveLength(1);
  });

  it('provider trả null = không liên quan tới thiết bị này → không hiện panel trống', async () => {
    const service = serviceWith([provider('ipam', IP_PANEL), provider('vault', null)]);
    const panels = await service.listFor('device-1', SA);
    expect(panels.map((panel) => panel.key)).toEqual(['ipam']);
  });

  /**
   * Điểm quan trọng nhất: trang chi tiết thiết bị là màn tra cứu lúc đang có sự cố.
   * Một module phụ hỏng mà kéo sập cả trang thì đúng lúc cần nhất lại không xem được gì.
   */
  it('một provider ném lỗi thì bị bỏ qua, các panel còn lại vẫn hiện', async () => {
    const service = serviceWith([
      provider('vault', () => {
        throw new Error('két sắt sập');
      }),
      provider('ipam', IP_PANEL),
    ]);
    const panels = await service.listFor('device-1', SA);
    expect(panels.map((panel) => panel.key)).toEqual(['ipam']);
  });
});
