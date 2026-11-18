import { useEffect, useState } from 'react';
import { download, get, logout, patch, post } from '../api';
import { qty, rs } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, Nav, Sheet, Top, go, useApp, useLoad } from '../ui';

export function More() {
  const { t, lang, setLang } = useT();
  const { me, setMe } = useApp();
  const reports = me.role === 'OWNER' || me.role === 'ACCOUNTANT';
  const owner = me.role === 'OWNER';
  const today = new Date().toISOString().slice(0, 10);
  const toggleTheme = () => {
    const r = document.documentElement;
    const cur = r.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    r.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  };
  return (
    <>
      <Top title={t.more} />
      <main className="body">
        <div className="card">
          <div className="row"><Icon name="user" /><b className="grow">{me.name || t.roles[me.role]}</b><span className="tag t-new">{t.roles[me.role]}</span></div>
        </div>
        {reports && (
          <div className="card">
            <h2 className="h3">{t.reports}</h2>
            <div className="list">
              <a className="item" href="#/month"><span className="grow"><b>{t.month}</b></span><Icon name="chev" flip /></a>
              {[
                ['stock-ledger', t.stockLedger],
                ['stock-valuation', t.valuation],
                ['party-balances', t.partyBal],
                ['profit?by=product&', t.profitProduct],
                ['profit?by=category&', t.profitCategory],
              ].map(([k = '', label]) => {
                const path = k.includes('?') ? `/reports/${k}` : `/reports/${k}?`;
                const file = k.replace(/[?&=]+/g, '-').replace(/-$/, '');
                return (
                  <div key={k} className="item">
                    <span className="grow"><b>{label}</b></span>
                    <button className="link" onClick={() => download(`${path}format=xlsx`, `${file}-${today}.xlsx`)}>Excel</button>
                    <button className="link" onClick={() => download(`${path}format=csv`, `${file}-${today}.csv`)}>CSV</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {owner && <DataSafety />}
        <div className="card">
          <div className="list">
            {owner && <a className="item" href="#/users"><span className="grow"><b>{t.users}</b></span><Icon name="chev" flip /></a>}
            {owner && <a className="item" href="#/ai"><span className="grow"><b>{t.aiSettings}</b></span><Icon name="chev" flip /></a>}
            {owner && <a className="item" href="#/opening"><span className="grow"><b>{t.importOpening}</b></span><Icon name="chev" flip /></a>}
            {owner && <a className="item" href="#/settings"><span className="grow"><b>{t.settings}</b></span><Icon name="chev" flip /></a>}
            <div className="item">
              <span className="grow"><b>{t.language}</b></span>
              <div className="lang"><button className="u" aria-pressed={lang === 'ur'} onClick={() => setLang('ur')}>اردو</button><button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button></div>
            </div>
            <button className="item" onClick={toggleTheme}><span className="grow"><b>{t.theme}</b></span></button>
            <button className="item red" onClick={async () => { await logout(); setMe(null); go('/home'); }}><Icon name="out" /><b className="grow">{t.logout}</b></button>
          </div>
        </div>
      </main>
      <Nav current="more" />
    </>
  );
}

/** FR-SET-05: owner downloads everything; shows when the automatic backup last ran. */
function DataSafety() {
  const { t } = useT();
  const { toast } = useApp();
  const { data: b } = useLoad(() => get('/backup/status'), []);
  const [busy, setBusy] = useState(false);
  const when = (d: string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  async function exportAll() {
    setBusy(true);
    try {
      await download('/export', `shop-export-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 className="h3">{t.dataSafety}</h2>
      <button className="cta sec" disabled={busy} onClick={exportAll}><Icon name="sheet" /> {busy ? t.exporting : t.fullExport}</button>
      <div className="label">{t.exportHint}</div>
      {b && (
        <div className="label">
          {!b.enabled ? t.backupOff : b.lastError ? <span className="red">{t.backupFailed}</span> : b.lastAt ? <>{t.backupLast}: <bdi className="n">{when(b.lastAt)}</bdi></> : t.backupNone}
          {b.enabled && b.nextAt && <> · {t.backupNext}: <bdi className="n">{when(b.nextAt)}</bdi></>}
        </div>
      )}
    </div>
  );
}

/** FR-CLS-09/10 */
export function Month() {
  const { t } = useT();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data: m, error } = useLoad(() => get(`/day/month?month=${month}`), [month]);
  return (
    <>
      <Top title={t.month} backTo="/more" right={<input type="month" className="in" style={{ width: 150 }} value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <main className="body">
        {error && <ErrorBox error={error} />}
        {!m ? <Loading /> : (
          <>
            <div className="card">
              <div className="rw"><span>{t.sale} (<span className="n">{m.bills}</span> {t.bills})</span><span className="n">{rs(m.salePaisa)}</span></div>
              <div className="rw"><span>− {t.cogs}</span><span className="n">{rs(m.cogsPaisa)}</span></div>
              <div className="rw tot"><span>{t.gross}</span><span className="n">{rs(m.grossProfitPaisa)}</span></div>
              <div className="rw sub2"><span>{t.margin}</span><span className="n">{m.marginPct}%</span></div>
              {m.expensesByHead.map((e: any) => <div key={e.head} className="rw sub2"><span>− {e.head}</span><span className="n">{rs(e.totalPaisa)}</span></div>)}
              <div className="rw tot bigr"><span>{t.net}</span><span className={`n ${m.netProfitPaisa >= 0 ? 'green' : 'red'}`}>{rs(m.netProfitPaisa)}</span></div>
            </div>
            {[[t.bestSelling, m.bestSelling, 'qty'], [t.mostProfit, m.mostProfitable, 'profit']].map(([title, rows, k]: any) => (
              <div key={k} className="card">
                <h2 className="h3">{title}</h2>
                <table className="t"><tbody>{rows.map((r: any) => <tr key={r.productId}><td className="ltr">{r.name}</td><td className="n">{qty(r.qtyMilli)}</td><td className="n">{rs(k === 'qty' ? r.revenuePaisa : r.profitPaisa)}</td></tr>)}</tbody></table>
              </div>
            ))}
          </>
        )}
      </main>
    </>
  );
}

/** FR-AUTH-04 */
export function Users() {
  const { t } = useT();
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => get('/users'), []);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: 'SALESMAN', password: '' });
  async function add() {
    try {
      await post('/users', form);
      setAdding(false);
      setForm({ name: '', phone: '', role: 'SALESMAN', password: '' });
      reload();
      toast(t.saved);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function toggle(u: any) {
    try {
      await patch(`/users/${u.id}`, { active: !u.active });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function reset(u: any) {
    const pw = window.prompt(`${t.resetPw}: ${u.name}`);
    if (!pw) return;
    try {
      await post(`/users/${u.id}/reset-password`, { password: pw });
      toast(t.saved);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <>
      <Top title={t.users} backTo="/more" right={<button className="ib" aria-label={t.addUser} onClick={() => setAdding(true)}><Icon name="plus" /></button>} />
      <main className="body">
        {error && <ErrorBox error={error} />}
        <div className="card">
          <div className="list">
            {data?.map((u: any) => (
              <div key={u.id} className="item">
                <span className="grow"><b className="ltr">{u.name}</b><span className="sub">{t.roles[u.role]} · <span className="n">{u.phone}</span></span></span>
                <button className={`tag ${u.active ? 't-ok' : 't-bad'}`} onClick={() => toggle(u)}>{u.active ? t.active : t.disabled}</button>
                <button className="link" onClick={() => reset(u)}>{t.resetPw}</button>
              </div>
            ))}
          </div>
        </div>
      </main>
      {adding && (
        <Sheet onClose={() => setAdding(false)}>
          <b>{t.addUser}</b>
          <input className="in ltr" placeholder={t.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="in ltr" placeholder={t.phone} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div className="chips">{['SALESMAN', 'STOREKEEPER', 'ACCOUNTANT', 'OWNER'].map((r) => <button key={r} aria-pressed={form.role === r} onClick={() => setForm({ ...form, role: r })}>{t.roles[r]}</button>)}</div>
          <input className="in ltr" type="password" placeholder={`${t.password} (8+)`} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button className="cta" disabled={!form.name || form.phone.length < 7 || form.password.length < 8} onClick={add}>{t.save}</button>
        </Sheet>
      )}
    </>
  );
}

/** FR-SET-01/03 */
export function Settings() {
  const { t } = useT();
  const { toast } = useApp();
  const { data, error } = useLoad(() => get('/settings'), []);
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (data) setF({ ...data, ...data.defaults });
  }, [data]);
  if (error) return <><Top title={t.settings} backTo="/more" /><div className="body"><ErrorBox error={error} /></div></>;
  if (!f) return <Loading />;
  async function save() {
    try {
      await patch('/settings', {
        name: f.name,
        address: f.address || null,
        phone: f.phone || null,
        ntn: f.ntn || null,
        receiptFooter: f.receiptFooter || null,
        defaults: { markupPct: Number(f.markupPct), allowNegativeStock: !!f.allowNegativeStock, salesmanMayCloseDay: !!f.salesmanMayCloseDay },
      });
      toast(t.saved);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const text = (k: string, label: string) => <label className="f"><span>{label}</span><input className="in" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  const check = (k: string, label: string) => <label className="row"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> <span>{label}</span></label>;
  return (
    <>
      <Top title={t.settings} backTo="/more" />
      <main className="body">
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          {text('name', t.shopName)}
          {text('address', t.address)}
          {text('phone', t.phone)}
          {text('ntn', 'NTN')}
          {text('receiptFooter', t.footer)}
        </div>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <label className="f"><span>{t.markup}</span><input className="in num" inputMode="decimal" value={f.markupPct} onChange={(e) => setF({ ...f, markupPct: e.target.value })} /></label>
          {check('allowNegativeStock', t.negStock)}
          {check('salesmanMayCloseDay', t.salesmanClose)}
        </div>
        <button className="cta" onClick={save}>{t.save}</button>
      </main>
    </>
  );
}
