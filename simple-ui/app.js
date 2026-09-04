// Simple Obscura VPN GUI - vanilla JS (English)
async function invoke(cmd, args = {}) {
  const json = JSON.stringify({ [cmd]: args });
  if (cmd !== 'jsonFfiCmd') console.log('[invoke]', cmd, args);
  const res = await window.webkit.messageHandlers.commandBridge.postMessage(json);
  return JSON.parse(res);
}
async function ffi(cmd, arg = {}, timeoutMs = 10000) {
  const inner = JSON.stringify({ [cmd]: arg });
  return invoke('jsonFfiCmd', { cmd: inner, timeoutMs });
}
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
function rawChecksum(d){ return d.split("").reduceRight((acc,ch,i)=> D[acc][P[(d.length-1-i)%8][+ch]],0); }
function checkDigit(d){ return INV[rawChecksum(d+"0")]; }
function validChecksum(d){ return rawChecksum(d)===0; }
function normalizeAccountId(s){ return s.replace(/[^\d]/g,""); }
function formatPartial(id){
  id = normalizeAccountId(id);
  if(id.length>=20) return `${id.slice(0,4)} - ${id.slice(4,8)} - ${id.slice(8,12)} - ${id.slice(12,16)} - ${id.slice(16)}`;
  return id.replace(/.{4}(?=.)/g,"$& - ");
}
function generateAccountNumber(){
  const len=19; const max= 10n ** 19n;
  while(true){
    const arr=new BigUint64Array(1); crypto.getRandomValues(arr);
    if(arr[0] < max){ const base=arr[0].toString().padStart(len,"0"); return base+String(checkDigit(base)); }
  }
}
let osStatus=null, appStatus=null, accountInfo=null, exitList=[], traffic=null;
let osVersion=null, exitVersion=null, selectedCity=null, accountRevealed=false, devClicks=0;
let expandedCountries=new Set();
const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);
// Pixel footer: gray squares that fill orange bottom-up on VPN connect.
let pixelCells=[], pixelFillOrder=[], pixelTimer=null, lastPixelState="";
function pixelRand(seed){ let t=seed+0x6D2B79F5; return function(){ t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function buildPixelGrid(){
  const grid=$("#pixelGrid"); if(!grid || pixelCells.length) return;
  const ROWS=5, COLS=40, DENSITY=[0.20,0.35,0.60,0.80,0.95];
  const rand=pixelRand(1337);
  const byRow=[[],[],[],[],[]];
  for(let r=0;r<ROWS;r++){
    for(let c=0;c<COLS;c++){
      const div=document.createElement("div");
      if(rand()<DENSITY[r]){ div.className="pixel"; byRow[r].push(div); }
      else { div.className="pixel empty"; }
      grid.appendChild(div);
      pixelCells.push(div);
    }
  }
  // Fill order bottom-up; shuffle lightly within each row for organic feel.
  const shuffle=pixelRand(777);
  for(let r=ROWS-1;r>=0;r--){
    const row=byRow[r];
    for(let i=row.length-1;i>0;i--){ const j=Math.floor(shuffle()*(i+1)); [row[i],row[j]]=[row[j],row[i]]; }
    pixelFillOrder.push(...row);
  }
}
function pixelSetAll(on){ pixelCells.forEach(el=>{ if(!el.classList.contains("empty")) el.classList.toggle("on",on); }); }
function renderPixelFooter(isConnected, isConnecting){
  const state=isConnected?"connected":isConnecting?"connecting":"disconnected";
  if(state===lastPixelState) return;
  lastPixelState=state;
  if(pixelTimer){ clearInterval(pixelTimer); pixelTimer=null; }
  if(!pixelCells.length) return;
  const reduced=window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(state==="connected" || (state==="connecting" && reduced)){ pixelSetAll(true); return; }
  if(state==="disconnected"){ pixelSetAll(false); return; }
  // connecting: progressive bottom-up fill over ~2s
  pixelSetAll(false);
  let idx=0;
  const step=Math.max(1, Math.ceil(pixelFillOrder.length/20));
  pixelTimer=setInterval(()=>{
    for(let k=0;k<step && idx<pixelFillOrder.length;k++,idx++) pixelFillOrder[idx].classList.add("on");
    if(idx>=pixelFillOrder.length){ clearInterval(pixelTimer); pixelTimer=null; }
  },100);
}
function toast(msg, ms=3000){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"), ms); }
const VIEWS=["connection","location","account","settings","help","about","developer"];
function isValidView(v){ return VIEWS.includes(v); }
function setTopNavVisible(visible){ const nav=$("#nav"); if(nav) nav.style.display=visible?"":"none"; }
function syncHashToView(name){
  if(!isValidView(name)) return;
  try{
    if(location.hash !== "#"+name) history.replaceState(null,"","#"+name);
  }catch(e){}
}
function showViewLocal(name){
  $$(".view").forEach(v=>v.classList.add("hidden"));
  const el=$("#view-"+name); if(el) el.classList.remove("hidden");
  $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.view===name));
}
function showView(name){
  showViewLocal(name);
  // Transient views mirror the native sidebar (hidden): no backend sync, no hash.
  if(name==="splash"||name==="degraded"||name==="login"){ setTopNavVisible(false); return; }
  setTopNavVisible(true);
  if(!isValidView(name)) return;
  syncHashToView(name);
  // Backend (osStatus.navigationView) is the source of truth, like the React UI.
  // Only push when it differs to avoid loops; the long-poll will confirm.
  if(osStatus && osStatus.navigationView !== name){
    invoke('setNavigationView',{view:name}).catch(()=>{});
  }
}
// Optimistic navigation from top bar / help button / back-forward.
// Shows instantly and pushes to backend; the osStatus long-poll then confirms
// and the native left sidebar follows automatically.
function requestNavigation(name){
  if(!isValidView(name)) return;
  if(osStatus && osStatus.navigationView === name){
    showViewLocal(name); setTopNavVisible(true); syncHashToView(name); return;
  }
  showView(name);
}
let initialNavSynced=false;
function latestAppStatus(serviceStatus){
  if(!serviceStatus || serviceStatus==="initializing") return undefined;
  if(serviceStatus.healthy) return serviceStatus.healthy;
  return serviceStatus.degraded?.lastStatus || undefined;
}
function vpnConnected(vpnStatus){ return !!vpnStatus?.connected; }
function getCityFromStatus(vpnStatus){
  const args = vpnStatus?.connected?.tunnelArgs ?? vpnStatus?.connecting?.tunnelArgs;
  if(args && args.exit && args.exit.city) return args.exit.city;
  return undefined;
}
function render(){
  if(!osStatus){ showView("splash"); return; }
  const serviceStatus=osStatus.serviceStatus;
  if(typeof serviceStatus === 'string' && serviceStatus==="initializing"){
    $("#splashDetail").textContent="Initializing service..."; showView("splash"); return;
  }
  if(serviceStatus?.degraded){
    const deg=serviceStatus.degraded.linuxDegradation || serviceStatus.degraded.windowsDegradation || "unknown";
    let msg="Service degraded"; let detail=JSON.stringify(deg);
    if(typeof deg==="string"){
      if(deg==="unitInactive") msg="Service inactive";
      else if(deg==="unitActivating"){ msg="Service starting..."; detail=`${JSON.stringify(deg)} — if stuck >30s, service is crash-looping. Run: journalctl -u obscura.service -n 50 --no-pager (common: missing libtss2-tctildr0t64)`; }
      else if(deg==="unitNotInstalled") msg="Service not installed";
      else if(deg==="unknown") msg="Unknown error";
    } else if(deg.socketPermissionDenied){
      msg="Socket permission denied"; detail=`User ${deg.socketPermissionDenied.user || ""} is not in obscura group`;
    } else if(deg.versionMismatch){
      msg="Version mismatch"; detail=`App ${deg.versionMismatch.appVersion} vs Service ${deg.versionMismatch.serviceVersion}`;
    }
    $("#degradedMsg").textContent=msg; $("#degradedDetail").textContent=detail; showView("degraded"); return;
  }
  appStatus = latestAppStatus(serviceStatus);
  if(!appStatus){ $("#splashDetail").textContent="Loading status..."; showView("splash"); return; }
  $("#appVersion").textContent = osStatus.srcVersion || appStatus.version || "v1.177";
  if(!appStatus.accountId || appStatus.inNewAccountFlow){ renderLogin(); showView("login"); return; }
  // Backend is the source of truth so the native left sidebar and the web
  // top bar stay in sync (same as React `<Routes location={osStatus.navigationView}>`).
  // `location.hash` is only a mirror for refresh/deep-link, never overrides backend.
  const hash = location.hash.replace("#","");
  const backendView = isValidView(osStatus.navigationView) ? osStatus.navigationView : "connection";
  if(!initialNavSynced && isValidView(hash) && hash !== backendView){
    // Honor refresh/deep-link once: push it to backend, show optimistically.
    initialNavSynced=true;
    renderConnection(); renderLocation(); renderAccount(); renderSettings();
    showView(hash);
    $("#devOsStatus").textContent = JSON.stringify(osStatus,null,2);
    $("#devAppStatus").textContent = JSON.stringify(appStatus,null,2);
    return;
  }
  initialNavSynced=true;
  const view = backendView;
  renderConnection(); renderLocation(); renderAccount(); renderSettings();
  showView(view);
  $("#devOsStatus").textContent = JSON.stringify(osStatus,null,2);
  $("#devAppStatus").textContent = JSON.stringify(appStatus,null,2);
}
function renderLogin(){
  const hasGenerated = window._generatedAccount;
  if(hasGenerated){
    $("#loginTitle").textContent="Account created!"; $("#loginSubtitle").textContent="Copy your number securely and proceed to payment.";
    $("#loginCreateBox").classList.add("hidden"); $("#loginGeneratedBox").classList.remove("hidden");
    $("#generatedNumber").textContent = formatPartial(hasGenerated);
    $("#payLink").href = `https://obscura.com/pay#account_id=${encodeURIComponent(hasGenerated)}`;
    $("#accountInput").value = formatPartial(hasGenerated);
  } else {
    $("#loginTitle").textContent="Welcome to Obscura"; $("#loginSubtitle").textContent="Create an account or sign in with your existing number.";
    $("#loginCreateBox").classList.remove("hidden"); $("#loginGeneratedBox").classList.add("hidden");
  }
  $("#aboutVersion").textContent = osStatus?.srcVersion || "v1.177";
}
function renderConnection(){
  const vpnStatus=appStatus.vpnStatus; const isConnected=vpnConnected(vpnStatus); const isConnecting=!!vpnStatus.connecting;
  const connectingCity=getCityFromStatus(vpnStatus); const lastCity = appStatus.lastChosenExit?.city; const targetCity = connectingCity || lastCity;
  let title="Disconnected", subtitle="Connect to browse privately";
  if(!osStatus.internetAvailable){ title="No internet"; subtitle="Connect to the internet to use VPN"; }
  else if(appStatus.account && !appStatus.account.account_info.active){ title="Account expired"; subtitle="Renew to continue"; }
  else if(isConnected){ const exit=vpnStatus.connected.exit; title=`Connected to ${exit.city_name}`; subtitle=`${exit.country_code ? exit.country_code.toUpperCase() : ""} • ${exit.provider_id}`; }
  else if(isConnecting){ title= connectingCity ? `Connecting to ${connectingCity.city_code}` : "Connecting..."; subtitle="Establishing secure tunnel"; }
  $("#connTitle").textContent=title; $("#connSubtitle").textContent=subtitle;
  const dots=$$("#progressTrack .dot"); const lines=$$("#progressTrack .progress-line");
  dots.forEach(d=>d.className="dot"); lines.forEach(l=>l.className="progress-line");
  if(isConnected){ dots.forEach(d=>d.classList.add("connected")); lines.forEach(l=>l.classList.add("active")); }
  else if(isConnecting){ dots[0]?.classList.add("active"); dots[1]?.classList.add("active"); lines[0]?.classList.add("active"); }
  const quick=$("#btnQuickConnect"), cancel=$("#btnCancelConnect"), disc=$("#btnDisconnect"), disc2=$("#btnDisconnectCity");
  const offline=!osStatus.internetAvailable;
  if(isConnected){ quick.classList.add("hidden"); cancel.classList.add("hidden"); disc.classList.remove("hidden"); disc2.classList.remove("hidden"); }
  else if(isConnecting){ quick.classList.add("hidden"); disc.classList.add("hidden"); disc2.classList.add("hidden"); cancel.classList.remove("hidden"); }
  else { quick.classList.remove("hidden"); cancel.classList.add("hidden"); disc.classList.add("hidden"); disc2.classList.add("hidden"); quick.disabled = offline; }
  const sel=$("#citySelect"); const prevVal=sel.value; const exits=exitList; sel.innerHTML="";
  if(appStatus.pinnedLocations?.length){
    const og=document.createElement("optgroup"); og.label="Pinned";
    appStatus.pinnedLocations.forEach(p=>{
      const ex=exits.find(e=>e.city_code===p.city_code && e.country_code===p.country_code);
      if(ex){ const o=document.createElement("option"); o.value=`${ex.country_code}:${ex.city_code}`; o.textContent=`${ex.city_name}, ${ex.country_code.toUpperCase()}`; og.appendChild(o); }
    }); sel.appendChild(og);
  }
  const byCountry={}; exits.forEach(e=>{ if(!byCountry[e.country_code]) byCountry[e.country_code]=[]; byCountry[e.country_code].push(e); });
  Object.keys(byCountry).sort().forEach(cc=>{
    const og=document.createElement("optgroup"); og.label=cc.toUpperCase();
    byCountry[cc].sort((a,b)=>a.city_name.localeCompare(b.city_name)).forEach(e=>{
      const o=document.createElement("option"); o.value=`${e.country_code}:${e.city_code}`; o.textContent=`${e.city_name} (${e.city_code})`; og.appendChild(o);
    }); sel.appendChild(og);
  });
  if(prevVal && [...sel.options].some(o=>o.value===prevVal)) sel.value=prevVal;
  else if(targetCity) sel.value=`${targetCity.country_code}:${targetCity.city_code}`;
  else if(sel.options.length) sel.selectedIndex=0;
  $("#cityHint").textContent = isConnected ? `Connected via ${vpnStatus.connected.exit.city_name}` : targetCity ? `Last: ${targetCity.city_code}` : "";
  if(isConnected && traffic){
    $("#sessionCard").style.display="block";
    const mins=Math.floor(traffic.connectedMs/60000);
    $("#sessionInfo").textContent=`Session: ${mins} min • ↓ ${(traffic.rxBytes/1024/1024).toFixed(1)} MB • ↑ ${(traffic.txBytes/1024/1024).toFixed(1)} MB • ping ${traffic.latestLatencyMs||"-"} ms`;
  } else { $("#sessionCard").style.display="none"; }
  renderPixelFooter(isConnected, isConnecting);
}
function renderLocation(){
  const query=$("#locationSearch").value.toLowerCase(); const list=$("#locationList"); list.innerHTML="";
  const filtered=exitList.filter(e=> !query || e.city_name.toLowerCase().includes(query) || e.city_code.toLowerCase().includes(query) || e.country_code.toLowerCase().includes(query) || countryName(e.country_code).toLowerCase().includes(query));
  $("#locationStats").textContent=`${filtered.length} locations • ${exitList.length} total`;
  $("#locationTitle").textContent = query? `Results for "${query}"` : "Choose location";
  const lastCity=appStatus?.lastChosenExit?.city;
  const pinnedSet=new Set(appStatus.pinnedLocations.map(p=>`${p.country_code}:${p.city_code}`));
  const connectedCity=getCityFromStatus(appStatus.vpnStatus);
  const connectedKey=connectedCity? `${connectedCity.country_code}:${connectedCity.city_code}`: null;
  function cardFor(exit){
    const key=`${exit.country_code}:${exit.city_code}`; const isConnected=key===connectedKey; const isPinned=pinnedSet.has(key); const isLast=lastCity && `${lastCity.country_code}:${lastCity.city_code}`===key;
    const div=document.createElement("div"); div.className="exit-card"+(isConnected?" connected":"");
    div.innerHTML=`<div class="flag">${flagSvg(exit.country_code)}</div><div class="flex-1"><div style="font-weight:600">${exit.city_name} <span class="muted small">${exit.country_code.toUpperCase()}</span></div><div class="small muted">${exit.provider_id} • ${exit.city_code}</div></div><div style="display:flex;gap:6px;align-items:center">${isConnected?'<span class="badge success">Connected</span>':''}${isLast?'<span class="badge warning">Recent</span>':''}<button class="icon-btn pin-btn" title="${isPinned?'Unpin':'Pin'}">${pinSvg(isPinned)}</button></div>`;
    hydrateFlagImgs(div);
    div.addEventListener("click", (e)=>{
      if(e.target.closest(".pin-btn")){ togglePin(exit, isPinned); e.stopPropagation(); return; }
      connectCity(exit);
    }); return div;
  }
  if(lastCity && !query){
    const ex=exitList.find(e=>e.city_code===lastCity.city_code && e.country_code===lastCity.country_code);
    if(ex){ const h=document.createElement("h4"); h.textContent="Last used"; h.className="muted small"; list.appendChild(h); list.appendChild(cardFor(ex)); }
  }
  if(appStatus.pinnedLocations.length && !query){
    const h=document.createElement("h4"); h.textContent="Pinned"; h.className="muted small"; list.appendChild(h);
    appStatus.pinnedLocations.forEach(p=>{
      const ex=filtered.find(e=>e.city_code===p.city_code && e.country_code===p.country_code);
      if(ex) list.appendChild(cardFor(ex));
    });
  }
  const byCountry={}; filtered.forEach(e=>{ if(!byCountry[e.country_code]) byCountry[e.country_code]=[]; byCountry[e.country_code].push(e); });
  Object.keys(byCountry).sort((a,b)=> countryName(a).localeCompare(countryName(b))).forEach(cc=>{
    const servers=byCountry[cc].sort((a,b)=>a.city_name.localeCompare(b.city_name));
    const expanded=expandedCountries.has(cc);
    const group=document.createElement("div"); group.className="country-group";
    const header=document.createElement("button"); header.type="button"; header.className="country-header";
    header.setAttribute("aria-expanded", expanded ? "true" : "false");
    header.innerHTML=`<span class="flag">${flagSvg(cc)}</span><span class="country-name"></span><span class="count muted small">(${servers.length})</span><span class="chevron" aria-hidden="true">${chevronSvg()}</span>`;
    hydrateFlagImgs(header);
    header.querySelector(".country-name").textContent=countryName(cc);
    const body=document.createElement("div"); body.className="country-servers"+(expanded?"":" hidden");
    servers.forEach(e=> body.appendChild(cardFor(e)));
    header.addEventListener("click", ()=>{
      if(expandedCountries.has(cc)) expandedCountries.delete(cc); else expandedCountries.add(cc);
      const isOpen=expandedCountries.has(cc);
      header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      body.classList.toggle("hidden", !isOpen);
    });
    group.appendChild(header); group.appendChild(body); list.appendChild(group);
  });
  if(filtered.length===0){
    const d=document.createElement("div"); d.className="card"; d.textContent="No results. Try another term or refresh the list.";
    const btn=document.createElement("button"); btn.className="btn small"; btn.textContent="Refresh list"; btn.onclick=()=> ffi('refreshExitList',{freshness:0});
    d.appendChild(document.createElement("br")); d.appendChild(btn); list.appendChild(d);
  }
}
function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function flagBadge(cc){ const code=((cc||"?").toString().toUpperCase().slice(0,2)); return `<span class="flag-badge" aria-hidden="true">${escHtml(code)}</span>`; }
function flagSvg(cc){
  if(!cc || !/^[a-zA-Z]{2}$/.test(cc)) return flagBadge(cc);
  return `<img class="flag-img" src="./flags/${cc.toLowerCase()}.svg" alt="" data-cc="${escHtml(cc.toLowerCase())}" loading="lazy">`;
}
function hydrateFlagImgs(root){
  root.querySelectorAll("img.flag-img").forEach(img=>{
    img.addEventListener("error", ()=>{
      const s=document.createElement("span"); s.className="flag-badge"; s.setAttribute("aria-hidden","true");
      s.textContent=(img.getAttribute("data-cc")||"?").toUpperCase(); img.replaceWith(s);
    }, {once:true});
  });
}
function chevronSvg(){
  return `<svg class="chevron-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
}
function smallCheckSvg(){
  return `<svg class="inline-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>`;
}
function countryName(cc){
  if(!cc) return "";
  try{
    const lang="en";
    if(typeof Intl!=="undefined" && Intl.DisplayNames){
      if(!countryName._dn || countryName._lang!==lang){ countryName._dn=new Intl.DisplayNames([lang], {type:"region"}); countryName._lang=lang; }
      const name=countryName._dn.of(cc.toUpperCase());
      if(name && name!==cc.toUpperCase()) return name;
    }
  }catch(e){}
  return cc.toUpperCase();
}
function pinSvg(pinned){
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="${pinned?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
}
function cardSvg(){
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
}
function checkSvg(){
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/></svg>`;
}
async function togglePin(exit, isPinned){
  let pins=[...appStatus.pinnedLocations]; const key=`${exit.country_code}:${exit.city_code}`;
  if(isPinned) pins=pins.filter(p=> `${p.country_code}:${p.city_code}`!==key);
  else pins.push({country_code:exit.country_code, city_code:exit.city_code, pinned_at: Math.floor(Date.now()/1000)});
  try{ await ffi('setPinnedExits',{exits:pins}); toast(isPinned?"Unpinned":"Pinned"); }catch(e){ toast("Error: "+e.message); }
}
async function connectCity(exit){
  const sel={city:{country_code:exit.country_code, city_code:exit.city_code}};
  try{ toast(`Connecting to ${exit.city_name}...`); await invoke('startTunnel',{tunnelArgs:JSON.stringify({exit:sel})}); }catch(e){ toast("Error: "+e.message); }
}
function renderAccount(){
  const card=$("#accountStatusCard"); const info=accountInfo; let html="";
  if(!info){ html=`<h3>Status unavailable</h3><p class="muted">Could not load account data.</p><button class="btn small" onclick="pollAccountNow()">Refresh</button>`; }
  else if(!info.active){ html=`<div class="row gap"><span style="font-size:24px;display:inline-flex">${cardSvg()}</span><div><h3>Account expired</h3><p class="muted">Top up to reactivate.</p></div><span class="badge danger">Expired</span></div><button class="btn small" onclick="pollAccountNow()">Refresh</button>`; }
  else {
    const expiry=paidUntil(info); const isRenewing=!!(info.stripe_subscription || info.apple_subscription || info.google_subscription);
    const daysLeft=Math.floor((expiry - Date.now())/86400000); let heading="Active", badge="success", sub=`Expires on ${expiry.toLocaleDateString()}`;
    if(isRenewing) { heading="Subscription active"; sub=`Renews on ${expiry.toLocaleDateString()} • ${daysLeft} days`; }
    else if(daysLeft<3){ heading="Expires soon"; badge="danger"; sub=`${daysLeft} days remaining`; }
    else if(daysLeft<10){ heading="Expires soon"; badge="warning"; }
    html=`<div class="row gap"><span style="font-size:24px;display:inline-flex">${checkSvg()}</span><div><h3>${heading}</h3><p class="muted">${sub}</p></div><span class="badge ${badge}">${daysLeft}d</span></div><div class="row gap" style="margin-top:10px"><button class="btn small" onclick="pollAccountNow()">Refresh</button><a class="btn small primary" href="https://obscura.com/pay#account_id=${encodeURIComponent(appStatus.accountId)}" target="_blank">Manage payment</a></div>`;
  }
  card.innerHTML=html;
  const display=$("#accountNumberDisplay"); const raw=appStatus.accountId || "";
  display.textContent = accountRevealed ? formatPartial(raw) : "•••• - •••• - •••• - •••• - ••••";
  $("#manageTunnelsLink").href = `https://obscura.com/account/tunnels#account_id=${encodeURIComponent(raw)}`;
}
function paidUntil(info){ if(info.current_expiry) return new Date(info.current_expiry*1000); return new Date(Date.now()+30*86400000); }
function renderSettings(){
  if(!appStatus) return;
  $("#toggleAutoConnect").checked = !!appStatus.autoConnect;
  $("#toggleLocalNetwork").checked = !!appStatus.localNetworkAccess;
  const killSwitchAvailable = (appStatus.featureFlagKeys || []).includes("killSwitch");
  $("#experimentalSettings").classList.toggle("hidden", !killSwitchAvailable);
  $("#toggleKillSwitch").checked = appStatus.featureFlags?.killSwitch === true;
  $("#toggleLoginItem").checked = !!osStatus.loginItemStatus?.registered;
  const block=appStatus.dnsContentBlock || {};
  $$("#dnsBlockGrid input").forEach(cb=> cb.checked = !!block[cb.dataset.dns]);
  const mode = appStatus.useSystemDns ? "system" : "obscura";
  $$('input[name="dnsMode"]').forEach(r=> r.checked = r.value===mode);
}
document.addEventListener("DOMContentLoaded", ()=>{
  buildPixelGrid();
  $("#nav").addEventListener("click", e=>{ const btn=e.target.closest(".nav-btn"); if(btn) requestNavigation(btn.dataset.view); });
  // Back/forward or manual hash edit: push to backend, let long-poll confirm.
  // Own syncHashToView uses replaceState so it does not fire this.
  window.addEventListener("hashchange", ()=>{
    if(!osStatus) return;
    const h=location.hash.replace("#","");
    if(isValidView(h) && h!==osStatus.navigationView) requestNavigation(h);
  });
  $("#btnMinHelp").onclick=()=> requestNavigation("help");
  $("#btnRestartService").onclick=async()=>{
    try{ await invoke('restartService',{enable:true}); toast("Restart requested, waiting for service..."); }
    catch(e){
      const raw = e.message || String(e);
      let hint = raw;
      if(raw.includes("serviceEnableAndRestartFailed")) hint = "Enable+restart failed (auth dismissed? pkexec missing?). Try in terminal: sudo systemctl enable --now obscura.service";
      else if(raw.includes("serviceStartTimeout")) hint = "Service did not become active in 10s — likely crash-loop. Run: journalctl -u obscura.service -n 50 --no-pager";
      else if(raw.includes("serviceStartFailed")) hint = "Service entered failed state. Run: journalctl -u obscura.service -n 50 --no-pager";
      toast(hint, 6000);
    }
  };
  $("#btnAddOperator").onclick=async()=>{ try{ await invoke('linuxAddOperator'); toast("Permission added, restart app"); }catch(e){ toast(e.message); } };
  const accInput=$("#accountInput");
  accInput.addEventListener("input", ()=>{
    const raw=accInput.value; const norm=normalizeAccountId(raw); accInput.value = formatPartial(raw);
    let err=""; if(norm.length>0 && norm.length<20) err="Incomplete number (20 digits)"; else if(norm.length===20 && !validChecksum(norm)) err="Invalid check digit";
    $("#accountError").textContent=err; $("#btnLogin").disabled = !!err || norm.length!==20;
  });
  $("#btnLogin").onclick=async()=>{
    const norm=normalizeAccountId($("#accountInput").value);
    if(norm.length!==20) return toast("Invalid number"); if(!validChecksum(norm)) return toast("Invalid checksum");
    $("#btnLogin").disabled=true; $("#loginStatus").textContent="Validating...";
    try{ await ffi('login',{accountId:norm, validate:true}); toast("Login successful"); $("#loginStatus").textContent=""; }
    catch(e){ $("#loginStatus").textContent="Error: "+e.message; toast(e.message); } finally{ $("#btnLogin").disabled=false; }
  };
  $("#btnCreateAccount").onclick=async()=>{
    const gen=generateAccountNumber(); window._generatedAccount=gen;
    try{ await ffi('setInNewAccountFlow',{value:true}); await ffi('login',{accountId:gen, validate:true}); renderLogin(); toast("Account created, copy the number!"); }catch(e){ toast(e.message); }
  };
  $("#btnCopyGenerated").onclick=()=>{ navigator.clipboard.writeText(window._generatedAccount||""); toast("Copied!"); $("#btnCopyGenerated").innerHTML=`Copied ${smallCheckSvg()}`; };
  $("#btnDoneGenerated").onclick=async()=>{ try{ await ffi('setInNewAccountFlow',{value:false}); window._generatedAccount=null; toast("Done!"); render(); }catch(e){ toast(e.message); } };
  $("#btnWantExisting").onclick=async()=>{ try{ await ffi('logout'); await ffi('setInNewAccountFlow',{value:false}); window._generatedAccount=null; render(); }catch(e){ toast(e.message); } };
  $("#btnQuickConnect").onclick=()=> invoke('startTunnel',{tunnelArgs:JSON.stringify({exit:{any:{}}})}).catch(e=>toast(e.message));
  $("#btnCancelConnect").onclick=()=> invoke('stopTunnel').catch(e=>toast(e.message));
  $("#btnDisconnect").onclick=()=> invoke('stopTunnel').catch(e=>toast(e.message));
  $("#btnDisconnectCity").onclick=()=> invoke('stopTunnel').catch(e=>toast(e.message));
  $("#btnConnectCity").onclick=()=>{
    const val=$("#citySelect").value; if(!val) return; const [country_code,city_code]=val.split(":");
    invoke('startTunnel',{tunnelArgs:JSON.stringify({exit:{city:{country_code,city_code}}})}).catch(e=>toast(e.message));
  };
  $("#locationSearch").addEventListener("input", renderLocation);
  $("#btnToggleAccount").onclick=()=>{
    accountRevealed=!accountRevealed;
    $("#accountNumberDisplay").textContent = accountRevealed ? formatPartial(appStatus.accountId) : "•••• - •••• - •••• - •••• - ••••";
    $("#btnToggleAccount").textContent = accountRevealed ? "Hide" : "Show";
  };
  $("#btnCopyAccount").onclick=()=>{ navigator.clipboard.writeText(appStatus.accountId); toast("Copied"); };
  $("#btnLogout").onclick=async()=>{
    if(!confirm("Log out?")) return;
    try{ await invoke('stopTunnel'); }catch(e){}
    try{ await ffi('logout'); toast("Logged out"); }catch(e){ toast(e.message); }
  };
  $("#btnDeleteAccount").onclick=async()=>{
    if(!confirm("Delete account permanently?")) return;
    try{ await ffi('apiDeleteAccount'); await ffi('logout'); toast("Account deleted"); }catch(e){ toast(e.message); }
  };
  $("#toggleAutoConnect").onchange=e=> ffi('setAutoConnect',{enable:e.target.checked}).catch(e=>toast(e.message));
  $("#toggleLocalNetwork").onchange=e=> ffi('setLocalNetworkAccess',{enable:e.target.checked}).catch(e=>toast(e.message));
  $("#toggleKillSwitch").onchange=async e=>{
    const enabled=e.target.checked;
    e.target.disabled=true;
    try{ await ffi('setFeatureFlag',{flag:'killSwitch', active:enabled}); toast(enabled?"Kill switch enabled":"Kill switch disabled"); }
    catch(err){ e.target.checked=!enabled; toast("Could not update kill switch: "+err.message); }
    finally{ e.target.disabled=false; }
  };
  $("#toggleLoginItem").onchange=async e=>{
    try{ if(e.target.checked) await invoke('registerAsLoginItem'); else await invoke('unregisterAsLoginItem'); toast("Updated"); }
    catch(err){ toast(err.message); e.target.checked=!e.target.checked; }
  };
  $$("#dnsBlockGrid input").forEach(cb=> cb.onchange=e=>{
    const cur={...appStatus.dnsContentBlock, [e.target.dataset.dns]: e.target.checked};
    ffi('setDnsContentBlock',{value:cur}).catch(err=>toast(err.message));
  });
  $$('input[name="dnsMode"]').forEach(r=> r.onchange=e=>{ if(e.target.checked) ffi('setUseSystemDns',{enable:e.target.value==="system"}).catch(err=>toast(err.message)); });
  $("#btnRotateKey").onclick=()=> ffi('rotateWgKey').then(()=>toast("Key rotated")).catch(e=>toast(e.message));
  $$(".scheme-btn").forEach(b=> b.onclick=()=> invoke('setColorScheme',{value:b.dataset.scheme}).then(()=>toast(b.dataset.scheme)).catch(e=>toast(e.message)));
  $("#btnDebugBundle").onclick=async()=>{
    const fb=$("#feedbackInput").value; if(!fb) return toast("Describe the problem");
    try{
      $("#btnDebugBundle").disabled=true; $("#btnDebugBundle").textContent="Generating...";
      const path=await invoke('debugBundle',{userFeedback:fb});
      $("#debugPath").textContent=path; $("#btnRevealDebug").classList.remove("hidden");
      $("#btnRevealDebug").onclick=()=> invoke('revealItemInDir',{path}).catch(e=>toast(e.message));
      toast("Bundle generated");
    }catch(e){ toast(e.message); } finally{ $("#btnDebugBundle").disabled=false; $("#btnDebugBundle").textContent="Generate debug bundle"; }
  };
  $("#aboutVersion").addEventListener("click", ()=>{ devClicks++; if(devClicks>=5){ requestNavigation("developer"); devClicks=0; } });
  $("#btnLicenses").onclick=()=>{
    const c=$("#licensesCard"); c.style.display=c.style.display==="none"?"block":"none";
  };
  $("#btnResetDefaults").onclick=()=> invoke('resetUserDefaults').then(()=>toast("Reset")).catch(e=>toast(e.message));
  $("#btnRestartApp").onclick=()=> invoke('restartApp').catch(e=>toast(e.message));
  pollOsStatus(); pollExitList(); pollAccount(); pollTraffic();
  setInterval(pollExitList, 60000); setInterval(pollAccount, 30000); setInterval(pollTraffic, 1000);
});
async function pollOsStatus(){
  while(true){
    try{ const s=await invoke('getOsStatus',{knownVersion: osVersion}); osStatus=s; osVersion=s.version; render(); }
    catch(e){ console.error("osStatus",e); await new Promise(r=>setTimeout(r,1500)); }
  }
}
async function pollExitList(){
  try{
    const res=await ffi('getExitList',{knownVersion: exitVersion}, null);
    if(res && res.value){ exitList=res.value.exits || []; exitVersion=res.version; if(appStatus) renderLocation(); renderConnection(); }
  }catch(e){ console.error(e); }
}
async function pollAccount(){
  if(!appStatus || !appStatus.accountId) return;
  try{ const info=await ffi('apiGetAccountInfo'); accountInfo=info; renderAccount(); }catch(e){ console.error(e); }
}
window.pollAccountNow=pollAccount;
async function pollTraffic(){
  if(!appStatus || !appStatus.vpnStatus?.connected) { traffic=null; return; }
  try{ traffic=await ffi('getTrafficStats'); }catch(e){}
}
