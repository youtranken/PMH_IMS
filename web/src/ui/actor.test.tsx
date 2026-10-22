import { describe, expect, it } from 'vitest';
import { Actor, actorLabel } from '@/ui/actor';
import { renderWithI18n, screen } from '@/test/test-utils';
import i18n from '@/lib/i18n';

/** TX-20 / PW-A13 / UX-E26: người thao tác hiện 4 kiểu — họ tên, tên đăng nhập, email, "system". */
describe('actorLabel', () => {
  const t = i18n.t.bind(i18n);
  it.each([
    ['system', null, 'Hệ thống', undefined],
    ['sa@pmh.com.vn', 'Super Admin', 'Super Admin', 'sa@pmh.com.vn'],
    ['cu@pmh.com.vn', null, 'cu@pmh.com.vn', undefined],
    ['cu@pmh.com.vn', '', 'cu@pmh.com.vn', undefined],
  ])('%s / %s → %s', (actor, name, text, title) => {
    expect(actorLabel(actor, name, t)).toEqual({ text, title });
  });
});

describe('Actor', () => {
  it('họ tên, email vào tooltip', () => {
    renderWithI18n(<Actor actor="sa@pmh.com.vn" actorName="Super Admin" />);
    expect(screen.getByText('Super Admin')).toHaveAttribute('title', 'sa@pmh.com.vn');
  });
});
