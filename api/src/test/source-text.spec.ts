import { routesOf, stripComments, stripCommentsKeeping } from './source-text';

/**
 * CÔNG CỤ ĐỌC MÃ NGUỒN CỦA CÁC CỔNG TĨNH — và nó chưa từng có bài kiểm nào.
 *
 * Bốn bài canh cổng (`vault-surface`, `roles-surface`, `step-up-surface`, `ad2-raw-sql`) đều
 * đứng trên `source-text.ts`. Nó sai thì cả bốn xanh sai cùng lúc, và xanh sai ở đây trông y
 * hệt xanh đúng: repo sạch nên chẳng có gì để bắt.
 *
 * §18 tìm ra hai chỗ, và cả hai đều là "chú thích hứa một đằng, mã làm một nẻo".
 */

describe('stripComments — và lời hứa nó KHÔNG giữ được', () => {
  it('cắt được chú thích khối và chú thích dòng (vế đối chứng)', () => {
    expect(stripComments('a /* b */ c // d\ne')).toBe('a  c \ne');
  });

  /**
   * ĐÂY LÀ LỜI HỨA SAI (§18 #1).
   *
   * Docblock cũ viết: *"cắt nhầm chỉ có thể làm bài kiểm ĐỎ, không bao giờ làm nó xanh sai"*.
   * Câu ấy đúng với khẳng định KHẲNG ĐỊNH (`toContain`) và SAI với khẳng định PHỦ ĐỊNH
   * (`not.toContain`) — mà `vault-surface.spec.ts` có sáu khẳng định phủ định.
   *
   * Một chuỗi ký tự chứa `//` (một URL chẳng hạn) làm phần còn lại của DÒNG biến mất. Nếu
   * thứ biến mất theo là đúng cái mà `not.toContain` đang canh, bài xanh — và nó xanh vì mã
   * bị CẮT, không vì mã đúng.
   */
  it('chuỗi chứa `//` làm phần còn lại của dòng biến mất — đây là cái bẫy', () => {
    const source = `const url = 'https://pmh.com.vn'; @UseGuards(StepUpGuard)`;
    expect(stripComments(source)).not.toContain('@UseGuards(StepUpGuard)');
    // Đọc kỹ ca trên: một bài viết `expect(stripComments(src)).not.toContain('@UseGuards…')`
    // sẽ XANH ở đây, và nó đang canh đúng thứ vừa bị cắt mất.
  });

  describe('stripCommentsKeeping — bản có neo, dùng cho khẳng định PHỦ ĐỊNH', () => {
    it('neo còn nguyên thì trả về như thường', () => {
      const out = stripCommentsKeeping('class A { /* x */ b() {} }', 'class A', 'b()');
      expect(out).toContain('class A');
      expect(out).not.toContain('/* x */');
    });

    it('neo BIẾN MẤT thì NÉM, không trả về một chuỗi đã bị cắt cụt', () => {
      // Chính ca ở trên, nhưng nay không lọt được nữa: người viết khai rằng đoạn mã PHẢI còn
      // chứa `@UseGuards`, nên nếu phép cắt ăn mất nó thì bài ĐỎ kèm câu nói rõ lý do.
      const source = `const url = 'https://pmh.com.vn'; @UseGuards(StepUpGuard)`;
      expect(() => stripCommentsKeeping(source, '@UseGuards(StepUpGuard)')).toThrow(
        /neo|anchor/i,
      );
    });
  });
});

describe('routesOf — ranh giới khối decorator', () => {
  /** Một controller thu nhỏ, viết đúng hình dạng thật. */
  const oneLine = `
export class VaultController {
  @Roles('sa', 'admin')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('secrets')
  list() {}
}
`;

  it('decorator viết MỘT dòng → gom đủ `@Roles` (vế đối chứng)', () => {
    const routes = routesOf(oneLine);
    expect(routes).toHaveLength(1);
    expect(routes[0].decorators).toContain('@Roles');
  });

  /**
   * MÌN CHỜ LƯỢT `prettier` ĐẦU TIÊN (§18 #10).
   *
   * `routesOf` lấy `prev.endsWith('{')` làm ranh giới khối, với lập luận ghi tại chỗ:
   * *"Decorator không bao giờ kết thúc bằng `}` (chúng đóng bằng `)`), nên không cắt nhầm"*.
   * Lập luận ấy nói về `}` và bỏ quên `{` — mà `@Throttle({` kết thúc đúng bằng `{`.
   *
   * Nên một decorator viết xuống dòng cắt cụt khối, và `@Roles` ở phía trên biến mất khỏi
   * tầm nhìn. Cổng AD-9 sẽ báo một route ĐÃ khai `@Roles` là THIẾU — tức đỏ oan, và người ta
   * sẽ đi "sửa" một route không hỏng.
   *
   * Hôm nay chưa nổ vì cả bốn chỗ `@Throttle` trong repo đều viết một dòng. Lượt định dạng
   * đầu tiên bẻ chúng xuống dòng là nổ.
   */
  it('decorator viết NHIỀU dòng → vẫn phải gom đủ `@Roles`', () => {
    const multiLine = `
export class VaultController {
  @Roles('sa', 'admin')
  @Throttle({
    default: { limit: 30, ttl: 60_000 },
  })
  @Get('secrets')
  list() {}
}
`;
    const routes = routesOf(multiLine);
    expect(routes).toHaveLength(1);
    expect(routes[0].decorators).toContain('@Roles');
  });

  it('route TRƯỚC đó không lẫn sang route sau', () => {
    // Vế đối chứng cho bản vá: nới ranh giới quá tay thì hai route dính vào nhau, và một
    // route THIẾU `@Roles` sẽ xanh nhờ `@Roles` của route đứng trên. Sai theo hướng nguy hiểm.
    const two = `
export class C {
  @Roles('sa')
  @Get('a')
  a() {}

  @Get('b')
  b() {}
}
`;
    const routes = routesOf(two);
    expect(routes).toHaveLength(2);
    expect(routes[1].decorators).not.toContain('@Roles');
  });
});
