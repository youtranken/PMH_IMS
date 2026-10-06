import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramNode, VersionItem } from './diagram-api';
import { useVersionActions } from './diagram-versions-dialog';

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const NODE = { id: 'g1', name: 'Tầng 3 E2E' } as unknown as DiagramNode;
const V1: VersionItem = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'sa@e2e.local', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };

function Harness({ onRestored }: { onRestored: () => void }) {
  const actions = useVersionActions({ me: SA, diagram: NODE, run: (fn) => fn(), onRestored });
  return (
    <button type="button" onClick={() => void actions.restore(V1)}>
      Khôi phục thử
    </button>
  );
}

function setup(response: VersionItem) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(200, response))),
  );
  const onRestored = vi.fn();
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <Harness onRestored={onRestored} />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return onRestored;
}

async function restore() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Khôi phục thử' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Khôi phục' }));
}

describe('Khôi phục phiên bản (Q-23)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bản chọn trùng bản mới nhất: báo không tạo phiên bản mới, không nạp lại trình vẽ', async () => {
    const onRestored = setup({ ...V1, id: 'v3', seq: 3, unchanged: true });
    await restore();
    expect(await screen.findByText('Bản này trùng bản mới nhất — không tạo phiên bản mới.')).toBeInTheDocument();
    expect(screen.queryByText(/Đã khôi phục thành phiên bản/)).not.toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('khôi phục thật: báo số phiên bản mới và nạp lại', async () => {
    const onRestored = setup({ ...V1, id: 'v4', seq: 4 });
    await restore();
    expect(await screen.findByText('Đã khôi phục thành phiên bản #4.')).toBeInTheDocument();
    expect(onRestored).toHaveBeenCalled();
  });
});
