import { useEffect, useRef, useState } from 'react';
import { get, newKey, post, text } from '../api';
import { paisaInput, qty, rs, time, toMilli, toPaisa } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, Sheet, Top, go, useApp, useLoad } from '../ui';

/** Result after confirm (FR-STK-04: stock before → after, low stock) and receipt view/print/share (FR-RCP-01..05). */
export function Doc({ id, isNew }: { id: string; isNew: boolean }) {
  const { t } = useT();
  const { me, toast } = useApp();
  const { data: d, error, reload } = useLoad(() => get(`/documents/${id}`), [id]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [returning, setReturning] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (d?.kind === 'SALE') text(`/documents/${id}/receipt?paper=80`).then(setReceipt).catch(() => setReceipt(null));
  }, [d, id]);

  if (error) return <><Top title={t.receipt} backTo="/home" /><div className="body"><ErrorBox error={error} retry={reload} /></div></>;
  if (!d) return <Loading />;
  const sale = d.kind === 'SALE';
  const voided = d.status === 'VOIDED';
  const isReturn = d.kind === 'SALES_RETURN' || d.kind === 'PURCHASE_RETURN';
  const canReturn =
    (d.status === 'POSTED' || d.status === 'PARTIALLY_RETURNED') &&
    ((sale && (me.role === 'OWNER' || me.role === 'SALESMAN')) || (d.kind === 'PURCHASE' && (me.role === 'OWNER' || me.role === 'STOREKEEPER')));

  async function share() {
    const s = await get(`/documents/${id}/share`);
    window.open(s.whatsappUrl, '_blank', 'noopener');
  }
  async function doVoid() {
    try {
      await post(`/documents/${id}/void`, { reason });
      toast(t.voided);
      setVoiding(false);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Top title={isNew ? '' : `${d.docNo}`} backTo="/home" />
      <main className="body" style={{ paddingBottom: 40 }}>
        {isNew && (
          <div className="okhead">
            <div className="tick"><Icon name="check" /></div>
            <h2 style={{ margin: 0 }}>{sale ? t.doneOut : t.doneIn}</h2>
          </div>
        )}
        <div className="label ltr" style={{ textAlign: 'center' }}>
          {d.party?.name ?? (d.kind === 'OPENING' ? t.importOpening : d.kind === 'ADJUST_IN' || d.kind === 'ADJUST_OUT' ? `${t.adjust}${d.reason ? ` — ${d.reason}` : ''}` : t.walkIn)} · {d.docNo} · {d.lines.length} items · <b>{rs(d.totalPaisa)}</b> · {time(d.postedAt)}
        </div>
        {voided && <div className="banner bad">{t.voided}{d.reason ? ` — ${d.reason}` : ''}</div>}
        {d.kind === 'VOID' && <div className="banner warn">{t.voided}</div>}
        {d.status === 'PARTIALLY_RETURNED' && <div className="banner warn">{t.partReturned}</div>}
        {d.status === 'FULLY_RETURNED' && <div className="banner warn">{t.fullReturned}</div>}
        {isReturn && d.returnOfDocId && (
          <a className="banner warn" href={`#/doc/${d.returnOfDocId}`}>{t.returnOf} →{d.reason ? ` ${d.reason}` : ''}</a>
        )}

        <div className="card">
          <div className="list">
            {d.lines.map((l: any) => (
              <a key={l.lineNo} className="item" href={`#/stock/${l.productId}`}>
                <span className="grow">
                  <b className="ltr">{l.productName}</b>
                  <span className="sub">{l.lowStock && sale ? <span className="red">{t.lowNow}</span> : <span className="n">{l.movedMilli < 0 ? '−' : '+'}{qty(l.qtyMilli)} × {rs(l.ratePaisa)}</span>}</span>
                </span>
                <span className="chg"><s>{qty(l.stockBeforeMilli)}</s><Icon name="arrow" /><span className={l.lowStock ? 'red' : ''}>{qty(l.stockAfterMilli)}</span></span>
              </a>
            ))}
          </div>
          <div className="rw tot"><span>TOTAL</span><span className="n">{rs(d.totalPaisa)}</span></div>
          {d.paidPaisa > 0 && <div className="rw sub2"><span>{isReturn ? t.refundNow : t.paidNow}</span><span className="n">{rs(d.paidPaisa)}</span></div>}
          {d.balanceDuePaisa > 0 && !isReturn && d.kind !== 'ADJUST_IN' && d.kind !== 'ADJUST_OUT' && d.kind !== 'OPENING' && <div className="rw sub2"><span>{t.udhaar}</span><span className="n red">{rs(d.balanceDuePaisa)}</span></div>}
        </div>

        {sale && receipt && (
          <>
            <iframe ref={frame} title={t.receipt} className="receipt-frame" srcDoc={receipt} />
            <div className="btns2">
              <button className="cta wa" onClick={share}><Icon name="wa" /> {t.whatsapp}</button>
              <button className="cta sec" onClick={() => frame.current?.contentWindow?.print()}><Icon name="print" /> {t.print}</button>
            </div>
          </>
        )}

        {d.returns?.length > 0 && (
          <div className="card">
            <h2 className="h3">{t.returnsList}</h2>
            <div className="list">
              {d.returns.map((r: any) => (
                <a key={r.id} className="item" href={`#/doc/${r.id}`}><span className="grow n">{r.docNo}</span><span className="n">{rs(r.totalPaisa)}</span></a>
              ))}
            </div>
          </div>
        )}

        {canReturn && <button className="cta sec" onClick={() => setReturning(true)}><Icon name="arrow" /> {t.returnBtn}</button>}
        {returning && <ReturnSheet d={d} onClose={() => setReturning(false)} onDone={(rid) => { setReturning(false); toast(t.returnDone); go(`/doc/${rid}`); }} />}

        {me.role === 'OWNER' && d.status === 'POSTED' && (d.kind === 'SALE' || d.kind === 'PURCHASE') && (
          voiding ? (
            <div className="card" style={{ display: 'grid', gap: 8 }}>
              <input className="in" placeholder={t.voidReason} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="btns2"><button className="cta sec" onClick={() => setVoiding(false)}>{t.cancel}</button><button className="cta bad" disabled={reason.trim().length < 3} onClick={doVoid}>{t.voidDoc}</button></div>
            </div>
          ) : (
            <button className="link red" onClick={() => setVoiding(true)} style={{ textAlign: 'center' }}>{t.voidDoc}</button>
          )
        )}
        <button className="cta sec" onClick={() => go('/home')}>{t.home}</button>
      </main>
    </>
  );
}

