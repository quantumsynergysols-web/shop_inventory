import { useEffect, useState } from 'react';
import { get, post } from '../api';
import { milliInput, paisaInput, qty, rs, toMilli, toPaisa } from '../format';
import { useT } from '../i18n';
import { Icon, Sheet, useApp } from '../ui';

export interface ProductLite {
  id: string;
  name: string;
  sku?: string;
  baseUnit: string;
  onHandMilli: number;
  salePricePaisa: number;
  purchasePricePaisa: number;
}

export interface EditLine {
  id?: string;
  serialNo?: number | null;
  page?: number;
  rawName: string;
  qtyMilli: number | null;
  unit: string | null;
  ratePaisa: number | null;
  product: ProductLite | null;
  suggestions?: { productId: string; name: string; score: number }[];
  flags?: string[];
}

const UNITS = ['pcs', 'box', 'dozen', 'metre', 'foot', 'kg', 'set', 'roll', 'packet'];

/**
 * Edit one row (FR-REV-02): written text, product (suggestions, search, or create new: FR-REV-10/15),
 * quantity, unit, rate. Used by scan review and by manual entry (FR-STK-09).
 */
export function LineSheet({ line, kind, written, onSave, onRemove, onClose }: { line: EditLine; kind: 'SALE' | 'PURCHASE'; written: boolean; onSave: (l: EditLine) => void; onRemove?: () => void; onClose: () => void }) {
  const { t } = useT();
  const { me, toast } = useApp();
  const [raw, setRaw] = useState(line.rawName);
  const [q, setQ] = useState(milliInput(line.qtyMilli));
  const [unit, setUnit] = useState(line.unit ?? '');
  const [rate, setRate] = useState(paisaInput(line.ratePaisa));
  const [product, setProduct] = useState<ProductLite | null>(line.product);
  const [search, setSearch] = useState(line.product ? '' : line.rawName);
  const [results, setResults] = useState<ProductLite[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(line.rawName);
  const [newSale, setNewSale] = useState('');
  const [newBuy, setNewBuy] = useState(kind === 'PURCHASE' ? paisaInput(line.ratePaisa) : '');

  useEffect(() => {
    if (product || !search.trim()) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => get<ProductLite[]>(`/products?limit=8&q=${encodeURIComponent(search)}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(h);
  }, [search, product]);

  const qtyMilli = toMilli(q);
  const ratePaisa = toPaisa(rate);
  const short = kind === 'SALE' && product && qtyMilli != null && qtyMilli > product.onHandMilli && (!unit || unit === product.baseUnit);

  async function pickById(id: string) {
    setProduct(await get<ProductLite>(`/products/${id}`));
  }

  async function create() {
    try {
      const p = await post<ProductLite>('/products', {
        name: newName,
        purchasePricePaisa: toPaisa(newBuy) ?? undefined,
        salePricePaisa: toPaisa(newSale) ?? undefined,
        baseUnit: unit || 'pcs',
        aliases: raw && raw !== newName ? [raw] : [],
      });
      setProduct(p);
      setCreating(false);
      if (kind === 'SALE' && !rate) setRate(paisaInput(p.salePricePaisa));
      toast(t.saved);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  function choose(p: ProductLite) {
    setProduct(p);
    if (!rate) setRate(paisaInput(kind === 'SALE' ? p.salePricePaisa : p.purchasePricePaisa));
  }

  return (
    <Sheet onClose={onClose}>
      <b>{t.line}{line.serialNo != null ? <span className="n"> {line.serialNo}</span> : null}</b>
      {written && (
        <label className="f">
          <span>{t.written}</span>
          <input className="in ltr" value={raw} onChange={(e) => setRaw(e.target.value)} style={{ fontFamily: "'Caveat', cursive", fontSize: 22, color: 'var(--pen)' }} />
        </label>
      )}

      <div className="f">
        <span>{t.product}</span>
        {product ? (
          <div className="choice" aria-pressed="true">
            <Icon name="check" />
            <span className="grow"><b className="ltr nm">{product.name}</b><span className="label"> · {t.onHand} <span className="n">{qty(product.onHandMilli)}</span></span></span>
            <button className="link" onClick={() => { setProduct(null); setSearch(raw); }}>{t.pick}</button>
          </div>
        ) : creating ? (
          <div className="card" style={{ display: 'grid', gap: 10, padding: 12 }}>
            <label className="f"><span>{t.name}</span><input className="in ltr" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
            <div className="fields">
              <label className="f"><span>{t.purchasePrice}</span><input className="in num" inputMode="decimal" value={newBuy} onChange={(e) => setNewBuy(e.target.value)} /></label>
              <label className="f"><span>{t.salePrice}</span><input className="in num" inputMode="decimal" placeholder="auto" value={newSale} onChange={(e) => setNewSale(e.target.value)} /></label>
            </div>
            <div className="btns2"><button className="cta sec" onClick={() => setCreating(false)}>{t.cancel}</button><button className="cta" disabled={!newName.trim()} onClick={create}>{t.createProduct}</button></div>
          </div>
        ) : (
          <>
            {!!line.suggestions?.length && (
              <div className="chips">
                {line.suggestions.map((s) => (
                  <button key={s.productId} onClick={() => pickById(s.productId)} className="ltr">{s.name} <span className="n muted">{Math.round(s.score * 100)}%</span></button>
                ))}
              </div>
            )}
            <label className="search"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchProduct} aria-label={t.searchProduct} /></label>
            <div className="list">
              {results.map((p) => (
                <button key={p.id} className="item" onClick={() => choose(p)}>
                  <span className="grow"><b className="ltr">{p.name}</b><span className="sub n">{p.sku} · {qty(p.onHandMilli)} {p.baseUnit}</span></span>
                  <span className="qty">{rs(kind === 'SALE' ? p.salePricePaisa : p.purchasePricePaisa)}</span>
                </button>
              ))}
            </div>
            {me.role !== 'ACCOUNTANT' && <button className="choice" onClick={() => setCreating(true)}><Icon name="plus" /><span>{t.createProduct}</span></button>}
          </>
        )}
      </div>

      <div className="fields">
        <label className="f"><span>{t.qty}</span><input className={`in num${qtyMilli == null || short ? ' hl' : ''}`} inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="f">
          <span>{t.unit}</span>
          <select className="in" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">{product?.baseUnit ?? 'pcs'}</option>
            {UNITS.filter((u) => u !== (product?.baseUnit ?? 'pcs')).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="f full"><span>{t.rate}</span><input className={`in num${ratePaisa == null ? ' hl' : ''}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      </div>
      {short && product && <div className="banner bad">{t.onlyStock(qty(product.onHandMilli))}</div>}
      {qtyMilli != null && ratePaisa != null && <div className="rw tot"><span>{t.amount}</span><span className="n">{rs(Math.round((qtyMilli * ratePaisa) / 1000))}</span></div>}

      <button
        className="cta"
        disabled={!product || qtyMilli == null || qtyMilli <= 0 || ratePaisa == null}
        onClick={() => onSave({ ...line, rawName: raw.trim() || product?.name || '', qtyMilli, unit: unit || null, ratePaisa, product, flags: line.flags })}
      >
        {t.ok}
      </button>
      {onRemove && <button className="cta sec" onClick={onRemove}><Icon name="trash" /> {t.remove}</button>}
    </Sheet>
  );
}
