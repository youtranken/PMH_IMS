import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogLists } from '@/lib/catalog-types';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { CatalogSetup } from './catalog-setup';

afterEach(() => vi.unstubAllGlobals());

function stubModels(ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(ok ? jsonResponse(200, { items: [], total: 0 }) : jsonResponse(500, { message: 'x' }))),
  );
}

const tile = (name: RegExp) => screen.getByRole('button', { name });

describe('CatalogSetup — thẻ "Khai trước khi thêm thiết bị"', () => {
  it('đang tải: "…" chứ không báo "chưa có"', () => {
    stubModels();
    renderWithI18n(<CatalogSetup lists={undefined} onPick={() => undefined} />);
    expect(tile(/^Site/)).toHaveTextContent('…');
    expect(tile(/^Site/)).toHaveAttribute('data-ok', 'true');
  });

  it('danh mục tải lỗi: nói "không tải được", không để "…" mãi', () => {
    stubModels();
    renderWithI18n(<CatalogSetup lists={undefined} failed onPick={() => undefined} />);
    expect(tile(/^Site/)).toHaveTextContent('không tải được');
    expect(tile(/^Site/)).toHaveAttribute('data-ok', 'false');
  });

  it('đã có câu trả lời mà thiếu một danh sách: là "chưa có", không phải "…"', () => {
    stubModels();
    const lists = { sites: [], cabinets: [], deviceTypes: [], vendors: [] } as unknown as CatalogLists;
    renderWithI18n(<CatalogSetup lists={lists} onPick={() => undefined} />);
    expect(tile(/^Phòng ban/)).toHaveTextContent('chưa có');
  });

  it('model tải lỗi: ô Model nói "không tải được"', async () => {
    stubModels(false);
    renderWithI18n(<CatalogSetup lists={undefined} onPick={() => undefined} />);
    expect(await screen.findByRole('button', { name: /^Model thiết bị.*không tải được/ })).toBeInTheDocument();
  });
});
