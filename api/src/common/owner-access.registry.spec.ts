import { OwnerAccessRegistry, type OwnerAccessChecker } from './owner-access.registry';

function checkerFor(...ownerTypes: string[]): OwnerAccessChecker {
  return { ownerTypes, assertCanSee: () => Promise.resolve() };
}

/**
 * Sổ này FAIL-OPEN theo thiết kế: loại chủ thể không ai đăng ký thì `assertCanRead` đi qua im
 * lặng. Với `subnet`/`nat_rule` đó là câu trả lời đúng — mặc-định-cấm của chúng nằm trong ma
 * trận quyền, không nằm ở sổ này.
 *
 * Nhưng với `service_account` và `isp` thì việc đăng ký là thứ DUY NHẤT đứng giữa Member và
 * đính kèm của những chủ thể đó (lỗ C1, vá 08/09). Và việc đăng ký xảy ra trong
 * `VaultApiService.onModuleInit` — một hàm rất dễ ngừng chạy vì lý do chẳng liên quan: đổi thứ
 * tự `imports`, tách module, đặt nhầm một `forwardRef`. Khi đó hệ thống khởi động bình thường,
 * request trả 200, và hàng rào biến mất mà không có gì đỏ.
 *
 * Nên hàng rào chuyển sang lúc BOOT: sai thì api không lên. Một api không chạy là sự cố nhìn
 * thấy ngay; một api chạy mà thiếu hàng rào thì không ai thấy cho tới khi có người đọc trộm.
 */
describe('OwnerAccessRegistry — thiếu người canh thì nổ lúc khởi động', () => {
  it('không ai đăng ký gì → ném, không phải khởi động im lặng', () => {
    expect(() => new OwnerAccessRegistry().onApplicationBootstrap()).toThrow(
      /service_account|isp/,
    );
  });

  it('chỉ đăng ký một nửa → vẫn ném, và nêu ĐÍCH DANH loại còn thiếu', () => {
    const registry = new OwnerAccessRegistry();
    registry.register(checkerFor('service_account'));
    expect(() => registry.onApplicationBootstrap()).toThrow(/isp/);
  });

  /**
   * VẾ ĐỐI CHỨNG. Không có nó thì một bản "luôn ném" cũng xanh cả hai bài trên — và api không
   * bao giờ khởi động được nữa, tức hàng rào bị gỡ ngay sáng hôm sau.
   */
  it('đăng ký đủ → khởi động bình thường', () => {
    const registry = new OwnerAccessRegistry();
    registry.register(checkerFor('service_account', 'isp'));
    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  /**
   * Loại NGOÀI danh sách bắt buộc vẫn đi qua im lặng — đó là thiết kế, không phải sơ suất, và
   * bài này khoá nó lại để không ai "siết cho chắc" rồi làm sập đường đọc đính kèm của thiết
   * bị/phần mềm.
   */
  it('loại chủ thể ngoài danh sách bắt buộc không bị đòi người canh', async () => {
    const registry = new OwnerAccessRegistry();
    registry.register(checkerFor('service_account', 'isp'));
    await expect(registry.assertCanRead('member@pmh.com.vn', 'device', 'x')).resolves.toBeUndefined();
  });

  it('có người canh và người đó từ chối → lỗi được ném lên, không bị nuốt', async () => {
    const registry = new OwnerAccessRegistry();
    registry.register({
      ownerTypes: ['service_account', 'isp'],
      assertCanSee: () => Promise.reject(new Error('KHONG DUOC XEM')),
    });
    await expect(
      registry.assertCanRead('member@pmh.com.vn', 'service_account', 'x'),
    ).rejects.toThrow('KHONG DUOC XEM');
  });
});
