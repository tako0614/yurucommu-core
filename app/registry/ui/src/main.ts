async function req(path: string, method = 'GET', body?: unknown){
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if(!res.ok){
    let data: any = null;
    try{ data = await res.json(); }catch{}
    alert(data?.error || res.statusText);
    throw new Error('request failed');
  }
  return res.json();
}
async function login(){
  await req('/api/login','POST',{email: email.value, password: password.value});
  auth.style.display='none';
  domains.style.display='block';
  packages.style.display='block';
  refreshDomains();
  refreshPackages();
}
async function registerAccount(){
  await req('/api/register','POST',{email: email.value, password: password.value});
  alert('Check email for verification');
}
async function refreshDomains(){
  const data = await req('/api/domains');
  domainList.innerHTML='';
  data.domains.forEach((d: any)=>{
    const li=document.createElement('li');
    li.textContent=d.name+(d.verified?' ✅':' ❌');
    domainList.appendChild(li);
  });
}
async function requestDomain(){
  const data = await req('/api/domains/request','POST',{domain: domainInput.value});
  domainToken.textContent='token: '+data.token;
  refreshDomains();
}
async function refreshPackages(){
  const data = await req('/_takopack/search');
  packageList.innerHTML='';
  data.packages.forEach((p: any)=>{
    const li=document.createElement('li');
    li.textContent=p.identifier+' '+p.version;
    packageList.appendChild(li);
  });
}
async function addPackage(){
  await req('/api/packages','POST',{
    identifier: pkgIdentifier.value,
    name: pkgName.value,
    version: pkgVersion.value,
    description: pkgDesc.value,
    downloadUrl: pkgUrl.value,
    sha256: pkgSha.value || undefined,
  });
  refreshPackages();
}
(document.getElementById('loginBtn') as HTMLButtonElement).onclick=login;
(document.getElementById('registerBtn') as HTMLButtonElement).onclick=registerAccount;
(document.getElementById('refreshDomainsBtn') as HTMLButtonElement).onclick=refreshDomains;
(document.getElementById('requestDomainBtn') as HTMLButtonElement).onclick=requestDomain;
(document.getElementById('refreshPackagesBtn') as HTMLButtonElement).onclick=refreshPackages;
(document.getElementById('addPackageBtn') as HTMLButtonElement).onclick=addPackage;
const email = document.getElementById('email') as HTMLInputElement;
const password = document.getElementById('password') as HTMLInputElement;
const auth = document.getElementById('auth') as HTMLElement;
const domains = document.getElementById('domains') as HTMLElement;
const packages = document.getElementById('packages') as HTMLElement;
const domainInput = document.getElementById('domainInput') as HTMLInputElement;
const domainList = document.getElementById('domainList') as HTMLElement;
const domainToken = document.getElementById('domainToken') as HTMLElement;
const refreshDomainsBtn = document.getElementById('refreshDomainsBtn') as HTMLButtonElement;
const requestDomainBtn = document.getElementById('requestDomainBtn') as HTMLButtonElement;
const pkgIdentifier = document.getElementById('pkgIdentifier') as HTMLInputElement;
const pkgName = document.getElementById('pkgName') as HTMLInputElement;
const pkgVersion = document.getElementById('pkgVersion') as HTMLInputElement;
const pkgDesc = document.getElementById('pkgDesc') as HTMLInputElement;
const pkgUrl = document.getElementById('pkgUrl') as HTMLInputElement;
const pkgSha = document.getElementById('pkgSha') as HTMLInputElement;
const packageList = document.getElementById('packageList') as HTMLElement;
const refreshPackagesBtn = document.getElementById('refreshPackagesBtn') as HTMLButtonElement;
const addPackageBtn = document.getElementById('addPackageBtn') as HTMLButtonElement;
