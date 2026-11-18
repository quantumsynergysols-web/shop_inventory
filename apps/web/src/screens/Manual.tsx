import { useMemo, useState } from 'react';
import { ApiError, newKey, post } from '../api';
import { qty, rs, toPaisa } from '../format';
import { useT } from '../i18n';
import { Icon, PayModes, Top, go, useApp } from '../ui';
import { canScan } from './Home';
import { LineSheet, type EditLine } from './LineSheet';
import { PartyPicker, type PartyLite } from './PartyPicker';

/** FR-STK-09: Stock IN / OUT without a photo, through the same posting as scans. */
export function Manual({ type }: { type: 'SALE' | 'PURCHASE' }) {
  const { t } = useT();
  const { me, toast } = useApp();
  const [lines, setLines] = useState<EditLine[]>([]);
  const [editing, setEditing] = useState<{ index: number | null; line: EditLine } | null>(null);
  const [party, setParty] = useState<PartyLite | null>(null);
  const [mode, setMode] = useState<'CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA'>('CASH');
  const [received, setReceived] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => newKey(), []);
  const total = lines.reduce((s, l) => s + Math.round(((l.qtyMilli ?? 0) * (l.ratePaisa ?? 0)) / 1000), 0);
  // FR-REV-13: discount on the bill total
  const [disc, setDisc] = useState('');
  const discountPaisa = Math.min(total, toPaisa(disc) ?? 0);
  const net = total - discountPaisa;
  const paid = received == null ? (type === 'SALE' ? net : 0) : (toPaisa(received) ?? 0);

  async function save() {
    setBusy(true);
    try {
      const doc = await post(
        '/documents',
        {
          kind: type,
          partyId: party?.id ?? null,
          lines: lines.map((l) => ({ productId: l.product!.id, qtyMilli: l.qtyMilli, unit: l.unit, ratePaisa: l.ratePaisa })),
          payments: paid > 0 ? [{ mode, amountPaisa: Math.min(paid, net) }] : [],
          ...(discountPaisa > 0 ? { discountPaisa } : {}),
        },
        { 'idempotency-key': key },
      );
      go(`/doc/${doc.id}?new=1`);
    } catch (e) {
      const b = (e as ApiError).body;
      toast(b?.shortages ? t.short : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Top title={`${t.manual} · ${type === 'SALE' ? t.outBtn : t.inBtn}`} backTo="/home" />
      <main className="body" style={{ paddingBottom: 150 }}>
        <div className="chips" role="group">
          {canScan(me.role, 'PURCHASE') && <button aria-pressed={type === 'PURCHASE'} onClick={() => go('/manual?type=PURCHASE')}>{t.inBtn}</button>}
          {canScan(me.role, 'SALE') && <button aria-pressed={type === 'SALE'} onClick={() => go('/manual?type=SALE')}>{t.outBtn}</button>}
        </div>
        <PartyPicker kind={type} value={party} onChange={setParty} />
        <div className="lines">
          {lines.map((l, i) => (
            <button key={i} className="ln" onClick={() => setEditing({ index: i, line: l })}>
              <div className="row"><span className="nm grow">{l.product?.name}</span></div>
              <div className="r2"><span className="n">{qty(l.qtyMilli)} {l.unit ?? l.product?.baseUnit} × {rs(l.ratePaisa)}</span><span className="n">{rs(Math.round(((l.qtyMilli ?? 0) * (l.ratePaisa ?? 0)) / 1000))}</span></div>
            </button>
          ))}
        </div>
        <button className="cta sec" onClick={() => setEditing({ index: null, line: { rawName: '', qtyMilli: 1000, unit: null, ratePaisa: null, product: null } })}><Icon name="plus" /> {t.addLine}</button>
        {lines.length > 0 && (
          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <div className="rw" style={{ marginTop: 0 }}><span>{t.sumLines}</span><span className="n">{rs(total)}</span></div>
            <label className="f"><span>{t.discount}</span><input className="in num" inputMode="decimal" placeholder="0" value={disc} onChange={(e) => setDisc(e.target.value)} /></label>
            <div className="rw tot"><span>TOTAL</span><span className="n">{rs(net)}</span></div>
            <PayModes value={mode} onChange={setMode} />
            <label className="f"><span>{type === 'SALE' ? t.received : t.paidNow}</span><input className="in num" inputMode="decimal" value={received ?? (type === 'SALE' ? String(net / 100) : '')} placeholder="0" onChange={(e) => setReceived(e.target.value)} /></label>
            {type === 'SALE' && paid < net && <div className={`banner ${party ? 'warn' : 'bad'}`}>{t.udhaar}: {rs(net - paid)}</div>}
          </div>
        )}
      </main>
      <div className="dock">
        <button className="cta" disabled={!lines.length || busy || (type === 'PURCHASE' && !party) || (type === 'SALE' && paid < net && !party)} onClick={save}>
          {busy ? '…' : type === 'PURCHASE' ? t.confirmIn : t.confirmOut}
        </button>
      </div>
      {editing && (
        <LineSheet
          kind={type}
          written={false}
          line={editing.line}
          onClose={() => setEditing(null)}
          onRemove={editing.index != null ? () => { setLines((x) => x.filter((_, i) => i !== editing.index)); setEditing(null); } : undefined}
          onSave={(l) => {
            setLines((x) => (editing.index == null ? [...x, l] : x.map((y, i) => (i === editing.index ? l : y))));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
