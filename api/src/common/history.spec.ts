import { withActorNames } from './history';

describe('withActorNames — người làm hiện bằng họ tên, email để tra', () => {
  const lookup = (emails: string[]) => {
    lookups.push(emails);
    return Promise.resolve(new Map([['it01@pmh.com.vn', 'Lê Minh']]));
  };
  let lookups: string[][] = [];
  beforeEach(() => {
    lookups = [];
  });

  it('gắn họ tên theo email, không phân biệt hoa thường', async () => {
    const rows = await withActorNames(
      [
        { id: '1', actor: 'IT01@pmh.com.vn' },
        { id: '2', actor: 'nguoi-da-nghi@pmh.com.vn' },
      ],
      lookup,
    );
    expect(rows.map((row) => row.actorName)).toEqual(['Lê Minh', null]);
    // Giữ nguyên email: màn hình vẫn cần nó cho tooltip và cho dòng của tài khoản đã xoá.
    expect(rows[0].actor).toBe('IT01@pmh.com.vn');
  });

  it('hỏi MỘT lượt cho cả trang, mỗi email một lần', async () => {
    await withActorNames(
      [
        { id: '1', actor: 'it01@pmh.com.vn' },
        { id: '2', actor: 'it01@pmh.com.vn' },
        { id: '3', actor: 'x@pmh.com.vn' },
      ],
      lookup,
    );
    expect(lookups).toEqual([['it01@pmh.com.vn', 'x@pmh.com.vn']]);
  });

  it('danh sách rỗng thì không hỏi gì', async () => {
    expect(await withActorNames([], lookup)).toEqual([]);
    expect(lookups).toEqual([]);
  });
});
