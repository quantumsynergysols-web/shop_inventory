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
import { Manual } from './screens/Manual';
import { Month, More, Settings, Users } from './screens/More';
import { ScanNew, ScanView } from './screens/Scan';
import { OpeningImport, ProductView, StockList } from './screens/Stock';
import { AppCtx, Loading, useRoute, useToast, type Route } from './ui';

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
        {me === undefined ? (
          <Loading />
        ) : me === null ? (
          <Login onDone={setMe} />
        ) : (
          <AppCtx.Provider value={{ me, toast, setMe }}>
            {queued > 0 && <div className="banner warn" role="status" style={{ margin: '8px 16px 0' }}>{DICTS[lang].queueWaiting(queued)}</div>}
            <Screen r={route} />
          </AppCtx.Provider>
        )}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </LangContext.Provider>
  );
}
