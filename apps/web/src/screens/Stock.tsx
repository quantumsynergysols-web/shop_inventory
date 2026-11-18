import { useEffect, useState } from 'react';
import { download, get, newKey, patch, post, uploadFile } from '../api';
import { date, milliInput, paisaInput, qty, rs, toMilli, toPaisa } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, Nav, Top, go, useApp, useLoad } from '../ui';

/** FR-PRD-02: search by name, alias or SKU (typo tolerant), low-stock filter. */
export function StockList({ lowOnly }: { lowOnly: boolean }) {
  const { t } = useT();
  const { me } = useApp();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(h);
  }, [q]);
  const { data, error, reload } = useLoad(() => get(`/products?limit=200${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}${lowOnly ? '&lowStock=1' : ''}`), [debounced, lowOnly]);
  const canExport = me.role === 'OWNER' || me.role === 'ACCOUNTANT';
  return (
    <>
      <Top
        title={t.stock}
        right={canExport ? <button className="ib" aria-label="Excel" onClick={() => download('/reports/stock-valuation?format=xlsx', 'stock-valuation.xlsx')}><Icon name="sheet" /></button> : undefined}
      />
      <main className="body">
        <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} /></label>
        <div className="chips">
          <button aria-pressed={!lowOnly} onClick={() => go('/stock')}>{t.tabAll}</button>
          <button aria-pressed={lowOnly} onClick={() => go('/stock?low=1')}>{t.lowOnly}</button>
          {me.role === 'OWNER' && <button onClick={() => go('/stock/new')}><Icon name="plus" /> {t.newProduct}</button>}
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        <div className="card">
          <div className="list">
            {!data && <div className="label">{t.loading}…</div>}
            {data?.length === 0 && <div className="label">—</div>}
            {data?.map((p: any) => (
              <a key={p.id} className="item" href={`#/stock/${p.id}`}>
                <span className="grow">
                  <b className="ltr">{p.name}</b>
                  <span className="sub n">{p.sku}{p.category ? ` · ${p.category}` : ''}</span>
                  {p.aliases[0] && <span className="alias ltr" style={{ display: 'block' }}>“{p.aliases[0]}”</span>}
                </span>
                <span className={`qty ${p.lowStock ? 'red' : ''}`}>{qty(p.onHandMilli)}<span className="sub" style={{ display: 'block' }}>{t.min} <span className="n">{qty(p.minLevelMilli)}</span></span></span>
              </a>
            ))}
          </div>
        </div>
      </main>
      <Nav current="stock" />
    </>
  );
}

