import { currentRequestIp, runWithRequestContext } from './request-context';

/**
 * Ngữ cảnh request "chảy theo" chuỗi async — đây là nền của việc `audit_log.ip` được điền
 * mà KHÔNG phải luồn tham số `ip` qua ~15 chữ ký hàm và 62 chỗ gọi audit.
 *
 * Vì sao phải có test riêng cho một thứ nhỏ như vậy: nếu `AsyncLocalStorage` mất ngữ cảnh
 * qua một `await` nào đó thì hậu quả là IM LẶNG — `audit_log.ip` lại về NULL và không ai
 * biết, đúng cách nó đã NULL suốt 9 epic (rà soát 07/09, #3). Bảng chỉ-thêm nên không vá
 * ngược được; mất là mất vĩnh viễn.
 */
describe('request-context', () => {
  it('ngoài mọi request → null, không ném', () => {
    expect(currentRequestIp()).toBeNull();
  });

  it('trong request → thấy IP của chính request đó', () => {
    const seen = runWithRequestContext({ ip: '10.0.0.7' }, () => currentRequestIp());
    expect(seen).toBe('10.0.0.7');
  });

  it('ngữ cảnh sống qua await, kể cả nhiều tầng', async () => {
    const seen = await runWithRequestContext({ ip: '10.0.0.8' }, async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      // Một tầng hàm nữa — mô phỏng controller → service → audit writer.
      const deeper = async () => {
        await Promise.resolve();
        return currentRequestIp();
      };
      return deeper();
    });
    expect(seen).toBe('10.0.0.8');
  });

  /**
   * Hai request song song KHÔNG được nhìn thấy IP của nhau. Đây là chế độ hỏng tệ nhất có
   * thể: nhật ký an ninh gán sai IP cho đúng người, và nó chỉ xảy ra khi có tải — tức không
   * bao giờ lộ ra lúc bấm tay.
   */
  it('hai request song song không lẫn IP của nhau', async () => {
    const slow = runWithRequestContext({ ip: '10.0.0.1' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentRequestIp();
    });
    const fast = runWithRequestContext({ ip: '10.0.0.2' }, () =>
      Promise.resolve(currentRequestIp()),
    );
    await expect(Promise.all([slow, fast])).resolves.toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('request không xác định được IP → null, không phải chuỗi rỗng', () => {
    expect(runWithRequestContext({ ip: null }, () => currentRequestIp())).toBeNull();
  });

  /** Thoát khỏi `run` là hết ngữ cảnh — không rò rỉ sang job nền chạy sau đó. */
  it('ra khỏi request thì ngữ cảnh biến mất', async () => {
    await runWithRequestContext({ ip: '10.0.0.9' }, () => Promise.resolve(currentRequestIp()));
    expect(currentRequestIp()).toBeNull();
  });
});