/** FR-STK-06: choose how much of each line comes back; refund now, or let it adjust the party's balance. */
function ReturnSheet({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useT();
  const { toast } = useApp();
  const walkIn = d.kind === 'SALE' && (!d.party || d.party.name === 'Walk-in');
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [refund, setRefund] = useState<string | null>(null);
  const [mode, setMode] = useState('CASH');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const left = (l: any) => l.qtyMilli - (l.returnedMilli ?? 0);
  const chosen = d.lines.map((l: any) => ({ l, m: toMilli(qtys[l.lineNo] ?? '') ?? 0 })).filter((x: any) => x.m > 0);
  const bad = chosen.some((x: any) => x.m > left(x.l)) || d.lines.some((l: any) => (qtys[l.lineNo] ?? '').trim() && toMilli(qtys[l.lineNo]!) == null);
  const sub = chosen.reduce((s: number, x: any) => s + Math.round((x.m * x.l.ratePaisa) / 1000), 0);
  const est = d.subtotalPaisa > 0 ? Math.round((sub * d.totalPaisa) / d.subtotalPaisa) : sub;
  const refundPaisa = walkIn ? est : refund == null ? 0 : (toPaisa(refund) ?? 0);

  async function save() {
    setBusy(true);
    try {
      const r = await post(
        `/documents/${d.id}/return`,
        { lines: chosen.map((x: any) => ({ lineNo: x.l.lineNo, qtyMilli: x.m })), refunds: refundPaisa > 0 ? [{ mode, amountPaisa: refundPaisa }] : [], reason },
        { 'idempotency-key': key },
      );
      onDone(r.id);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose}>
      <h2 className="h3">{t.returnTitle} · <span className="n">{d.docNo}</span></h2>
      <div className="list">
        {d.lines.map((l: any) => (
          <label key={l.lineNo} className="item">
            <span className="grow">
              <b className="ltr">{l.productName}</b>
              <span className="sub n">{t.returnLeft('')} <bdi className="ltr">{qty(left(l))} {l.unit} · {rs(l.ratePaisa)}</bdi></span>
            </span>
            <input
              className="in num"
              style={{ width: 90 }}
              inputMode="decimal"
              placeholder="0"
              disabled={left(l) <= 0}
              value={qtys[l.lineNo] ?? ''}
              aria-label={`${t.qty} ${l.productName}`}
              onChange={(e) => setQtys({ ...qtys, [l.lineNo]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="rw tot"><span>{t.estTotal}</span><span className="n">{rs(est)}</span></div>
      <div className="fields">
        <label className="f">
          <span>{t.refundNow}</span>
          <input className="in num" inputMode="decimal" disabled={walkIn} value={walkIn ? paisaInput(est) : (refund ?? '')} placeholder="0" onChange={(e) => setRefund(e.target.value)} />
        </label>
        <label className="f">
          <span>{t.payment}</span>
          <select className="in" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="CASH">{t.cash}</option><option value="BANK">{t.bank}</option><option value="JAZZCASH">{t.jazz}</option><option value="EASYPAISA">{t.easy}</option>
          </select>
        </label>
      </div>
      <div className="label">{walkIn ? t.walkInFull : t.refundAuto}</div>
      <input className="in" placeholder={t.returnReason} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="btns2">
        <button className="cta sec" onClick={onClose}>{t.cancel}</button>
        <button className="cta" disabled={busy || bad || !chosen.length || reason.trim().length < 3 || refundPaisa > est} onClick={save}>{t.returnSave}</button>
      </div>
    </Sheet>
  );
}
