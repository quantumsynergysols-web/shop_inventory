import { useEffect, useState } from 'react';
import { download, get, patch, post } from '../api';
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
