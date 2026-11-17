import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { blobUrl, type Me } from './api';
import { useT } from './i18n';

const P: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M8 7h7M8 11h5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M12 4v13M6 11l6 6 6-6"/><path d="M4 20h16"/>',
  up: '<path d="M12 20V7M6 13l6-6 6 6"/><path d="M4 4h16"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  wa: '<path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};

export function Icon({ name, flip }: { name: string; flip?: boolean }) {
  return <svg className={`i${flip ? ' flip' : ''}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] ?? '' }} />;
}

/* ---------- routing (hash based: works from any static host and inside the PWA) ---------- */
export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}
function parse(): Route {
  const h = location.hash.replace(/^#/, '') || '/home';
  const [path = '/home', qs = ''] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}
export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => {
      setR(parse());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const go = (path: string) => {
  location.hash = path;
};
export const back = () => (history.length > 1 ? history.back() : go('/home'));

/* ---------- app context ---------- */
export interface Ctx {
  me: Me;
  toast: (msg: string) => void;
  setMe: (m: Me | null) => void;
}
export const AppCtx = createContext<Ctx>(null as never);
export const useApp = () => useContext(AppCtx);

export function useToast(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return [msg, show];
}

/** Loads data and reloads when deps change; `reload` refetches. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: Error | null; loading: boolean; reload: () => void; set: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), set: setData };
}

/* ---------- pieces ---------- */
export function Top({ title, backTo, right }: { title: ReactNode; backTo?: string | true; right?: ReactNode }) {
  return (
    <header className="top">
      {backTo && (
        <button className="ib" aria-label="Back" onClick={() => (backTo === true ? back() : go(backTo))}>
          <Icon name="back" flip />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Nav({ current }: { current: string }) {
  const { t } = useT();
  const items: [string, string, string][] = [
    ['/home', 'home', t.nHome],
    ['/stock', 'box', t.nStock],
    ['/scan/new?type=SALE', 'scan', t.nScan],
    ['/ledger', 'book', t.nLedger],
    ['/more', 'more', t.nMore],
  ];
  return (
    <nav className="nav">
      {items.map(([href, icon, label]) => (
        <a key={href} href={'#' + href} aria-current={current === href.split('?')[0]!.split('/')[1] ? 'page' : undefined}>
          {icon === 'scan' ? <span className="dot"><Icon name="scan" /></span> : <Icon name={icon} />}
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grab" />
        {children}
      </div>
    </>
  );
}

export function Loading() {
  const { t } = useT();
  return (
    <div className="center" aria-busy="true">
      <div className="row muted">
        <div className="spin" /> {t.loading}
      </div>
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  const { t } = useT();
  return (
    <div className="banner bad" role="alert">
      {navigator.onLine ? error.message || t.error : t.offline} {retry && <button className="link" onClick={retry}>↻</button>}
    </div>
  );
}

/** Image that needs the auth token (bill photos). */
export function AuthImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    blobUrl(src).then((x) => setUrl((u = x))).catch(() => setUrl(null));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [src]);
  return url ? <img src={url} alt={alt} className={className} /> : <div className={className} style={{ minHeight: 120, background: 'var(--paper)' }} />;
}

export function PayModes({ value, onChange }: { value: string; onChange: (m: 'CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA') => void }) {
  const { t } = useT();
  const modes: ['CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA', string][] = [['CASH', t.cash], ['BANK', t.bank], ['JAZZCASH', t.jazz], ['EASYPAISA', t.easy]];
  return (
    <div className="chips" role="group">
      {modes.map(([m, l]) => (
        <button key={m} type="button" aria-pressed={value === m} onClick={() => onChange(m)}>
          {l}
        </button>
      ))}
    </div>
  );
}
