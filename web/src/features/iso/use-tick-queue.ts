import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { ISO_KEY } from './iso-api';
import type { TickResult } from './iso-types';

/**
 * Ghi ô 0203 theo kiểu "đổi ngay, gửi sau": ô đổi ngay lúc bấm (`pending`), request chạy nền.
 *
 * Mỗi ô chỉ một request bay cùng lúc. Bấm tiếp trong lúc đó thì chỉ nhớ giá trị CUỐI và gửi khi
 * request trước xong — bấm nhanh ✓ → ✗ → trống không sinh ba request đua thứ tự, và kết quả trên
 * server luôn là thứ người dùng thấy sau cùng. Lỗi thì bỏ giá trị tạm (ô về theo server) và báo.
 */
export function useTickQueue(
  csrfToken: string,
  { onSaved, onError }: { onSaved: (lineId: string, day: string, result: TickResult | null) => void; onError: (err: unknown) => void },
) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlyMap<string, TickResult | null>>(() => new Map());
  /** Ô đang có request bay → giá trị chờ gửi tiếp (`undefined` = không có). */
  const inflight = useRef(new Map<string, TickResult | null | undefined>());

  const settle = (key: string, value: TickResult | null) =>
    setPending((m) => {
      if (!m.has(key) || m.get(key) !== value) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });

  const run = (lineId: string, day: string, value: TickResult | null): void => {
    const key = `${lineId}|${day}`;
    apiFetch('/api/v1/iso/backup/ticks', { method: 'PUT', csrfToken, body: JSON.stringify({ lineId, day, result: value }) })
      .then(async () => {
        const queued = inflight.current.get(key);
        if (queued !== undefined) {
          inflight.current.set(key, undefined);
          run(lineId, day, queued);
          return;
        }
        inflight.current.delete(key);
        await queryClient.invalidateQueries({ queryKey: ISO_KEY });
        settle(key, value);
        onSaved(lineId, day, value);
      })
      .catch((err: unknown) => {
        inflight.current.delete(key);
        setPending((m) => {
          const next = new Map(m);
          next.delete(key);
          return next;
        });
        void queryClient.invalidateQueries({ queryKey: ISO_KEY });
        onError(err);
      });
  };

  const set = (lineId: string, day: string, value: TickResult | null) => {
    const key = `${lineId}|${day}`;
    setPending((m) => new Map(m).set(key, value));
    if (inflight.current.has(key)) {
      inflight.current.set(key, value);
      return;
    }
    inflight.current.set(key, undefined);
    run(lineId, day, value);
  };

  return { pending, set };
}
