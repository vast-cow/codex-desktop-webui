/** Replaces only the desktop account provider in the generated browser copy. */
export function standaloneAuth(_module: any, exports: any, require: any) {
  const React = require('zd8w'), { jsx, jsxs } = require('ABep');
  const context = require('O0M0').c;
  const services = require('GaA7');
  function Provider({ children }: any) {
    const [snapshot, setSnapshot] = React.useState({ status: 'acquiring', revision: -1, authMethod: null, requiresOpenaiAuth: null });
    React.useEffect(() => {
      let active = true, lease: any;
      const subscription = services.appServices.codexAccount.subscribe((next: any) => {
        if (active) setSnapshot((previous: any) => next.revision > previous.revision ? next : previous);
      });
      subscription.then((value: any) => { if (active) lease = value; else value[Symbol.dispose](); }, () => {
        if (active) setSnapshot((previous: any) => ({ ...previous, status: 'connection-unavailable', authMethod: null, account: null }));
      });
      return () => { active = false; lease?.[Symbol.dispose](); subscription[Symbol.dispose](); };
    }, []);
    const accountBoundary = React.useContext(require('HsGx').iL);
    React.useLayoutEffect(() => {
      if (snapshot.status !== 'acquiring') accountBoundary?.setAccount(JSON.stringify([snapshot.authMethod, null, null, null]));
    }, [snapshot.status, snapshot.authMethod, accountBoundary]);
    const store = require('zTeN').gh(require('OWtl').u);
    const cloud = require('SPnB');
    const access = require('eFn4');
    React.useLayoutEffect(() => {
      store.set(access.standaloneAccount$, snapshot);
      if (location.pathname === '/' || location.pathname === '/standalone.html' || location.pathname === '/index.html') require('T8X0').Ct(store, 'codex');
      store.set(cloud.PO, (previous: any) => ({ ...previous,
        hasChatGptToken: undefined, accountStructure: null, accountUserId: null,
        accountId: null, authenticatedAccountId: null, authenticatedUserId: null, userId: null,
        authMethod: snapshot.authMethod, authLoading: snapshot.status === 'acquiring',
        accountLoading: false, supportedSurface: false, email: null, plan: null }));
      store.set(require('eFn4').$S, { accountId: null, authMethod: snapshot.authMethod,
        authLoading: snapshot.status === 'acquiring', accountInfoLoading: false,
        supportedSurface: false, workCloudSupportedSurface: false, plan: null });
    }, [store, snapshot.revision]);
    const loading = snapshot.status === 'acquiring';
    const acquired = snapshot.status === 'acquired';
    const auth = { isLoading: loading, authMethod: snapshot.authMethod, openAIAuth: snapshot.authMethod,
      requiresAuth: snapshot.requiresOpenaiAuth !== false, isCopilotApiAvailable: false,
      accountId: null, userId: null, email: null, planAtLogin: snapshot.account?.planType ?? null,
      retryAccountVerification: null };
    return jsxs(context.Provider, { value: auth, children: [
      !acquired && jsx('div', { role: 'status', 'data-webui-account-status': snapshot.status,
        children: loading ? 'Acquiring Codex account status…' : `Codex account: ${snapshot.status}. Server requests may fail; check the connection or authenticate with the existing app server.` }), children] });
  }
  require.d(exports, { O: () => Provider });
}
