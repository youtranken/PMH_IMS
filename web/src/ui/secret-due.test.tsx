import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { SecretDue, SecretDueSub, secretDueInfo } from '@/ui/secret-due';

/**
 * Q-15 — hạn đổi mật khẩu trong két: "còn N ngày" rồi "Quá N ngày — cần đổi".
 *
 * Số ngày do server tính (`dueInDays`, âm = đã quá) — client chỉ chọn chữ và tông. Ngày đúng
 * hạn (0) là ngày server đã bật `valueStale`, nên nó phải đã là "cần đổi", không phải "còn 0".
 */
describe('secretDueInfo', () => {
  it.each([
    [180, 'vault.dueLeft', 180, 'muted'],
    [1, 'vault.dueLeft', 1, 'muted'],
    [0, 'vault.dueToday', 0, 'warn'],
    [-1, 'vault.dueOver', 1, 'warn'],
    [-220, 'vault.dueOver', 220, 'warn'],
  ])('%i ngày → %s (%i), tông %s', (dueInDays, key, count, tone) => {
    expect(secretDueInfo(dueInDays)).toEqual({ key, count, tone });
  });
});

describe('SecretDue', () => {
  it('còn hạn: ngày đổi + "còn N ngày", không phải nhãn cảnh báo', () => {
    renderWithI18n(<SecretDue changedAt="2026-09-01T03:00:00.000Z" dueInDays={152} />);
    expect(screen.getByText('01/09/2026')).toBeInTheDocument();
    expect(screen.getByText('còn 152 ngày')).toBeInTheDocument();
  });

  it('quá hạn: "Quá N ngày — cần đổi" là nhãn cảnh báo', () => {
    renderWithI18n(<SecretDue changedAt="2026-01-01T03:00:00.000Z" dueInDays={-90} />);
    expect(screen.getByText('Quá 90 ngày — cần đổi')).toHaveClass('badge', 'warn');
  });

  it('thiếu dữ liệu (API cũ): chỉ gạch ngang, không bịa hạn', () => {
    renderWithI18n(<SecretDue changedAt={undefined} dueInDays={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

/* TB-18: dòng phụ "Két đổi lần cuối …" dưới mã làm dòng cao 78px (thường 51px) → chip nhỏ cùng
   dòng với mã, đủ câu ở `title`; chỉ tô cảnh báo khi tới / quá hạn đổi. */
describe('SecretDueSub — chip cạnh mã', () => {
  it('còn hạn: chip "Két" trung tính, title đủ câu, không phải dòng phụ', () => {
    renderWithI18n(<SecretDueSub entry={{ valueChangedAt: '2026-09-01', dueInDays: 30 }} />);
    const chip = screen.getByText('Két');
    expect(chip).toHaveClass('badge');
    expect(chip).not.toHaveClass('warn');
    expect(chip).not.toHaveClass('cell-sub');
    expect(chip).toHaveAttribute('title', 'Két đổi lần cuối 01/09/2026 · còn 30 ngày');
  });
  it('quá hạn: chip cảnh báo nói số ngày', () => {
    renderWithI18n(<SecretDueSub entry={{ valueChangedAt: '2026-01-01', dueInDays: -5 }} />);
    const chip = screen.getByText('Két · quá 5 ngày');
    expect(chip).toHaveClass('warn');
  });
  it('đến hạn hôm nay: "Két · đổi hôm nay", không phải "quá 0 ngày"', () => {
    renderWithI18n(<SecretDueSub entry={{ valueChangedAt: '2026-01-01', dueInDays: 0 }} />);
    expect(screen.getByText('Két · đổi hôm nay')).toHaveClass('warn');
  });
});
