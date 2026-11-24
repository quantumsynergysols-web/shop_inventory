import { useState } from 'react';
import { get, post } from '../api';
import { date, rs, toPaisa } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Icon, Loading, Nav, PayModes, Sheet, Top, useApp, useLoad } from '../ui';

const balanceText = (t: ReturnType<typeof useT>['t'], b: number) => (b > 0 ? t.theyOwe : b < 0 ? t.weOwe : t.settled);

/** FR-PTY-01/02, FR-RPT-05: suppliers and customers with balances. */
export function LedgerList() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | 'CUSTOMER' | 'SUPPLIER'>('');
  const { data, error, reload } = useLoad(() => get(`/parties?${type ? `type=${type}&` : ''}${q ? `q=${encodeURIComponent(q)}` : ''}`), [q, type], { keepWhileSearching: true });
  return (
    <>
      <Top title={t.ledger} />
      <main className="body">
        <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.name} aria-label={t.name} /></label>
        <div className="chips">
          <button aria-pressed={type === ''} onClick={() => setType('')}>{t.tabAll}</button>
          <button aria-pressed={type === 'CUSTOMER'} onClick={() => setType('CUSTOMER')}>{t.customer}</button>
          <button aria-pressed={type === 'SUPPLIER'} onClick={() => setType('SUPPLIER')}>{t.supplier}</button>
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        <div className="card">
          <div className="list">
            {data?.filter((p: any) => p.name !== 'Walk-in').map((p: any) => (
              <a key={p.id} className="item" href={`#/ledger/${p.id}`}>
                <span className="grow"><b className="ltr">{p.name}</b><span className="sub">{p.type === 'SUPPLIER' ? t.supplier : t.customer}{p.phone ? <span className="n"> · {p.phone}</span> : null}</span></span>
                <span className={`qty ${p.balancePaisa > 0 ? 'red' : p.balancePaisa < 0 ? 'blue' : 'muted'}`}>
                  {rs(Math.abs(p.balancePaisa))}<span className="sub" style={{ display: 'block' }}>{balanceText(t, p.balancePaisa)}</span>
                </span>
              </a>
            ))}
            {data?.length === 0 && <div className="label">—</div>}
          </div>
        </div>
      </main>
      <Nav current="ledger" />
    </>
  );
}

/** FR-PTY-02/03: history and recording a payment (wasooli from a customer, payment to a supplier). */
export function PartyView({ id }: { id: string }) {
  const { t } = useT();
  const { me, toast } = useApp();
  const { data: p, error, reload } = useLoad(() => get(`/parties/${id}`), [id]);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA'>('CASH');
  if (error) return <><Top title={t.ledger} backTo="/ledger" /><div className="body"><ErrorBox error={error} /></div></>;
  if (!p) return <Loading />;
  const direction = p.type === 'SUPPLIER' ? 'PAID' : 'RECEIVED';
  const canPay = direction === 'RECEIVED' ? ['OWNER', 'SALESMAN'].includes(me.role) : me.role === 'OWNER';

  async function pay() {
    try {
      await post(`/parties/${id}/payments`, { direction, amountPaisa: toPaisa(amount), mode });
      toast(t.saved);
      setPaying(false);
      setAmount('');
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Top title={<span className="ltr">{p.name}</span>} backTo="/ledger" />
      <main className="body">
        <div className="card">
          <div className="label">{balanceText(t, p.balancePaisa)}</div>
          <div className={`big n ${p.balancePaisa > 0 ? 'red' : p.balancePaisa < 0 ? 'blue' : ''}`}>{rs(Math.abs(p.balancePaisa))}</div>
          {p.phone && <div className="label n">{p.phone}</div>}
        </div>
        {canPay && <button className="cta" onClick={() => setPaying(true)}><Icon name="cash" /> {t.recordPayment}</button>}
        <div className="card">
          <h2 className="h3">{t.history}</h2>
          <div className="list">
            {p.history.map((h: any) => (
              <a key={h.id} className="item" href={h.kind === 'document' ? `#/doc/${h.id}` : undefined}>
                <span className="grow">
                  <b>{h.kind === 'document' ? <span className="n">{h.no}</span> : h.type === 'RECEIVED' ? t.receivedFrom : t.paidTo}</b>
                  <span className="sub n">{date(h.at)}{h.kind === 'payment' ? ` · ${h.mode}` : ''}{h.status === 'VOIDED' ? ` · ${t.voided}` : ''}</span>
                </span>
                <span className="qty">{rs(h.totalPaisa ?? h.amountPaisa)}</span>
              </a>
            ))}
            {p.history.length === 0 && <div className="label">—</div>}
          </div>
        </div>
      </main>
      {paying && (
        <Sheet onClose={() => setPaying(false)}>
          <b>{direction === 'RECEIVED' ? t.receivedFrom : t.paidTo} · <span className="ltr">{p.name}</span></b>
          <PayModes value={mode} onChange={setMode} />
          <input className="cashin" inputMode="decimal" placeholder={t.amount} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          <button className="cta" disabled={!toPaisa(amount)} onClick={pay}>{t.save}</button>
        </Sheet>
      )}
    </>
  );
}
