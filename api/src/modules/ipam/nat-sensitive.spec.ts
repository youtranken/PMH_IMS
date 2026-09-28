import { sensitivePortsOf } from './nat-sensitive';

describe('sensitivePortsOf — đọc danh sách cổng nhạy cảm từ system_config', () => {
  it.each<[string, number[]]>([
    ['21,22,3389', [21, 22, 3389]],
    [' 22 , 3389 ,', [22, 3389]],
    ['3389,22,3389', [22, 3389]],
    ['', []],
  ])('%j → %j', (text, expected) => {
    expect(sensitivePortsOf(text)).toEqual(expected);
  });

  it('mục hỏng bị bỏ qua, không kéo cả danh sách thành rỗng', () => {
    expect(sensitivePortsOf('22,abc,70000,0,3389')).toEqual([22, 3389]);
  });
});
