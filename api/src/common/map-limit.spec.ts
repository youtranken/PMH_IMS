import { mapWithLimit } from './map-limit';

describe('mapWithLimit — chạy song song có trần', () => {
  it('giữ thứ tự kết quả theo thứ tự đầu vào', async () => {
    const out = await mapWithLimit([30, 10, 20, 0], 2, (ms, i) => new Promise<string>((r) => setTimeout(() => r(`${i}:${ms}`), ms)));
    expect(out).toEqual(['0:30', '1:10', '2:20', '3:0']);
  });

  it.each([
    [10, 4, 4],
    [3, 4, 3],
    [5, 1, 1],
  ])('%i việc, trần %i → chạy cùng lúc nhiều nhất %i', async (count, limit, peak) => {
    let running = 0;
    let max = 0;
    await mapWithLimit(Array.from({ length: count }, (_, i) => i), limit, async () => {
      running += 1;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    });
    expect(max).toBe(peak);
  });

  it('một việc lỗi → cả lượt lỗi (nơi gọi tự bắt lỗi từng việc nếu muốn bỏ qua)', async () => {
    await expect(mapWithLimit([1, 2], 2, (n) => (n === 2 ? Promise.reject(new Error('hỏng')) : Promise.resolve(n)))).rejects.toThrow('hỏng');
  });

  it('danh sách rỗng', async () => {
    await expect(mapWithLimit([], 4, () => Promise.resolve(1))).resolves.toEqual([]);
  });
});
