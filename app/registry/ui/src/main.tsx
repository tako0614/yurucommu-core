import { render } from 'solid-js/web';
import { createSignal, onMount } from 'solid-js';
import './style.css';

async function req(path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    let data: any = null;
    try { data = await res.json(); } catch {}
    alert(data?.error || res.statusText);
    throw new Error('request failed');
  }
  return res.json();
}

const App = () => {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [authed, setAuthed] = createSignal(false);
  const [domains, setDomains] = createSignal<{name:string; verified:boolean}[]>([]);
  const [domainToken, setDomainToken] = createSignal('');
  const [packages, setPackages] = createSignal<any[]>([]);

  const login = async () => {
    await req('/api/login', 'POST', { email: email(), password: password() });
    setAuthed(true);
    refreshDomains();
    refreshPackages();
  };

  const registerAccount = async () => {
    await req('/api/register', 'POST', { email: email(), password: password() });
    alert('Check email for verification');
  };

  const refreshDomains = async () => {
    const data = await req('/api/domains');
    setDomains(data.domains);
  };

  const requestDomain = async (domain: string) => {
    const data = await req('/api/domains/request', 'POST', { domain });
    setDomainToken('token: ' + data.token);
    refreshDomains();
  };

  const refreshPackages = async () => {
    const data = await req('/_takopack/search');
    setPackages(data.packages);
  };

  const addPackage = async (pkg: Record<string, unknown>) => {
    await req('/api/packages', 'POST', pkg);
    refreshPackages();
  };

  let domainInput!: HTMLInputElement;
  let pkgIdentifier!: HTMLInputElement;
  let pkgName!: HTMLInputElement;
  let pkgVersion!: HTMLInputElement;
  let pkgDesc!: HTMLInputElement;
  let pkgUrl!: HTMLInputElement;
  let pkgSha!: HTMLInputElement;

  return (
    <div class="p-4">
      <h1 class="text-2xl font-bold mb-4">Takopack Registry 管理</h1>
      <div class={authed() ? 'hidden' : ''}>
        <h2 class="text-xl mb-2">ログイン/登録</h2>
        <input class="border p-1 mr-2" placeholder="email" value={email()} onInput={e => setEmail(e.currentTarget.value)} />
        <input class="border p-1 mr-2" type="password" placeholder="password" value={password()} onInput={e => setPassword(e.currentTarget.value)} />
        <button class="px-2 py-1 bg-blue-500 text-white mr-2" onClick={login}>Login</button>
        <button class="px-2 py-1 bg-gray-500 text-white" onClick={registerAccount}>Register</button>
      </div>
      <div class={authed() ? 'mt-4' : 'hidden'}>
        <h2 class="text-xl mb-2">Domains</h2>
        <ul class="mb-2">
          {domains().map(d => (
            <li>{d.name}{d.verified ? ' ✅' : ' ❌'}</li>
          ))}
        </ul>
        <input class="border p-1 mr-2" ref={domainInput!} placeholder="example.com" />
        <button class="px-2 py-1 bg-blue-500 text-white mr-2" onClick={() => requestDomain(domainInput.value)}>Request</button>
        <span class="mr-2">{domainToken()}</span>
        <button class="px-2 py-1 bg-gray-500 text-white" onClick={refreshDomains}>Refresh</button>
      </div>
      <div class={authed() ? 'mt-4' : 'hidden'}>
        <h2 class="text-xl mb-2">Packages</h2>
        <ul class="mb-2">
          {packages().map(p => (
            <li>{p.identifier} {p.version}</li>
          ))}
        </ul>
        <button class="px-2 py-1 bg-gray-500 text-white mb-2" onClick={refreshPackages}>Refresh</button>
        <h3 class="text-lg mt-2">Add</h3>
        <input class="border p-1 mr-2" ref={pkgIdentifier!} placeholder="com.example.foo" />
        <input class="border p-1 mr-2" ref={pkgName!} placeholder="name" />
        <input class="border p-1 mr-2" ref={pkgVersion!} placeholder="1.0.0" />
        <input class="border p-1 mr-2" ref={pkgDesc!} placeholder="description" />
        <input class="border p-1 mr-2" ref={pkgUrl!} placeholder="download url" />
        <input class="border p-1 mr-2" ref={pkgSha!} placeholder="sha256(optional)" />
        <button class="px-2 py-1 bg-blue-500 text-white" onClick={() => addPackage({
          identifier: pkgIdentifier.value,
          name: pkgName.value,
          version: pkgVersion.value,
          description: pkgDesc.value,
          downloadUrl: pkgUrl.value,
          sha256: pkgSha.value || undefined,
        })}>Add Package</button>
      </div>
    </div>
  );
};

render(() => <App />, document.getElementById('app')!);
