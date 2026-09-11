import { DeviceRetirementRegistry, type DeviceReleaser } from './device-retirement.registry';
import type { Tx } from './tx';

function releaser(name: string, holdings: string[] = [], log?: string[]): DeviceReleaser {
  return {
    name,
    holdingsOf: () => Promise.resolve(holdings),
    releaseWithin: () => {
      log?.push(name);
      return Promise.resolve();
    },
  };
}

const ALL = ['ipam', 'software', 'device-ports', 'isp-line'];

/**
 * Sổ này FAIL-OPEN: không ai đăng ký thì `holdings()` trả rỗng, `setStatus` đọc rỗng thành
 * "máy không giữ gì", và lượt thanh lý đi tiếp trong im lặng. Không request nào hỏng.
 *
 * Nên lượt điểm danh chuyển sang lúc BOOT — cùng lý do và cùng khuôn với
 * `OwnerAccessRegistry`. Xem khối chú thích ở `MUST_REGISTER`.
 */
describe('DeviceRetirementRegistry — thiếu người dọn thì nổ lúc khởi động', () => {
  it('không ai đăng ký gì → ném, và nêu đích danh cả bốn', () => {
    const registry = new DeviceRetirementRegistry();
    expect(() => registry.onApplicationBootstrap()).toThrow(
      /ipam.*software.*device-ports.*isp-line/,
    );
  });

  /**
   * ĐÂY LÀ TRẠNG THÁI THẬT CỦA `master` TỚI 10/09 — hai người dọn, hai chủ nợ không ai nhận.
   *
   * `device_port.connected_device_id` (0013) và `isp_line.device_id` (0016) đều trỏ tới
   * `device`, đều `ON DELETE RESTRICT`, và đều không nằm trong sổ. Thanh lý con switch thì
   * màn hình của nó sạch, còn sợi dây ma vẫn nằm trên hồ sơ con router bên cạnh.
   */
  it('chỉ có ipam + software (trạng thái cũ) → vẫn ném, nêu đúng hai người còn thiếu', () => {
    const registry = new DeviceRetirementRegistry();
    registry.register(releaser('ipam'));
    registry.register(releaser('software'));
    expect(() => registry.onApplicationBootstrap()).toThrow(/device-ports/);
    expect(() => registry.onApplicationBootstrap()).toThrow(/isp-line/);
  });

  /**
   * VẾ ĐỐI CHỨNG. Không có nó thì một bản "luôn ném" cũng xanh hai bài trên, và api không bao
   * giờ khởi động lại được nữa — tức hàng rào bị gỡ ngay sáng hôm sau.
   */
  it('đủ bốn → khởi động bình thường', () => {
    const registry = new DeviceRetirementRegistry();
    for (const name of ALL) registry.register(releaser(name));
    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  /**
   * Đăng ký hai lần cùng một đối tượng (hot-reload, test dựng TestingModule nhiều lượt) không
   * được tính thành hai người — và cũng không được làm lượt điểm danh trượt.
   */
  it('đăng ký trùng không làm hỏng lượt điểm danh, và không dọn hai lần', async () => {
    const registry = new DeviceRetirementRegistry();
    const log: string[] = [];
    const ipam = releaser('ipam', [], log);
    registry.register(ipam);
    registry.register(ipam);
    for (const name of ALL.slice(1)) registry.register(releaser(name, [], log));

    expect(() => registry.onApplicationBootstrap()).not.toThrow();
    await registry.releaseAllWithin({} as Tx, 'sa@pmh.com.vn', 'device-1');
    expect(log).toEqual(ALL);
  });

  it('holdings gộp mô tả của mọi module, giữ nguyên chữ để người trực đọc', async () => {
    const registry = new DeviceRetirementRegistry();
    registry.register(releaser('ipam', ['địa chỉ IP 172.16.10.5']));
    registry.register(releaser('software', ['ghế license OFF2021 — Office 2021']));
    registry.register(releaser('device-ports', ['cổng GI1/0/24 trên SW-01 đang đấu vào máy này']));
    registry.register(releaser('isp-line', ['đường truyền FTTH-01 (VNPT)']));

    await expect(registry.holdingsWithin({} as Tx, 'device-1')).resolves.toEqual([
      'địa chỉ IP 172.16.10.5',
      'ghế license OFF2021 — Office 2021',
      'cổng GI1/0/24 trên SW-01 đang đấu vào máy này',
      'đường truyền FTTH-01 (VNPT)',
    ]);
  });
});
