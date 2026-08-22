import { emptyPage, pageOffset, parsePageQuery } from './pagination';

describe('parsePageQuery', () => {
  it.each([
    [{}, { page: 1, limit: 50 }],
    [{ page: '3', limit: '20' }, { page: 3, limit: 20 }],
    [{ page: '0' }, { page: 1, limit: 50 }],
    [{ page: '-5' }, { page: 1, limit: 50 }],
    [{ page: 'abc' }, { page: 1, limit: 50 }],
    [{ limit: '9999' }, { page: 1, limit: 200 }],
    [{ limit: '0' }, { page: 1, limit: 1 }],
  ])('%j → %j', (input, expected) => {
    expect(parsePageQuery(input)).toEqual(expected);
  });

  it('offset tính từ trang 1', () => {
    expect(pageOffset({ page: 1, limit: 50 })).toBe(0);
    expect(pageOffset({ page: 3, limit: 20 })).toBe(40);
  });

  it('trang rỗng vẫn đúng shape', () => {
    expect(emptyPage()).toEqual({ items: [], total: 0 });
  });
});
