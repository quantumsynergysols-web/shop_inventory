import { useEffect, useRef, useState } from 'react';
import { get, post, text } from '../api';
import { qty, rs, time } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, Top, go, useApp, useLoad } from '../ui';

/** Result after confirm (FR-STK-04: stock before → after, low stock) and receipt view/print/share (FR-RCP-01..05). */
export function Doc({ id, isNew }: { id: string; isNew: boolean }) {
  const { t } = useT();
  const { me, toast } = useApp();
  const { data: d, error, reload } = useLoad(() => get(`/documents/${id}`), [id]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (d?.kind === 'SALE') text(`/documents/${id}/receipt?paper=80`).then(setReceipt).catch(() => setReceipt(null));
  }, [d, id]);

  if (error) return <><Top title={t.receipt} backTo="/home" /><div className="body"><ErrorBox error={error} retry={reload} /></div></>;
  if (!d) return <Loading />;
  const sale = d.kind === 'SALE';
  const voided = d.status === 'VOIDED';

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
          {d.party?.name ?? t.walkIn} · {d.docNo} · {d.lines.length} items · <b>{rs(d.totalPaisa)}</b> · {time(d.postedAt)}
        </div>
        {voided && <div className="banner bad">{t.voided}{d.reason ? ` — ${d.reason}` : ''}</div>}
        {d.kind === 'VOID' && <div className="banner warn">{t.voided}</div>}

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
          {d.paidPaisa > 0 && <div className="rw sub2"><span>{t.paidNow}</span><span className="n">{rs(d.paidPaisa)}</span></div>}
          {d.balanceDuePaisa > 0 && <div className="rw sub2"><span>{t.udhaar}</span><span className="n red">{rs(d.balanceDuePaisa)}</span></div>}
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
