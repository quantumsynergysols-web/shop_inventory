import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, blobUrl, get, newKey, post, put, request } from '../api';
import { qty, rs, toPaisa } from '../format';
import { useT } from '../i18n';
import { AuthImg, ErrorBox, Icon, Loading, PayModes, Top, go, useApp, useLoad } from '../ui';
import { LineSheet, type EditLine } from './LineSheet';
import { PartyPicker, type PartyLite } from './PartyPicker';

/* ---------------- capture (FR-SCAN-01..06) ---------------- */

interface Page {
  blob: Blob;
  url: string;
  dark: boolean;
}

/** Shrinks to 2,000 px on the long side (FR-SCAN-04) and measures brightness for the "too dark" warning (FR-SCAN-05). */
async function prepare(file: File): Promise<Page> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const sample = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sample.length; i += 4 * 97) {
    sum += 0.299 * sample[i]! + 0.587 * sample[i + 1]! + 0.114 * sample[i + 2]!;
    n++;
  }
  const blob = file.type === 'image/png' && scale === 1 ? file : await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85));
  return { blob, url: URL.createObjectURL(blob), dark: sum / Math.max(n, 1) < 60 };
}

export function ScanNew({ type }: { type: 'SALE' | 'PURCHASE' }) {
  const { t } = useT();
  const { toast } = useApp();
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function add(files: FileList | null) {
    if (!files) return;
    const list = [...files].slice(0, 10 - pages.length);
    if (files.length > list.length) toast(t.maxPages);
    const ready = await Promise.all(list.map(prepare));
    if (ready.some((p) => p.dark)) toast(t.tooDark);
    setPages((p) => [...p, ...ready]);
  }

  async function upload() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('type', type);
      form.set('clientId', newKey());
      pages.forEach((p, i) => form.append('pages', p.blob, `page-${i + 1}.${p.blob.type === 'image/png' ? 'png' : 'jpg'}`));
      const res = await request('/scans', { method: 'POST', body: form });
      const s = await res.json();
      go(`/scan/${s.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t.offline);
      setBusy(false);
    }
  }

  return (
    <>
      <Top title={type === 'PURCHASE' ? t.capIn : t.capOut} backTo="/home" />
      <main className="body" style={{ paddingBottom: 130 }}>
        <div className="chips" role="group">
          <button aria-pressed={type === 'PURCHASE'} onClick={() => go('/scan/new?type=PURCHASE')}>{t.inBtn}</button>
          <button aria-pressed={type === 'SALE'} onClick={() => go('/scan/new?type=SALE')}>{t.outBtn}</button>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <button className="drop" onClick={() => input.current?.click()} disabled={pages.length >= 10}>
          <Icon name="camera" />
          <b>{t.addPhoto}</b>
          <span className="label">{t.tipStraight}</span>
        </button>
        {pages.length > 0 && (
          <div className="thumbs">
            {pages.map((p, i) => (
              <div key={p.url} className="thumb">
                <img src={p.url} alt={`${t.page} ${i + 1}`} />
                <span className="n">{i + 1}</span>
                <button aria-label={t.remove} onClick={() => setPages((x) => x.filter((_, j) => j !== i))}><Icon name="close" /></button>
              </div>
            ))}
          </div>
        )}
        {pages.some((p) => p.dark) && <div className="banner warn">{t.tooDark}</div>}
      </main>
      <div className="dock">
        <div className="note"><span className="n">{pages.length}</span> {t.page}</div>
        <button className="cta" disabled={!pages.length || busy} onClick={upload}>{busy ? '…' : t.upload}</button>
      </div>
    </>
  );
}

/* ---------------- one scan: processing → review (FR-AI-06, §3.4) ---------------- */

export function ScanView({ id }: { id: string }) {
  const { t } = useT();
  const { data: scan, error, reload, set } = useLoad(() => get(`/scans/${id}`), [id]);

  useEffect(() => {
    if (scan?.status !== 'PROCESSING') return;
    const h = setTimeout(reload, 900);
    return () => clearTimeout(h);
  }, [scan, reload]);
  useEffect(() => {
    if (scan?.status === 'CONFIRMED' && scan.documentId) go(`/doc/${scan.documentId}`);
  }, [scan]);

  if (error) return <><Top title={t.review} backTo="/home" /><div className="body"><ErrorBox error={error} retry={reload} /></div></>;
  if (!scan) return <Loading />;
  if (scan.status === 'PROCESSING') {
    return (
      <>
        <Top title={t.reading} backTo="/home" />
        <main className="body">
          <AuthImg src={`/scans/${id}/pages/1`} alt={t.page} className="photo" />
          <div className="prog"><i style={{ width: '70%' }} /></div>
          <div className="card"><div className="step"><span className="spin" /> {t.reading}</div></div>
        </main>
      </>
    );
  }
  if (scan.status === 'FAILED') {
    return (
      <>
        <Top title={t.failed} backTo="/home" />
        <main className="body">
          <div className="banner bad">{scan.failureReason ?? t.failed}</div>
          <AuthImg src={`/scans/${id}/pages/1`} alt={t.page} className="photo" />
          <div className="btns2">
            <button className="cta" onClick={async () => set(await post(`/scans/${id}/retry`))}>{t.retry}</button>
            <button className="cta sec" onClick={async () => set(await post(`/scans/${id}/manual`))}>{t.typeManually}</button>
          </div>
        </main>
      </>
    );
  }
  if (scan.status === 'DISCARDED') return <><Top title={t.review} backTo="/home" /><div className="body"><div className="banner warn">{t.discard} ✓</div></div></>;
  if (scan.status !== 'NEEDS_REVIEW') return <Loading />;
  return <Review scan={scan} onChange={set} />;
}

function toEdit(l: any): EditLine {
  return { id: l.id, serialNo: l.serialNo, page: l.page, rawName: l.rawName, qtyMilli: l.qtyMilli, unit: l.unit, ratePaisa: l.ratePaisa, product: l.product, suggestions: l.suggestions, flags: l.flags };
}

function Review({ scan, onChange }: { scan: any; onChange: (s: any) => void }) {
  const { t } = useT();
  const { toast } = useApp();
  const kind: 'SALE' | 'PURCHASE' = scan.type;
  const [tab, setTab] = useState<'all' | 'need'>('all');
  const [editing, setEditing] = useState<{ index: number | null; line: EditLine } | null>(null);
  const [party, setParty] = useState<PartyLite | null>(null);
  const [mode, setMode] = useState<'CASH' | 'BANK' | 'JAZZCASH' | 'EASYPAISA'>('CASH');
  const [received, setReceived] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPhoto, setShowPhoto] = useState(scan.lines.length === 0);
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [pageSizes, setPageSizes] = useState<Record<number, [number, number]>>({});
  const key = useMemo(() => newKey(), []);

  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      for (let p = 1; p <= scan.pageCount; p++) {
        const u = await blobUrl(`/scans/${scan.id}/pages/${p}`).catch(() => null);
        if (u && live) {
          urls.push(u);
          setPageUrls((x) => ({ ...x, [p]: u }));
          const img = new Image();
          img.onload = () => live && setPageSizes((x) => ({ ...x, [p]: [img.naturalWidth, img.naturalHeight] }));
          img.src = u;
        }
      }
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [scan.id, scan.pageCount]);

  useEffect(() => {
    if (scan.suggestedParty && !party) get(`/parties/${scan.suggestedParty.id}`).then(setParty).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.suggestedParty?.id]);

  const needs = (l: any) => !l.product || l.flags.length > 0 || l.shortStock;
  const shown = tab === 'need' ? scan.lines.filter(needs) : scan.lines;
  const total = scan.linesTotalPaisa;
  const receivedPaisa = received == null ? total : (toPaisa(received) ?? 0);

  async function save(lines: EditLine[]) {
    const body = lines.map((l) => ({ id: l.id, serialNo: l.serialNo ?? null, page: l.page ?? 1, rawName: l.rawName, qtyMilli: l.qtyMilli, unit: l.unit, ratePaisa: l.ratePaisa, productId: l.product?.id ?? null }));
    try {
      onChange(await put(`/scans/${scan.id}/lines`, { lines: body }));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const payments = kind === 'SALE' ? (receivedPaisa > 0 ? [{ mode, amountPaisa: Math.min(receivedPaisa, total) }] : []) : receivedPaisa > 0 && received != null ? [{ mode, amountPaisa: Math.min(receivedPaisa, total) }] : [];
      const doc = await post(`/scans/${scan.id}/confirm`, { partyId: party?.id ?? null, payments }, { 'idempotency-key': key });
      go(`/doc/${doc.id}?new=1`);
    } catch (e) {
      const b = (e as ApiError).body;
      toast(b?.problems?.[0] ?? (e as Error).message);
      setBusy(false);
    }
  }

  const blockers = scan.blockingCount + (kind === 'PURCHASE' && !party ? 1 : 0);
  const credit = kind === 'SALE' && receivedPaisa < total;

  return (
    <>
      <Top title={t.review} backTo="/home" right={<button className="ib" aria-label={t.discard} onClick={async () => { if (confirm_(t.discardQ)) { await post(`/scans/${scan.id}/discard`); go('/home'); } }}><Icon name="trash" /></button>} />
      <main className="body" style={{ paddingBottom: 170 }}>
        {!scan.aiReads && <div className="banner info">{scan.lines.length ? t.demoMode : t.manualMode}</div>}
        {scan.flags.includes('ROWS_MAY_BE_MISSING') && <div className="banner bad">{t.missingRows(scan.missingSerials.join(', '))}</div>}
        {scan.flags.includes('DUPLICATE_PHOTO') && <div className="banner warn">{t.dupPhoto}</div>}

        <PartyPicker kind={kind} value={party} onChange={setParty} suggested={scan.suggestedParty} />

        <button className="link" onClick={() => setShowPhoto((x) => !x)} style={{ textAlign: 'start' }}>{showPhoto ? '▾' : '▸'} {t.page} ({scan.pageCount})</button>
        {showPhoto && Object.entries(pageUrls).map(([p, u]) => <img key={p} src={u} alt={`${t.page} ${p}`} className="photo" />)}

        <div className="chips" role="group">
          <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>{t.tabAll} <span className="n">{scan.lines.length}</span></button>
          <button aria-pressed={tab === 'need'} onClick={() => setTab('need')}>{t.tabNeed} <span className="n">{scan.lines.filter(needs).length}</span></button>
        </div>

        <div className="lines">
          {shown.map((l: any) => {
            const stop = l.shortStock;
            const cls = stop ? 'stop' : needs(l) ? 'need' : '';
            const msgs: string[] = [];
            if (!l.product) msgs.push(l.flags.includes('PICK_PRODUCT') ? t.pick : t.newP);
            if (l.flags.includes('AMOUNT_MISMATCH')) msgs.push(t.amountMismatch);
            if (l.flags.includes('RATE_FROM_LIST')) msgs.push(t.fromList);
            if (l.shortStock && l.product) msgs.push(t.onlyStock(qty(l.product.onHandMilli)));
            if (l.priceDiff) msgs.push(t.priceChanged(rs(l.priceDiff.listPaisa), rs(l.priceDiff.writtenPaisa)));
            const bbox = Array.isArray(l.bbox) && l.bbox.length === 4 ? (l.bbox as number[]) : null;
            const url = pageUrls[l.page];
            const size = pageSizes[l.page];
            return (
              <button key={l.id} className={`ln ${cls}`} onClick={() => setEditing({ index: scan.lines.indexOf(l), line: toEdit(l) })}>
                {bbox && url && size ? (
                  <div
                    className="crop"
                    role="img"
                    aria-label={l.rawName}
                    style={{ height: 'auto', aspectRatio: `${bbox[2]! * size[0]} / ${bbox[3]! * size[1]}`, backgroundImage: `url(${url})`, backgroundSize: `${100 / bbox[2]!}% auto`, backgroundPosition: `${(bbox[0]! / Math.max(1 - bbox[2]!, 0.0001)) * 100}% ${(bbox[1]! / Math.max(1 - bbox[3]!, 0.0001)) * 100}%` }}
                  />
                ) : (
                  <div className="crop text">{l.serialNo != null ? `${l.serialNo}. ` : ''}{l.rawName}   {qty(l.qtyMilli)}   {l.lineTotalPaisa != null ? rs(l.lineTotalPaisa).replace('Rs ', '') : ''}</div>
                )}
                <div className="row">
                  <span className="nm grow">{l.product?.name ?? l.rawName}</span>
                  {stop ? <span className="tag t-bad">{t.short}</span> : !l.product ? <span className="tag t-new">{l.flags.includes('PICK_PRODUCT') ? t.pick : t.newP}</span> : l.flags.includes('LOW_CONFIDENCE') ? <span className="tag t-warn">{t.doubt}</span> : <span className="tag t-ok">{l.matchStatus === 'manual' ? t.fixed : t.match}</span>}
                </div>
                <div className="r2"><span className="n">{qty(l.qtyMilli)} {l.unit ?? ''} × {rs(l.ratePaisa)}</span><span className="n" style={{ color: 'var(--fg)', fontWeight: 600 }}>{rs(l.amountPaisa)}</span></div>
                {msgs.length > 0 && <div className={`msg ${stop ? 'red' : ''}`}>{msgs.join(' · ')}</div>}
              </button>
            );
          })}
        </div>
        <button className="cta sec" onClick={() => setEditing({ index: null, line: { rawName: '', qtyMilli: null, unit: null, ratePaisa: null, product: null, page: 1 } })}><Icon name="plus" /> {t.addLine}</button>

        <div className="card total">
          <span>{t.sumLines}</span><span className="n">{rs(total)}</span>
          {scan.readTotalPaisa != null && <><span>{t.sumPaper}</span><span className="n">{rs(scan.readTotalPaisa)}</span></>}
          {scan.readTotalPaisa != null && <span style={{ gridColumn: '1/-1' }} className={Math.abs(scan.readTotalPaisa - total) <= 100 ? 'green' : 'red'}>{Math.abs(scan.readTotalPaisa - total) <= 100 ? `✓ ${t.sumOk}` : t.totalMismatch}</span>}
        </div>

        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2 className="h3">{t.payment}</h2>
          <PayModes value={mode} onChange={setMode} />
          <label className="f">
            <span>{kind === 'SALE' ? t.received : t.paidNow}</span>
            <input className="in num" inputMode="decimal" value={received ?? (kind === 'SALE' ? String(total / 100) : '')} placeholder="0" onChange={(e) => setReceived(e.target.value)} />
          </label>
          {credit && <div className={`banner ${party ? 'warn' : 'bad'}`}>{t.udhaar}: {rs(total - receivedPaisa)}{!party ? ` — ${t.customer}?` : ''}</div>}
        </div>
      </main>
      <div className="dock">
        <div className="note">{blockers ? t.needN(blockers) : `✓ ${t.ready}`}</div>
        <button className="cta" disabled={blockers > 0 || busy || scan.lines.length === 0 || (credit && !party)} onClick={confirm}>{busy ? '…' : kind === 'PURCHASE' ? t.confirmIn : t.confirmOut}</button>
      </div>
      {editing && (
        <LineSheet
          kind={kind}
          written
          line={editing.line}
          onClose={() => setEditing(null)}
          onRemove={editing.index != null ? () => { save(scan.lines.map(toEdit).filter((_: unknown, i: number) => i !== editing.index)); setEditing(null); } : undefined}
          onSave={(l) => {
            const lines = scan.lines.map(toEdit);
            if (editing.index == null) lines.push(l);
            else lines[editing.index] = l;
            save(lines);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

const confirm_ = (q: string) => window.confirm(q);