/** FR-PRD-01/03/04: details, price history; owner edits prices (price changes go to history). */
export function ProductView({ id }: { id: string }) {
  const { t } = useT();
  const { me, toast } = useApp();
  const isNew = id === 'new';
  const { data, error, reload } = useLoad(() => (isNew ? Promise.resolve<[any, any]>([null, []]) : Promise.all([get(`/products/${id}`), get(`/products/${id}/price-history`)])), [id]);
  const cats = useLoad(() => get('/categories'), []);
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (!data) return;
    const p = data[0];
    setForm({ name: p?.name ?? '', categoryId: p?.categoryId ?? '', baseUnit: p?.baseUnit ?? 'pcs', purchase: paisaInput(p?.purchasePricePaisa), sale: paisaInput(p?.salePricePaisa), min: milliInput(p?.minLevelMilli), aliases: (p?.aliases ?? []).join(', ') });
  }, [data]);
  if (error) return <><Top title={t.product} backTo="/stock" /><div className="body"><ErrorBox error={error} /></div></>;
  if (!data || !form) return <Loading />;
  const [p, history] = data;
  const owner = me.role === 'OWNER';

  async function save() {
    const body = {
      name: form.name,
      categoryId: form.categoryId || null,
      purchasePricePaisa: toPaisa(form.purchase) ?? undefined,
      salePricePaisa: toPaisa(form.sale) ?? undefined,
      minLevel: toMilli(form.min) != null ? toMilli(form.min)! / 1000 : undefined,
      ...(isNew ? { baseUnit: form.baseUnit, aliases: form.aliases.split(',').map((s: string) => s.trim()).filter(Boolean) } : {}),
    };
    try {
      const r = isNew ? await post('/products', body) : await patch(`/products/${id}`, body);
      toast(t.saved);
      if (isNew) go(`/stock/${r.id}`);
      else reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <Top title={isNew ? t.newProduct : <span className="ltr">{p.name}</span>} backTo="/stock" />
      <main className="body">
        {p && (
          <div className="card">
            <div className="two" style={{ marginTop: 0 }}>
              <div><span className="label">{t.onHand}</span><b className={`n ${p.lowStock ? 'red' : ''}`}>{qty(p.onHandMilli)} {p.baseUnit}</b></div>
              <div><span className="label">{t.avgCost}</span><b className="n">{rs(p.avgCostPaisa)}</b></div>
            </div>
            <div className="label n" style={{ marginTop: 8 }}>{p.sku}</div>
            {p.aliases.length > 0 && <div style={{ marginTop: 6 }}>{p.aliases.map((a: string) => <span key={a} className="alias ltr" style={{ marginInlineEnd: 10 }}>“{a}”</span>)}</div>}
          </div>
        )}
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <label className="f"><span>{t.name}</span><input className="in ltr" value={form.name} onChange={set('name')} disabled={!owner} /></label>
          <label className="f">
            <span>{t.category}</span>
            <select className="in" value={form.categoryId} onChange={set('categoryId')} disabled={!owner}>
              <option value="">—</option>
              {(cats.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="fields">
            <label className="f"><span>{t.purchasePrice}</span><input className="in num" inputMode="decimal" value={form.purchase} onChange={set('purchase')} disabled={!owner} /></label>
            <label className="f"><span>{t.salePrice}</span><input className="in num" inputMode="decimal" value={form.sale} onChange={set('sale')} disabled={!owner} /></label>
            <label className="f"><span>{t.minLevel}</span><input className="in num" inputMode="decimal" value={form.min} onChange={set('min')} disabled={!owner} /></label>
            {isNew && <label className="f"><span>{t.unit}</span><select className="in" value={form.baseUnit} onChange={set('baseUnit')}>{['pcs', 'box', 'dozen', 'metre', 'foot', 'kg', 'set', 'roll', 'packet'].map((u) => <option key={u}>{u}</option>)}</select></label>}
            {isNew && <label className="f full"><span>{t.aliases}</span><input className="in ltr" value={form.aliases} onChange={set('aliases')} /></label>}
          </div>
          {owner && <button className="cta" disabled={!form.name.trim()} onClick={save}>{t.save}</button>}
        </div>
        {p && owner && <AdjustCard p={p} onDone={reload} />}
        {history.length > 0 && (
          <div className="card">
            <h2 className="h3">{t.history}</h2>
            <table className="t">
              <tbody>
                {history.map((h: any, i: number) => (
                  <tr key={i}><td>{h.type === 'SALE' ? t.salePrice : t.purchasePrice}</td><td className="n">{rs(h.oldPricePaisa)} → {rs(h.newPricePaisa)}</td><td className="n muted">{date(h.at)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

/** FR-STK-07: owner types the counted stock and a reason; the difference posts as an adjustment. */
function AdjustCard({ p, onDone }: { p: any; onDone: () => void }) {
  const { t } = useT();
  const { toast } = useApp();
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const m = toMilli(counted);
  const diff = m == null ? null : m - p.onHandMilli;
  async function save() {
    setBusy(true);
    try {
      await post('/adjustments', { reason, lines: [{ productId: p.id, countedMilli: m }] }, { 'idempotency-key': newKey() });
      toast(t.adjustDone);
      setCounted('');
      setReason('');
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 className="h3">{t.adjust}</h2>
      <div className="fields">
        <label className="f"><span>{t.countedQty} ({p.baseUnit})</span><input className="in num" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={qty(p.onHandMilli)} /></label>
        <div className="f"><span>{t.change}</span><b className={`n ${diff != null && diff < 0 ? 'red' : diff ? 'green' : ''}`}>{diff == null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${qty(Math.abs(diff))}`}</b></div>
      </div>
      <input className="in" placeholder={t.adjustReason} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="cta sec" disabled={busy || !diff || reason.trim().length < 3} onClick={save}>{t.adjustSave}</button>
    </div>
  );
}

/** FR-STK-08: owner uploads CSV/Excel, sees every row checked, and imports only when all rows are fine. */
export function OpeningImport() {
  const { t } = useT();
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function check(f: File) {
    setBusy(true);
    setPreview(null);
    try {
      setPreview(await uploadFile('/opening-stock?dryRun=1', 'file', f));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function doImport() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadFile('/opening-stock', 'file', file);
      toast(t.importDone);
      go(r.document ? `/doc/${r.document.id}` : '/stock');
    } catch (e: any) {
      if (e.body?.preview) setPreview(e.body.preview);
      toast(e.message);
      setBusy(false);
    }
  }
  return (
    <>
      <Top title={t.importOpening} backTo="/more" />
      <main className="body">
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="label">{t.importHint}</div>
          <button className="link" onClick={() => download('/opening-stock/template.csv', 'opening-stock-template.csv')}>{t.template}</button>
          <label className="cta sec" style={{ cursor: 'pointer' }}>
            <Icon name="sheet" /> {file ? <span className="ltr">{file.name}</span> : t.chooseFile}
            <input
              type="file"
              hidden
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) check(f);
                e.target.value = ''; // so choosing the corrected file with the same name works again
              }}
            />
          </label>
          {busy && <div className="row muted"><div className="spin" /> {t.loading}</div>}
        </div>
        {preview && (
          <>
            <div className="card">
              <div className="rw"><span>{t.rowsOk}</span><span className="n green">{preview.okRows}</span></div>
              <div className="rw"><span>{t.rowsBad}</span><span className={`n ${preview.errorRows ? 'red' : ''}`}>{preview.errorRows}</span></div>
              <div className="rw"><span>{t.newProducts}</span><span className="n">{preview.newProducts}</span></div>
              <div className="rw tot"><span>{t.value}</span><span className="n">{rs(preview.stockValuePaisa)}</span></div>
            </div>
            {preview.errorRows > 0 && <div className="banner bad">{t.fixAndRetry}</div>}
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="t ltr">
                <thead><tr><th>{t.row}</th><th>{t.name}</th><th>{t.qty}</th><th>{t.purchasePrice}</th><th></th></tr></thead>
                <tbody>
                  {preview.rows.map((r: any) => (
                    <tr key={r.row}>
                      <td className="n">{r.row}</td>
                      <td>{r.name}{r.errors.length > 0 && <div className="red" style={{ fontSize: 13 }}>{r.errors.join('; ')}</div>}</td>
                      <td className="n">{qty(r.qtyMilli)} {r.unit}</td>
                      <td className="n">{rs(r.costPaisa)}</td>
                      <td>{r.errors.length ? <span className="tag t-bad">✕</span> : <span className={`tag ${r.status === 'new' ? 't-new' : 't-ok'}`}>{r.status === 'new' ? t.newP : t.match}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="cta" disabled={busy || preview.errorRows > 0 || !preview.rows.length} onClick={doImport}>{t.importNow}</button>
          </>
        )}
      </main>
    </>
  );
}
