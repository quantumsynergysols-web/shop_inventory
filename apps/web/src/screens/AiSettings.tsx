import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import { date } from '../format';
import { useT } from '../i18n';
import { ErrorBox, Loading, Top, useApp, useLoad } from '../ui';

type Mode = 'hosted' | 'openai' | 'gemini' | 'off';

/** FR-SET-02 (provider, own key masked, model, threshold, test), FR-AI-10/15 (usage), FR-AI-16 (consent, retention). Owner only. */
export function AiSettings() {
  const { t } = useT();
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => get('/settings/ai'), []);
  const [f, setF] = useState<{ mode: Mode; model: string; apiKey: string; threshold: string; retention: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; ms?: number; error?: string } | null>(null);
  useEffect(() => {
    if (data) setF({ mode: data.mode, model: data.model ?? '', apiKey: '', threshold: String(data.confidenceThreshold), retention: String(data.photoRetentionDays) });
  }, [data]);
  if (error) return <><Top title={t.aiSettings} backTo="/more" /><div className="body"><ErrorBox error={error} retry={reload} /></div></>;
  if (!data || !f) return <Loading />;

  const own = f.mode === 'openai' || f.mode === 'gemini';
  const keyNeeded = own && !f.apiKey.trim() && !(data.keyLast4 && data.mode === f.mode);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await put('/settings/ai', {
        mode: f.mode,
        model: own ? f.model.trim() || null : null,
        ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}),
        confidenceThreshold: Number(f.threshold),
        photoRetentionDays: Number(f.retention),
      });
      toast(t.saved);
      setTest(null);
      reload();
    });
  const testIt = () =>
    run(async () => {
      setTest(null);
      setTest(await post('/settings/ai/test', { mode: f.mode, ...(own && f.model.trim() ? { model: f.model.trim() } : {}), ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}) }));
    });
  const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000_000 ? 3 : 2)}`;
  const modes: [Mode, string][] = [['hosted', t.aiHosted], ['openai', t.aiOwnOpenai], ['gemini', t.aiOwnGemini], ['off', t.aiOff]];

  return (
    <>
      <Top title={t.aiSettings} backTo="/more" />
      <main className="body">
        <div className={`card ${data.consentAt ? '' : 'warnbox'}`} style={{ display: 'grid', gap: 8 }}>
          <h2 className="h3">{t.consentTitle}</h2>
          <div className="label">{t.consentText}</div>
          {data.consentAt ? (
            <>
              <div className="green">{t.consentGiven(date(data.consentAt))}</div>
              <button className="link red" disabled={busy} onClick={() => run(async () => { await post('/settings/ai/consent/withdraw'); reload(); })}>{t.consentWithdraw}</button>
            </>
          ) : (
            <button className="cta" disabled={busy} onClick={() => run(async () => { await post('/settings/ai/consent', { agree: true }); reload(); })}>{t.consentGive}</button>
          )}
        </div>

        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2 className="h3">{t.aiMode}</h2>
          <div className="list" role="radiogroup" aria-label={t.aiMode}>
            {modes.map(([m, label]) => (
              <label key={m} className="item" style={{ cursor: 'pointer' }}>
                <input type="radio" name="ai-mode" checked={f.mode === m} onChange={() => { setF({ ...f, mode: m, apiKey: '' }); setTest(null); }} />
                <span className="grow"><b>{label}</b></span>
              </label>
            ))}
          </div>
          {f.mode === 'hosted' && !data.hostedAvailable && <div className="banner warn">{t.noHosted}</div>}
          {own && (
            <>
              {!data.canStoreKeys && <div className="banner warn">{t.noKeySecret}</div>}
              <label className="f">
                <span>{t.apiKey}</span>
                <input className="in ltr" type="password" autoComplete="off" spellCheck={false} value={f.apiKey} placeholder={data.keyLast4 && data.mode === f.mode ? t.keySaved(data.keyLast4) : f.mode === 'openai' ? 'sk-…' : 'AIza…'} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
              </label>
              {data.keyLast4 && data.mode === f.mode && <div className="label">{t.keyNew}</div>}
              <label className="f">
                <span>{t.model}</span>
                <input className="in ltr" value={f.model} placeholder={data.defaultModels[f.mode]} onChange={(e) => setF({ ...f, model: e.target.value })} />
              </label>
            </>
          )}
          <div className="fields">
            <label className="f"><span>{t.threshold}</span><input className="in num" inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} /></label>
            <label className="f"><span>{t.retention}</span><input className="in num" inputMode="numeric" value={f.retention} onChange={(e) => setF({ ...f, retention: e.target.value })} /></label>
          </div>
          {f.mode !== 'off' && (
            <button className="cta sec" disabled={busy || keyNeeded || (f.mode === 'hosted' && !data.hostedAvailable)} onClick={testIt}>{t.testConn}</button>
          )}
          {test && <div className={`banner ${test.ok ? 'ok' : 'bad'}`}>{test.ok ? t.testOk(test.ms ?? 0) : test.error}</div>}
          <button className="cta" disabled={busy || keyNeeded} onClick={save}>{t.save}</button>
        </div>

        <div className="card">
          <h2 className="h3">{t.aiUsage}</h2>
          {data.usage.mode === 'hosted' && <div className="rw"><span>{t.aiHosted}</span><span className="n">{t.scansUsed(data.usage.usedThisMonth, data.usage.quota)}</span></div>}
          <div className="rw"><span>{t.aiCost}</span><span className="n">{usd(data.usage.costThisMonthMicroUsd)}</span></div>
        </div>
      </main>
    </>
  );
}
