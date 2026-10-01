import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import type { IpRow } from './ipam-types';
import { IpForm } from './subnet-detail';

/** Hộp sửa hồ sơ IP: ghi chú là cột rõ, phải nhắc như form thiết bị / NAT (FR-035). */

const RECORD: IpRow = {
  id: 'ip-1',
  subnetId: 'sub-1',
  address: '10.77.1.5',
  deviceId: null,
  deviceCode: null,
  deviceName: null,
  deviceSiteCode: null,
  usedBy: 'Kho',
  assignedBy: 'e2e',
  assignedAt: '2026-01-02',
  status: 'assigned',
  note: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

describe('Hộp sửa hồ sơ IP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ô Ghi chú nhắc không ghi mật khẩu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, { departments: [] }))),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <IpForm record={RECORD} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(await screen.findByRole('textbox', { name: 'Ghi chú' })).toHaveAccessibleDescription(
      /Không ghi mật khẩu/,
    );
  });
});
