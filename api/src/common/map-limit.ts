/**
 * `fn` cho từng phần tử, chạy song song nhiều nhất `limit` việc một lúc; kết quả đúng thứ tự đầu
 * vào. Dùng khi mỗi việc tốn I/O hay CPU đáng kể (đọc tệp + thu nhỏ ảnh): tuần tự thì chậm theo số
 * phần tử, `Promise.all` thì một bản vẽ trăm máy giành hết threadpool của libuv và bộ nhớ cùng lúc.
 */
export async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
