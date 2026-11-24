import { useState } from 'react';
import { get, post } from '../api';
import { rs } from '../format';
import { useT } from '../i18n';
import { Icon, Sheet, useApp, useLoad } from '../ui';

export interface PartyLite {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

/** FR-REV-06: purchases pick or create the supplier; sales pick a customer or stay Walk-in. */
export function PartyPicker({ kind, value, onChange, suggested }: { kind: 'SALE' | 'PURCHASE'; value: PartyLite | null; onChange: (p: PartyLite | null) => void; suggested?: { id: string; name: string } | null }) {
  const { t } = useT();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const type = kind === 'SALE' ? 'CUSTOMER' : 'SUPPLIER';
  const { data } = useLoad(() => (open ? get<PartyLite[]>(`/parties?type=${type}${q ? `&q=${encodeURIComponent(q)}` : ''}`) : Promise.resolve([])), [open, q], { keepWhileSearching: true });
  const label = kind === 'SALE' ? t.customer : t.supplier;

  async function create() {
    try {
      const p = await post<PartyLite>('/parties', { name: newName, phone: newPhone || null, type });
      onChange(p);
      setOpen(false);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <button className="card row" style={{ width: '100%', textAlign: 'start' }} onClick={() => setOpen(true)}>
        <span className="ib" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: 0 }}><Icon name="user" /></span>
        <span className="grow">
          <span className="label">{label}</span>
          <b className="ltr" style={{ display: 'block' }}>{value?.name ?? (kind === 'SALE' ? t.walkIn : t.pickParty)}</b>
        </span>
        {suggested && !value && <span className="tag t-new">{t.suggested}</span>}
        <Icon name="chev" flip />
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <b>{label}</b>
          {suggested && (
            <button className="choice" onClick={async () => { onChange(await get<PartyLite>(`/parties/${suggested.id}`)); setOpen(false); }}>
              <span className="tag t-new">{t.suggested}</span><b className="ltr">{suggested.name}</b>
            </button>
          )}
          <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.name} aria-label={t.name} /></label>
          <div className="list">
            {kind === 'SALE' && <button className="item" onClick={() => { onChange(null); setOpen(false); }}><b className="grow">{t.walkIn}</b></button>}
            {(data ?? []).filter((p) => p.name !== 'Walk-in').map((p) => (
              <button key={p.id} className="item" onClick={() => { onChange(p); setOpen(false); }}>
                <span className="grow"><b className="ltr">{p.name}</b><span className="sub n">{p.phone ?? ''}</span></span>
                <span className={`qty ${p.balancePaisa > 0 ? 'red' : p.balancePaisa < 0 ? 'blue' : 'muted'}`}>{p.balancePaisa ? rs(Math.abs(p.balancePaisa)) : ''}</span>
              </button>
            ))}
          </div>
          <div className="card" style={{ display: 'grid', gap: 8, padding: 12 }}>
            <b>{t.newParty} {label}</b>
            <input className="in ltr" placeholder={t.name} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="in ltr" placeholder={t.phone} inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            <button className="cta sec" disabled={!newName.trim()} onClick={create}><Icon name="plus" /> {t.save}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
