import { useEffect, useMemo, useState } from 'react';
import { resume, setLogoutHandler, type Me } from './api';
import { watchQueue } from './offline-queue';
import { DICTS, LangContext, type Lang } from './i18n';
import { AiSettings } from './screens/AiSettings';
import { Day } from './screens/Day';
import { Doc } from './screens/Doc';
import { Home } from './screens/Home';
import { LedgerList, PartyView } from './screens/Ledger';
import { Login } from './screens/Login';
import { PlatformAdmin } from './screens/PlatformAdmin';
import { Setup } from './screens/Setup';
import { Signup } from './screens/Signup';
import { Manual } from './screens/Manual';
import { Month, More, Settings, Users } from './screens/More';
import { ScanNew, ScanView } from './screens/Scan';
import { OpeningImport, ProductView, StockList } from './screens/Stock';
import { AppCtx, Loading, SideNav, useRoute, useToast, type Route } from './ui';

const LANG_KEY = 'erp.lang';
function savedLang(): Lang {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return l === 'en' ? 'en' : 'ur';
  } catch {
    return 'ur';
  }
}

function Screen({ r }: { r: Route }) {
  const [a, b] = r.parts;
  const type = r.query.get('type') === 'PURCHASE' ? 'PURCHASE' : 'SALE';
  switch (a) {
    case 'scan':
      return b === 'new' || !b ? <ScanNew type={type} /> : <ScanView id={b} />;
    case 'doc':
      return <Doc id={b!} isNew={r.query.get('new') === '1'} />;
    case 'manual':
      return <Manual type={type} />;
    case 'stock':
      return b ? <ProductView id={b} /> : <StockList lowOnly={r.query.get('low') === '1'} />;
    case 'ledger':
      return b ? <PartyView id={b} /> : <LedgerList />;
    case 'day':
      return <Day date={r.query.get('date') ?? undefined} />;
    case 'more':
      return <More />;
    case 'month':
      return <Month />;
    case 'users':
      return <Users />;
    case 'settings':
      return <Settings />;
    case 'ai':
      return <AiSettings />;
    case 'opening':
      return <OpeningImport />;
    default:
      return <Home />;
  }
}

export function App() {
  const [lang, setLangState] = useState<Lang>(savedLang);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [toastMsg, toast] = useToast();
  // FR-SCAN-07: scans waiting on this phone for the internet
  const [queued, setQueued] = useState(0);
  const [needsSetup, setNeedsSetup] = useState(false);
  // Online version: new shops can ask for an account (approved by QSSols)
  const [signupOn, setSignupOn] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const route = useRoute();

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    setLogoutHandler(() => setMe(null));
    resume().then(setMe).catch(() => setMe(null));
    // Desktop first run: no shop yet, so show the setup screen instead of the login
    fetch('/api/setup').then((r) => (r.ok ? r.json() : null)).then((j) => setNeedsSetup(!!j?.needed)).catch(() => setNeedsSetup(false));
    fetch('/api/signup').then((r) => (r.ok ? r.json() : null)).then((j) => setSignupOn(!!j?.enabled)).catch(() => setSignupOn(false));
  }, []);

  useEffect(() => {
    if (!me) return;
    return watchQueue(setQueued, (n) => toast(DICTS[lang].queueSent(n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const langValue = useMemo(() => ({ lang, t: DICTS[lang], setLang }), [lang]);
  return (
    <LangContext.Provider value={langValue}>
      <div className="app" dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang}>
        {route.parts[0] === 'qssols-admin' ? (
          <PlatformAdmin />
        ) : me === undefined ? (
          <Loading />
        ) : me === null ? (
          needsSetup ? (
            <Setup onDone={(m) => { setNeedsSetup(false); setMe(m); }} />
          ) : signingUp ? (
            <Signup onBack={() => setSigningUp(false)} />
          ) : (
            <Login onDone={setMe} onSignup={signupOn ? () => setSigningUp(true) : undefined} />
          )
        ) : (
          <AppCtx.Provider value={{ me, toast, setMe }}>
            {queued > 0 && <div className="banner warn" role="status" style={{ margin: '8px 16px 0' }}>{DICTS[lang].queueWaiting(queued)}</div>}
            <SideNav route={route} />
            <Screen r={route} />
          </AppCtx.Provider>
        )}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </LangContext.Provider>
  );
}
