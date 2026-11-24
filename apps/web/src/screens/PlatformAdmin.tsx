import { useCallback, useEffect, useState } from 'react';
import '../auth.css';

interface ShopRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PENDING' | 'REJECTED';
  createdAt: string;
  owner: { name: string; phone: string | null } | null;
  signup: { city?: string | null; note?: string | null } | null;
  monthlyScanQuota: number | null;
  defaultQuota: number;
  documents: number;
}

const KEY = 'erp.adminKey';
const readKey = () => {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * QSSols admin page (#/qssols-admin, not linked from the app): approve or reject online sign-ups and
 * set each shop's AI scan limit. Opens with the server's PLATFORM_ADMIN_KEY, kept for this tab only.
 */
export function PlatformAdmin() {
  const [key, setKey] = useState(readKey);
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<ShopRow[] | null>(null);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(
    async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`/api/admin${path}`, { method, headers: { 'x-admin-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401) {
        setKey('');
        try {
          sessionStorage.removeItem(KEY);
        } catch {
          /* ignore */
        }
        throw new Error('Wrong admin key');
      }
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
    [key],
  );

  const load = useCallback(() => {
    if (!key) return;
    call('GET', '/shops').then(setRows, (e) => setMsg((e as Error).message));
  }, [key, call]);
  useEffect(load, [load]);

  async function act(id: string, what: 'approve' | 'reject') {
    setBusy(id);
    try {
      await call('POST', `/shops/${id}/${what}`);
      setMsg(what === 'approve' ? 'Approved: the owner can log in now.' : 'Rejected.');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function quota(id: string, value: string) {
    const n = value.trim() === '' ? null : Number(value);
    if (n !== null && (!Number.isInteger(n) || n < 0)) return setMsg('Enter a whole number, or leave it empty for the default.');
    try {
      await call('PATCH', `/shops/${id}/quota`, { monthlyScanQuota: n });
      setMsg('Scan limit saved.');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  if (!key)
    return (
      <div className="auth" dir="ltr" lang="en">
        <div className="auth-bg" aria-hidden="true"><i className="b1" /><i className="b2" /></div>
        <main className="auth-main" style={{ maxWidth: 520 }}>
          <form
            className="auth-card"
            onSubmit={(e) => {
              e.preventDefault();
              const k = input.trim();
              if (!k) return;
              try {
                sessionStorage.setItem(KEY, k);
              } catch {
                /* tab only */
              }
              setMsg(null);
              setKey(k);
            }}
          >
            <h2>QSSols admin</h2>
            <p className="auth-muted">Approve new shop sign-ups and set AI scan limits.</p>
            <label className="auth-field">
              <span>Admin key</span>
              <div className="auth-input"><input type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} autoFocus /></div>
            </label>
            {msg && <div className="auth-err" role="alert">{msg}</div>}
            <button className="auth-cta">Open</button>
          </form>
        </main>
      </div>
    );

  const shown = (rows ?? []).filter((r) => filter === 'ALL' || r.status === 'PENDING');
  const pending = (rows ?? []).filter((r) => r.status === 'PENDING').length;
  return (
    <div className="admin" dir="ltr" lang="en">
      <header className="admin-top">
        <h1>QSSols admin</h1>
        <div className="chips">
          <button aria-pressed={filter === 'PENDING'} onClick={() => setFilter('PENDING')}>Waiting ({pending})</button>
          <button aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>All shops ({rows?.length ?? 0})</button>
          <button onClick={load}>Refresh</button>
          <button onClick={() => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } setKey(''); }}>Lock</button>
        </div>
      </header>
      {msg && <div className="banner info" role="status">{msg}</div>}
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">{filter === 'PENDING' ? 'No sign-ups waiting.' : 'No shops yet.'}</p>
      ) : (
        <div className="admin-list">
          {shown.map((r) => (
            <article key={r.id} className="card admin-row">
              <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                  <b>{r.name}</b>
                  <span className={`tag ${r.status === 'ACTIVE' ? 't-ok' : r.status === 'PENDING' ? 't-warn' : 't-bad'}`}>{r.status === 'ACTIVE' ? 'Active' : r.status === 'PENDING' ? 'Waiting' : 'Rejected'}</span>
                </div>
                <div className="sub">
                  {r.owner?.name} · <span className="n">{r.owner?.phone}</span>
                  {r.signup?.city ? ` · ${r.signup.city}` : ''} · signed up {new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {r.documents} bills
                </div>
                <label className="admin-quota">
                  AI scans / month
                  <input className="in num" defaultValue={r.monthlyScanQuota ?? ''} placeholder={`default ${r.defaultQuota}`} onBlur={(e) => e.target.value !== String(r.monthlyScanQuota ?? '') && quota(r.id, e.target.value)} />
                </label>
              </div>
              <div className="admin-actions">
                {r.status !== 'ACTIVE' && <button className="cta" disabled={busy === r.id} onClick={() => act(r.id, 'approve')}>Approve</button>}
                {r.status === 'PENDING' && <button className="cta sec" disabled={busy === r.id} onClick={() => act(r.id, 'reject')}>Reject</button>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
