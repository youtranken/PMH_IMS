import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { PATHS } from '@/lib/routes';
import { Field } from '@/ui/page-header';
import { Popover } from '@/ui/popover';
import type { DiagramContent, FoundDevice } from './diagram-api';
import { matchOnDrawing, type DrawingMatch } from './diagram-navigation';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'here'; matches: DrawingMatch[] }
  | { kind: 'elsewhere'; q: string; found: FoundDevice[] }
  | { kind: 'error'; message: string };

/**
 * "Tìm thiết bị, bay tới" của trình xem: gõ mã / tên / IP. Có trên bản vẽ đang xem thì bay tới và
 * tô sáng ngay (một kết quả) hoặc cho chọn (nhiều kết quả); không có thì hỏi server máy đó nằm ở
 * bản vẽ chính thức nào — bấm mở bản vẽ kia với `?focus=` là bay tới đúng máy.
 */
export function DiagramSearch({ content, diagramId, onFly }: { content: DiagramContent; diagramId: string; onFly: (match: DrawingMatch) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const fly = (match: DrawingMatch) => {
    setOpen(false);
    onFly(match);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const q = term.trim();
    if (q.length < 2) {
      setOutcome({ kind: 'error', message: t('diagrams.nav.searchShort') });
      return;
    }
    const here = matchOnDrawing(content, q);
    if (here.length === 1) {
      setOutcome({ kind: 'idle' });
      fly(here[0]);
      return;
    }
    if (here.length > 1) {
      setOutcome({ kind: 'here', matches: here });
      return;
    }
    setBusy(true);
    try {
      const found = await apiFetch<FoundDevice[]>(`/api/v1/diagrams/find?${new URLSearchParams({ q }).toString()}`);
      setOutcome({ kind: 'elsewhere', q, found });
    } catch (error) {
      setOutcome({ kind: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  let result = null;
  if (outcome.kind === 'error') {
    result = (
      <p className="alert error" role="alert">
        {outcome.message}
      </p>
    );
  } else if (outcome.kind === 'here') {
    result = (
      <ul className="device-card-diagrams" aria-label={t('diagrams.nav.searchHere')}>
        {outcome.matches.map((match) => (
          <li key={match.deviceId}>
            <button type="button" className="linkbtn" onClick={() => fly(match)}>
              {match.name ? `${match.code} — ${match.name}` : match.code}
            </button>
          </li>
        ))}
      </ul>
    );
  } else if (outcome.kind === 'elsewhere') {
    const places = outcome.found.flatMap((device) =>
      device.diagrams.filter((d) => d.id !== diagramId).map((diagram) => ({ device, diagram })),
    );
    result =
      places.length > 0 ? (
        <>
          <p className="muted" role="status">
            {t('diagrams.nav.searchNotHere', { q: outcome.q })}
          </p>
          <ul className="device-card-diagrams" aria-label={t('diagrams.nav.searchElsewhere')}>
            {places.map(({ device, diagram }) => (
              <li key={`${device.id}-${diagram.id}`}>
                <Link to={`${PATHS.diagram(diagram.id)}?${new URLSearchParams({ focus: device.id }).toString()}`} onClick={() => setOpen(false)}>
                  {t('diagrams.nav.searchOpenIn', { code: device.code, diagram: diagram.name })}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted" role="status">
          {outcome.found.length > 0
            ? t('diagrams.nav.searchNotDrawn', { codes: outcome.found.map((d) => d.code).join(', ') })
            : t('diagrams.nav.searchNone', { q: outcome.q })}
        </p>
      );
  }

  return (
    <Popover label={t('diagrams.nav.search')} title={t('diagrams.nav.searchTitle')} open={open} onOpenChange={setOpen}>
      <div className="stock-picker">
      <form onSubmit={(event) => void submit(event)} className="stock-picker">
        <Field label={t('diagrams.nav.searchLabel')} htmlFor="diagram-nav-search">
          <input
            id="diagram-nav-search"
            className="inp"
            type="search"
            autoComplete="off"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </Field>
        <button type="submit" className="btn primary" disabled={busy}>
          {t('diagrams.nav.searchSubmit')}
        </button>
      </form>
      {result}
      </div>
    </Popover>
  );
}
