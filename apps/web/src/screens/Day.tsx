import { useState } from 'react';
import { ApiError, get, post } from '../api';
import { date, rs, toPaisa } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, PayModes, Sheet, Top, useApp, useLoad } from '../ui';

const pct = (x: number, total: number) => (total > 0 ? `${((x / total) * 100).toFixed(1)}%` : '0%');

/** SRS §3.10a "Aaj ka hisaab": sale, profit, expenses, galla count and close (FR-CLS-01..08, FR-EXP-01). */
export function Day({ date: day }: { date?: string } = {}) {
  const { t } = useT();
  const { me, toast } = useApp();
  // FR-CLS-08: ?date= opens a past day that was left open, so the owner can close it
  const { data, error, reload } = useLoad(() => Promise.all([get(`/day${day ? `?date=${day}` : ''}`), get('/expense-heads')]), [day]);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [addExp, setAddExp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  if (error) return <><Top title={t.today} backTo="/home" /><div className="body"><ErrorBox error={error} retry={reload} /></div></>;
  if (!data) return <Loading />;
  const [d, heads] = data;
  const s = d.summary;
  const countedPaisa = toPaisa(counted);
  /** FR-CLS-07 / FR-DSH-04: the day's closing as a WhatsApp message for the owner */
  const summaryText = () =>
    [
      `*${t.today} – ${date(d.date)}*`,
      `${t.sale}: ${rs(s.saleTotalPaisa)} (${s.billCount} ${t.bills})`,
      s.salesReturnsPaisa ? `${t.returns}: ${rs(s.salesReturnsPaisa)}` : null,
      `${t.cashSale}: ${rs(s.salesCashPaisa)} · ${t.bankSale}: ${rs(s.salesBankPaisa)} · ${t.creditSale}: ${rs(s.salesCreditPaisa)}`,
      `${t.gross}: ${rs(s.grossProfitPaisa)}`,
      `${t.expenses}: ${rs(s.expensesTotalPaisa)}`,
      `*${t.net}: ${rs(s.netProfitPaisa)}*`,
      `${t.purchases}: ${rs(s.purchasesPaisa)} · ${t.wasooli}: ${rs(s.wasooliCashPaisa + s.wasooliBankPaisa)}`,
      `${t.expected}: ${rs(s.expectedCashPaisa)}`,
      d.closing ? `${t.counted}: ${rs(d.closing.countedCashPaisa)} (${d.closing.differencePaisa === 0 ? t.diffEq : d.closing.differencePaisa < 0 ? t.diffShort(rs(-d.closing.differencePaisa)) : t.diffOver(rs(d.closing.differencePaisa))})` : null,
    ]
      .filter(Boolean)
      .join('\n');
  const diff = countedPaisa == null ? null : countedPaisa - s.expectedCashPaisa;
  const needNote = diff != null && Math.abs(diff) > d.noteLimitPaisa;
  const closed = d.status === 'CLOSED';

  async function close(force = false) {
    setBusy(true);
    try {
      await post('/day/close', { countedCashPaisa: countedPaisa, note: note || null, force, ...(day ? { date: day } : {}) });
      toast(t.closedT);
      setPending(null);
      reload();
    } catch (e) {
      const b = (e as ApiError).body;
      if (b?.code === 'PENDING_SCANS') setPending(b.pending);
      else toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    const reason = window.prompt(t.voidReason);
    if (!reason || reason.trim().length < 3) return;
    try {
      await post('/day/reopen', { date: d.date, reason });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Top title={t.today} backTo="/home" right={<span className={`pill${closed ? ' shut' : ''}`}>{closed ? t.dayClosed : t.dayOpen}</span>} />
      <main className="body" style={{ paddingBottom: closed ? 40 : 140 }}>
        <div className="label n" style={{ textAlign: 'center' }}>{date(d.date)}</div>

        {closed && d.closing && (
          <div className="okhead">
            <div className="tick"><Icon name="check" /></div>
            <h2 style={{ margin: 0 }}>{t.closedT}</h2>
            <div className="label">{d.closing.closedBy}</div>
          </div>
        )}

        <div className="card">
          <div className="rw"><span className="h3">{t.sale}</span><span className="n" style={{ fontSize: 20 }}>{rs(s.saleTotalPaisa)}</span></div>
          <div className="rw sub2"><span><span className="n">{s.billCount}</span> {t.bills}</span></div>
          <div className="stack">
            <i className="k1" style={{ width: pct(s.salesCashPaisa, s.saleTotalPaisa + s.salesReturnsPaisa) }} />
            <i className="k2" style={{ width: pct(s.salesBankPaisa, s.saleTotalPaisa + s.salesReturnsPaisa) }} />
            <i className="k3" style={{ width: pct(s.salesCreditPaisa, s.saleTotalPaisa + s.salesReturnsPaisa) }} />
          </div>
          <div className="rw"><span><i className="key k1" />{t.cashSale}</span><span className="n">{rs(s.salesCashPaisa)}</span></div>
          <div className="rw"><span><i className="key k2" />{t.bankSale}</span><span className="n">{rs(s.salesBankPaisa)}</span></div>
          <div className="rw"><span><i className="key k3" />{t.creditSale}</span><span className="n">{rs(s.salesCreditPaisa)}</span></div>
          {s.salesReturnsPaisa > 0 && <div className="rw"><span>− {t.returns}</span><span className="n">{rs(s.salesReturnsPaisa)}</span></div>}
        </div>

        {me.role !== 'SALESMAN' && (
          <div className="card">
            <h2 className="h3">{t.profitT}</h2>
            <div className="rw"><span>{t.sale}</span><span className="n">{rs(s.saleTotalPaisa)}</span></div>
            <div className="rw"><span>− {t.cogs}</span><span className="n">{rs(s.cogsPaisa)}</span></div>
            <div className="rw tot"><span>{t.gross}</span><span className="n">{rs(s.grossProfitPaisa)}</span></div>
            <div className="rw sub2"><span>{t.margin}</span><span className="n">{s.marginPct}%</span></div>
            <div className="rw"><span>− {t.expenses}</span><span className="n">{rs(s.expensesTotalPaisa)}</span></div>
            <div className="rw tot bigr"><span>{t.net}</span><span className={`n ${s.netProfitPaisa >= 0 ? 'green' : 'red'}`}>{rs(s.netProfitPaisa)}</span></div>
          </div>
        )}

        <div className="card">
          <div className="rowhead"><h2 className="h3">{t.expenses}</h2>{!closed && <button className="link" onClick={() => setAddExp(true)}>+ {t.addExp}</button>}</div>
          {d.expenses.length === 0 && <div className="label">—</div>}
          {d.expenses.map((e: any) => <div key={e.id} className="rw"><span>{e.head}{e.paidFrom !== 'CASH' ? <span className="label"> · {e.paidFrom}</span> : null}</span><span className="n">{rs(e.amountPaisa)}</span></div>)}
        </div>

        <div className="card">
          <h2 className="h3">{t.other}</h2>
          <div className="rw"><span>{t.purchases}</span><span className="n">{rs(s.purchasesPaisa)}</span></div>
          <div className="rw"><span>{t.wasooli}</span><span className="n">{rs(s.wasooliCashPaisa + s.wasooliBankPaisa)}</span></div>
          <div className="rw"><span>{t.supPaid}</span><span className="n">{rs(s.supplierPaidCashPaisa + s.supplierPaidBankPaisa)}</span></div>
        </div>

        <div className="card">
          <h2 className="h3">{t.galla}</h2>
          <div className="rw"><span>{t.opening}</span><span className="n">{rs(s.openingCashPaisa)}</span></div>
          <div className="rw"><span>+ {t.plusCash}</span><span className="n">{rs(s.salesCashPaisa)}</span></div>
          <div className="rw"><span>+ {t.plusWas}</span><span className="n">{rs(s.wasooliCashPaisa)}</span></div>
          <div className="rw"><span>− {t.minusExp}</span><span className="n">{rs(s.expensesCashPaisa)}</span></div>
          <div className="rw"><span>− {t.minusSup}</span><span className="n">{rs(s.supplierPaidCashPaisa)}</span></div>
          <div className="rw"><span>− {t.minusRef}</span><span className="n">{rs(s.cashRefundsPaisa)}</span></div>
          <div className="rw tot"><span>{t.expected}</span><span className="n">{rs(s.expectedCashPaisa)}</span></div>
          {closed && d.closing ? (
            <>
              <div className="rw"><span>{t.counted}</span><span className="n">{rs(d.closing.countedCashPaisa)}</span></div>
              <Diff t={t} diff={d.closing.differencePaisa} />
              {d.closing.note && <div className="label" style={{ marginTop: 6 }}>{d.closing.note}</div>}
              <div className="rw tot"><span>{t.closedSub}</span><span className="n">{rs(d.closing.countedCashPaisa)}</span></div>
              <button className="cta wa" style={{ marginTop: 10 }} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(summaryText())}`, '_blank', 'noopener')}><Icon name="wa" /> {t.shareSummary}</button>
            </>
          ) : d.canClose ? (
            <>
              <label className="label" htmlFor="counted" style={{ display: 'block', marginTop: 8 }}>{t.counted}</label>
              <input id="counted" className="cashin" inputMode="decimal" placeholder={t.countHint} value={counted} onChange={(e) => setCounted(e.target.value)} />
              {diff != null && <Diff t={t} diff={diff} />}
              {needNote && <input className="in hl" style={{ marginTop: 8 }} placeholder={t.noteNeed} value={note} onChange={(e) => setNote(e.target.value)} />}
            </>
          ) : null}
        </div>

        {closed && <div className="label" style={{ textAlign: 'center' }}>{t.lockNote}</div>}
        {closed && me.role === 'OWNER' && <button className="cta sec" onClick={reopen}>{t.reopen}</button>}
        {pending != null && (
          <div className="banner warn">
            {t.pendingScans(pending)} <button className="link" onClick={() => close(true)}>{t.closeAnyway}</button>
          </div>
        )}
      </main>
      {!closed && d.canClose && (
        <div className="dock">
          <button className="cta" disabled={countedPaisa == null || (needNote && !note.trim()) || busy} onClick={() => close(false)}>{t.closeBtn}</button>
        </div>
      )}
      {addExp && <ExpenseSheet heads={heads} onClose={() => setAddExp(false)} onDone={() => { setAddExp(false); reload(); toast(t.saved); }} />}
    </>
  );
}

function Diff({ t, diff }: { t: ReturnType<typeof useT>['t']; diff: number }) {
  return <div className={`diff ${diff === 0 ? 'eq' : diff < 0 ? 'short' : 'over'}`}>{diff === 0 ? t.diffEq : diff < 0 ? t.diffShort(rs(-diff)) : t.diffOver(rs(diff))}</div>;
}

function ExpenseSheet({ heads, onClose, onDone }: { heads: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const { toast } = useApp();
  const [head, setHead] = useState(heads[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA'>('CASH');
  const [note, setNote] = useState('');
  async function save() {
    try {
      await post('/expenses', { headId: head, amountPaisa: toPaisa(amount), paidFrom: mode, note: note || null });
      onDone();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <Sheet onClose={onClose}>
      <b>{t.addExp}</b>
      <div className="chips">{heads.map((h) => <button key={h.id} aria-pressed={h.id === head} onClick={() => setHead(h.id)}>{h.name}</button>)}</div>
      <input className="cashin" inputMode="decimal" placeholder={t.amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <PayModes value={mode} onChange={setMode} />
      <input className="in" placeholder="…" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="cta" disabled={!head || !toPaisa(amount)} onClick={save}>{t.addExp}</button>
    </Sheet>
  );
}
