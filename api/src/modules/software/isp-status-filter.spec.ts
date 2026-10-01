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

  /* Q-20: tham số trạng thái lạ coi như bộ lọc mặc định — đường còn chạy, ẩn đường đã thanh lý.
     400 thì cả màn thành trang lỗi; bỏ qua thì lặng lẽ bày lại đường đã thanh lý. */
  it.each(['dead', 'active,dead', ',,x'])('chữ lạ %j → mặc định đang chạy + tạm ngưng', (text) => {
    expect(ispStatusesOf(text)).toEqual(['active', 'suspended']);
  });
});
