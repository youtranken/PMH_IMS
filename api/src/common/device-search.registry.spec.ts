import { DeviceSearchRegistry, type DeviceSearchContributor } from './device-search.registry';

function contributor(name: string, ids: string[]): DeviceSearchContributor {
  return { name, deviceIdsMatching: () => Promise.resolve(ids) };
}

describe('DeviceSearchRegistry', () => {
  it('khởi động mà thiếu ipam thì ĐỎ — không để tìm theo IP im lặng ra 0 dòng', () => {
    const registry = new DeviceSearchRegistry();
    expect(() => registry.onApplicationBootstrap()).toThrow(/ipam/);
    registry.register(contributor('ipam', []));
    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  it('hợp id từ mọi module, không lặp', async () => {
    const registry = new DeviceSearchRegistry();
    registry.register(contributor('ipam', ['a', 'b']));
    registry.register(contributor('khac', ['b', 'c']));
    expect((await registry.deviceIdsMatching('10.0.0.1')).sort()).toEqual(['a', 'b', 'c']);
  });

  it('đăng ký hai lần cùng một lớp không nhân đôi', async () => {
    const registry = new DeviceSearchRegistry();
    const one = contributor('ipam', ['a']);
    registry.register(one);
    registry.register(one);
    expect(await registry.deviceIdsMatching('x')).toEqual(['a']);
  });
});
