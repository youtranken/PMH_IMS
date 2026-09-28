import { ispStatusesOf } from './isp-line.service';

describe('ispStatusesOf — lọc nhiều trạng thái một lượt', () => {
  it.each<[string | undefined, string[]]>([
    [undefined, []],
    ['', []],
    ['active', ['active']],
    // Mặc định của màn danh sách: đường còn chạy, bỏ đường đã thanh lý.
    ['active,suspended', ['active', 'suspended']],
    [' active , terminated ', ['active', 'terminated']],
    ['active,active', ['active']],
  ])('%s → %j', (text, expected) => {
    expect(ispStatusesOf(text)).toEqual(expected);
  });

  it('chữ lạ bị từ chối thay vì lặng lẽ bỏ qua (lọc sai trông y như lọc đúng)', () => {
    expect(() => ispStatusesOf('active,dead')).toThrow();
  });
});
