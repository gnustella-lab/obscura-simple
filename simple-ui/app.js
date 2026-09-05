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
const $ = s=>document.querySelector(s);
const $$ = s=>document.querySelectorAll(s);
// CSS reveals one row at a time, independent of native bridge response timing.
let pixelCells=[], lastPixelState="";
let pixelRequest=null;
const locationCountriesOpen=new Set(), pickerCountriesOpen=new Set();
let locationListSignature="", pickerListSignature="";
function pixelRand(seed){ let t=seed+0x6D2B79F5; return function(){ t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function buildPixelGrid(){
  const grid=$("#pixelGrid"); if(!grid || pixelCells.length) return;
  const rows=5, columns=40, density=[0.20,0.35,0.60,0.80,0.95], random=pixelRand(1337);
  for(let row=0;row<rows;row++){
    for(let column=0;column<columns;column++){
      const pixel=document.createElement("div");
      pixel.className=random()<density[row]?"pixel":"pixel empty";
      pixel.style.setProperty("--pixel-delay",`${(rows-1-row)*400}ms`);
      grid.appendChild(pixel);pixelCells.push(pixel);
    }
  }
}
function pixelSetAll(on){ pixelCells.forEach(pixel=>{if(!pixel.classList.contains("empty")) pixel.classList.toggle("on",on);}); }
function renderPixelBackground(isConnected,isConnecting,restart=false){
  const state=isConnected?"connected":isConnecting?"connecting":"disconnected";
  if(state===lastPixelState && !restart) return;
  lastPixelState=state;
  if(state==="disconnected"){pixelSetAll(false);return;}
  if(restart){
    pixelSetAll(false);
    // Commit the reset so a second connection can replay the same CSS animation.
    void $("#pixelGrid").offsetWidth;
  }
  pixelSetAll(true);
}
function setPixelMotion(mode){
  if(!["system","animate","static"].includes(mode)) mode="system";
  document.documentElement.dataset.pixelMotion=mode;
  $("#pixelMotionMode").value=mode;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("#pixelMotionHint").textContent=mode==="system" && reduced?"Your system has animations disabled. Choose Animate bottom to top to enable this effect only in Obscura.":"Changes only the background pixels on Connection.";
  try{localStorage.setItem("obscura-pixel-motion",mode);}catch{}
  syncPixelBackground(true);
}
function clearPixelRequest(){
  if(pixelRequest) clearTimeout(pixelRequest.timer);
  pixelRequest=null;
}
function syncPixelBackground(restart=false){
  const status=osStatus?.serviceStatus?.healthy?.vpnStatus;
  const connected=!!status?.connected, connecting=!!status?.connecting;
  if(pixelRequest && (!status || (pixelRequest.connect ? connected || connecting : !connected && !connecting))) clearPixelRequest();
  if(pixelRequest) renderPixelBackground(false,pixelRequest.connect,restart);
  else renderPixelBackground(connected,connecting,restart);
}
async function requestTunnel(command,args={}){
  clearPixelRequest();
  const request={connect:command==='startTunnel',timer:null};
  pixelRequest=request;
  renderPixelBackground(false,request.connect,request.connect);
  request.timer=setTimeout(()=>{
    if(pixelRequest!==request) return;
    clearPixelRequest();
    syncPixelBackground();
  },10000);
  try{ return await invoke(command,args); }
  catch(error){
    if(pixelRequest===request){ clearPixelRequest(); syncPixelBackground(); }
    throw error;
  }
}
function toast(msg, ms=3000){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"), ms); }
const VIEWS=["connection","location","account","settings","help","about","developer"];
function isValidView(v){ return VIEWS.includes(v); }
function setTopNavVisible(visible){ document.body.classList.toggle("no-navigation",!visible); }
function syncHashToView(name){
  if(!isValidView(name)) return;
  try{
    if(location.hash !== "#"+name) history.replaceState(null,"","#"+name);
  }catch(e){}
}
function showViewLocal(name){
  const previousView=document.body.dataset.view;
  $$(".view").forEach(v=>v.classList.add("hidden"));
  const el=$("#view-"+name); if(el) el.classList.remove("hidden");
  $$(".nav-btn").forEach(b=>{ const active=b.dataset.view===name; b.classList.toggle("active",active); if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current"); });
  document.body.dataset.view=name;
  if(name==="connection" && previousView!=="connection") syncPixelBackground(true);
  if(name!=="connection") $("#cityPicker").open=false;
  $("#pageTitle").textContent=({connection:"Connection",location:"Location",account:"Account",settings:"Settings",help:"Help",about:"About",developer:"Developer",login:"Welcome",splash:"Obscura VPN",degraded:"Service unavailable"})[name] || "Obscura VPN";
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
  const exit=vpnStatus?.connected?.exit;
  if(exit?.country_code && exit?.city_code) return {country_code:exit.country_code,city_code:exit.city_code};
  const args = vpnStatus?.connected?.tunnelArgs ?? vpnStatus?.connecting?.tunnelArgs;
  if(args && args.exit && args.exit.city) return args.exit.city;
  return undefined;
}
function render(){
  syncPixelBackground();
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
      else if(deg==="unitActivating"){ msg="Service starting..."; detail="The service is initializing or retrying configuration. Check its logs if it does not become available."; }
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
  $("#appVersion").textContent = osStatus.srcVersion || "v1.177-10";
  $("#aboutVersion").textContent = osStatus.srcVersion || "v1.177-10";
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
  $("#aboutVersion").textContent = osStatus?.srcVersion || "v1.177-10";
}
function renderConnection(){
  const vpnStatus=appStatus.vpnStatus; const isConnected=vpnConnected(vpnStatus); const isConnecting=!!vpnStatus.connecting;
  const connectingCity=getCityFromStatus(vpnStatus); const lastCity = appStatus.lastChosenExit?.city; const targetCity = connectingCity || lastCity;
  let title="Not connected to Obscura", subtitle=appStatus.firewallStatus==="blocking"?"Internet is blocked until you connect":"Connect to browse privately";
  if(!osStatus.internetAvailable){ title="No internet"; subtitle="Connect to the internet to use VPN"; }
  else if(appStatus.account?.account_info?.active===false){ title="Account expired"; subtitle="Renew to continue"; }
  else if(isConnected){ const exit=vpnStatus.connected.exit; title=`Connected to ${stripEmoji(exit.city_name)}`; subtitle=`${exit.country_code ? exit.country_code.toUpperCase() : ""} • ${exit.provider_id}`; }
  else if(isConnecting){ title= connectingCity ? `Connecting to ${connectingCity.city_code}` : "Connecting..."; subtitle="Establishing secure tunnel"; }
  $("#connTitle").textContent=title; $("#connSubtitle").textContent=subtitle;
  $("#connectionMascot").src=isConnected?"./assets/connected-mascot.svg":"./assets/not-connected-mascot.svg";
  const protection=connectionProtection(vpnStatus,appStatus.firewallStatus);
  $("#trafficPanel").dataset.state=protection.state;
  $("#trafficMessage").textContent=protection.detail;
  $("#locationBanner").dataset.state=protection.state;
  $("#locationConnectionTitle").textContent=protection.title;
  $("#locationConnectionDetail").textContent=protection.detail;
  $("#locationBanner .status-symbol").textContent=protection.state==="connected" || protection.state==="blocked"?"✓":"!";
  $("#btnLocationConnect").innerHTML=isConnected?"Disconnect":isConnecting?"Cancel":'<img class="quick-icon" src="./assets/bolt.badge.automatic.fill.svg" alt="" /> Quick Connect';
  $("#btnLocationConnect").disabled=!isConnected && !isConnecting && !osStatus.internetAvailable;
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
      if(ex){ const o=document.createElement("option"); o.value=`${ex.country_code}:${ex.city_code}`; o.textContent=stripEmoji(ex.city_name); og.appendChild(o); }
    }); sel.appendChild(og);
  }
  const byCountry={}; exits.forEach(e=>{ if(!byCountry[e.country_code]) byCountry[e.country_code]=[]; byCountry[e.country_code].push(e); });
  Object.keys(byCountry).sort().forEach(cc=>{
    const og=document.createElement("optgroup"); og.label=countryName(cc);
    byCountry[cc].sort((a,b)=>a.city_name.localeCompare(b.city_name)).forEach(e=>{
      const o=document.createElement("option"); o.value=`${e.country_code}:${e.city_code}`; o.textContent=stripEmoji(e.city_name); og.appendChild(o);
    }); sel.appendChild(og);
  });
  if(prevVal && [...sel.options].some(o=>o.value===prevVal)) sel.value=prevVal;
  else if(targetCity) sel.value=`${targetCity.country_code}:${targetCity.city_code}`;
  else if(sel.options.length) sel.selectedIndex=0;
  renderCityChoice();
  $("#cityHint").textContent = isConnected ? `Connected via ${stripEmoji(vpnStatus.connected.exit.city_name)}` : "";
  if(isConnected && traffic){
    $("#sessionCard").style.display="block";
    const mins=Math.floor(traffic.connectedMs/60000);
    $("#sessionInfo").textContent=`Session: ${mins} min • ↓ ${(traffic.rxBytes/1024/1024).toFixed(1)} MB • ↑ ${(traffic.txBytes/1024/1024).toFixed(1)} MB • ping ${traffic.latestLatencyMs||"-"} ms`;
  } else { $("#sessionCard").style.display="none"; }
}
function connectionProtection(status,firewall){
  if(status?.connected) return {state:firewall==="blocking"?"connected":"unknown",title:"Connected",detail:firewall==="blocking"?"Traffic is protected":"VPN connected; firewall not confirmed"};
  if(status?.connecting) return {state:"connecting",title:"Connecting…",detail:firewall==="blocking"?"Internet blocked while connecting":"Establishing VPN protection"};
  if(firewall==="blocking") return {state:"blocked",title:"Disconnected",detail:"Internet blocked by kill switch"};
  return {state:firewall==="inactive"?"disconnected":"unknown",title:"Disconnected",detail:firewall==="inactive"?"Traffic is vulnerable":"Protection not confirmed"};
}
function renderCityChoice(){
  const value=$("#citySelect").value;
  const exit=exitList.find(e=>`${e.country_code}:${e.city_code}`===value);
  $("#cityFlag").innerHTML=exit?flagSvg(exit.country_code):"";
  hydrateFlagImgs($("#cityFlag"));
  $("#citySelectionText").textContent=exit?stripEmoji(exit.city_name):"Choose a location";
  $("#cityPickerTrigger").setAttribute("aria-label",exit?`VPN location: ${stripEmoji(exit.city_name)}, ${countryName(exit.country_code)}. Choose another location`:"Choose VPN location");
  renderCityOptions();
  const last=appStatus?.lastChosenExit?.city;
  $("#lastChosenBadge").classList.toggle("hidden",!(exit && last && exit.city_code===last.city_code && exit.country_code===last.country_code));
  $("#btnConnectCity").disabled=!exit || !osStatus?.internetAvailable;
}
function matchingLocations(query){
  return exitList.filter(exit=>!query || [stripEmoji(exit.city_name),exit.city_code,exit.country_code,countryName(exit.country_code)].some(value=>value.toLowerCase().includes(query)));
}
function countryGroup(code,exits,makeRow,expanded,query){
  const group=document.createElement("details");group.className="country-group";group.dataset.country=code;
  group.open=!!query || expanded.has(code);
  const heading=document.createElement("summary");heading.dataset.focusKey=`country:${code}`;
  heading.innerHTML=`<span class="flag" aria-hidden="true">${flagSvg(code)}</span><span class="flex-1">${escHtml(countryName(code))}</span><span class="country-count">${exits.length}</span><span class="country-chevron" aria-hidden="true">›</span>`;
  const cities=document.createElement("div");cities.className="country-cities";
  [...exits].sort((a,b)=>stripEmoji(a.city_name).localeCompare(stripEmoji(b.city_name))).forEach(exit=>cities.appendChild(makeRow(exit)));
  group.append(heading,cities);hydrateFlagImgs(heading);
  group.addEventListener("toggle",()=>{if(!query && group.isConnected){if(group.open)expanded.add(code);else expanded.delete(code);}});
  return group;
}
function preserveCountryState(container,expanded){
  if(container.dataset.searching!=="true") container.querySelectorAll("details.country-group").forEach(group=>{if(group.open)expanded.add(group.dataset.country);else expanded.delete(group.dataset.country);});
  return container.contains(document.activeElement)?document.activeElement.dataset.focusKey:undefined;
}
function restoreCountryFocus(container,key){
  if(key) [...container.querySelectorAll("[data-focus-key]")].find(element=>element.dataset.focusKey===key)?.focus({preventScroll:true});
}
function renderCityOptions(){
  const query=$("#citySearch").value.trim().toLowerCase(), list=$("#cityOptions"), selected=$("#citySelect").value;
  const signature=JSON.stringify([exitList,query,selected]);if(signature===pickerListSignature)return;pickerListSignature=signature;
  const focus=preserveCountryState(list,pickerCountriesOpen);list.dataset.searching=String(!!query);list.replaceChildren();
  const groups={};matchingLocations(query).forEach(exit=>(groups[exit.country_code] ||= []).push(exit));
  function option(exit){
    const value=`${exit.country_code}:${exit.city_code}`,button=document.createElement("button");button.type="button";button.className="picker-city";button.dataset.focusKey=`city:${value}`;
    button.innerHTML=`<span>${escHtml(stripEmoji(exit.city_name))}</span>${selected===value?'<span aria-hidden="true">✓</span>':''}`;
    button.setAttribute("aria-label",`Select ${stripEmoji(exit.city_name)}, ${countryName(exit.country_code)}`);
    if(selected===value)button.setAttribute("aria-current","true");
    button.onclick=()=>{$("#citySelect").value=value;renderCityChoice();$("#cityPicker").open=false;$("#cityPickerTrigger").focus();};
    return button;
  }
  Object.keys(groups).sort((a,b)=>countryName(a).localeCompare(countryName(b))).forEach(code=>list.appendChild(countryGroup(code,groups[code],option,pickerCountriesOpen,query)));
  if(!Object.keys(groups).length){const empty=document.createElement("p");empty.className="muted small picker-empty";empty.textContent="No matching locations.";list.appendChild(empty);}
  restoreCountryFocus(list,focus);
}
function positionCityPopover(){
  const picker=$("#cityPicker");if(!picker.open)return;
  const rect=$("#cityPickerTrigger").getBoundingClientRect(),below=innerHeight-rect.bottom-16,above=rect.top-16;
  if(rect.bottom<0 || rect.top>innerHeight){picker.open=false;return;}
  const upwards=below<220 && above>below;
  picker.classList.toggle("opens-above",upwards);
  picker.style.setProperty("--picker-height",`${Math.max(120,Math.min(360,upwards?above:below))}px`);
}
function locationRegion(cc){
  // Follow the upstream continent order, including its Mexico grouping.
  const groups={
    "North America":"US CA GL BM BZ CR SV GT HN NI PA CU DO HT JM PR BS BB TT",
    "Europe":"AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA XK",
    "South America":"MX AR BO BR CL CO EC PE PY UY VE GY SR GF",
    "Asia":"AE AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KR KW KZ LA LB LK MM MN MO MY NP OM PH PK QA SA SG TH TJ TL TM TR TW UZ VN YE",
    "Africa":"AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
    "Oceania":"AU NZ FJ PG NC PF WS TO VU GU SB FM KI MH NR PW TV",
  };
  return Object.keys(groups).find(name=>groups[name].split(" ").includes(cc.toUpperCase())) || countryName(cc);
}
function renderLocation(){
  const query=$("#locationSearch").value.trim().toLowerCase();
  const list=$("#locationList");
  const filtered=matchingLocations(query);
  $("#locationStats").textContent=`${filtered.length} locations`;
  $("#locationTitle").textContent="Search locations";
  const pins=appStatus?.pinnedLocations || [], last=appStatus?.lastChosenExit?.city;
  const connected=appStatus?.vpnStatus?.connected ? getCityFromStatus(appStatus.vpnStatus) : undefined;
  const key=e=>`${e.country_code}:${e.city_code}`;
  const signature=JSON.stringify([exitList,pins,last,connected,query]);if(signature===locationListSignature)return;locationListSignature=signature;
  const focus=preserveCountryState(list,locationCountriesOpen);list.dataset.searching=String(!!query);list.replaceChildren();
  const pinned=new Set(pins.map(key)), used=new Set();
  function addHeading(text,lastUsed=false){const h=document.createElement("h4");h.textContent=text;h.className=lastUsed?"last-heading":"muted";list.appendChild(h);}
  function makeRow(exit,scope="country"){
    const isPinned=pinned.has(key(exit)), isConnected=connected && key(connected)===key(exit);
    const row=document.createElement("div");row.className="exit-card"+(isConnected?" connected":"");
    row.innerHTML=`<button class="exit-connect" type="button"><span class="flag" aria-hidden="true">${flagSvg(exit.country_code)}</span><span class="flex-1"><span class="exit-name">${escHtml(stripEmoji(exit.city_name))}</span><span class="exit-country">${escHtml(countryName(exit.country_code))}${isConnected?" · Connected":""}</span></span></button><button class="icon-btn pin-btn" type="button" aria-pressed="${isPinned}" aria-label="${isPinned?"Unpin":"Pin"} ${escHtml(stripEmoji(exit.city_name))}">${pinSvg(isPinned)}</button>`;
    row.querySelector(".exit-connect").onclick=()=>connectCity(exit);
    row.querySelector(".exit-connect").dataset.focusKey=`${scope}:connect:${key(exit)}`;
    row.querySelector(".pin-btn").onclick=()=>togglePin(exit,isPinned);
    row.querySelector(".pin-btn").dataset.focusKey=`${scope}:pin:${key(exit)}`;
    hydrateFlagImgs(row);return row;
  }
  function addExit(exit){used.add(key(exit));list.appendChild(makeRow(exit,"shortcut"));}
  if(!query){
    const previous=last && filtered.find(e=>key(e)===key(last));
    if(previous){addHeading("Last chosen",true);addExit(previous);}
    const favorites=filtered.filter(e=>pinned.has(key(e)) && !used.has(key(e)));
    if(favorites.length){addHeading("Pinned");favorites.forEach(addExit);}
  }
  const order=["North America","Europe","South America","Asia","Africa","Oceania"];
  const groups={};
  filtered.forEach(e=>(groups[locationRegion(e.country_code)] ||= []).push(e));
  Object.keys(groups).sort((a,b)=>(order.indexOf(a)<0?99:order.indexOf(a))-(order.indexOf(b)<0?99:order.indexOf(b)) || a.localeCompare(b)).forEach(region=>{
    addHeading(region);
    const countries={};groups[region].forEach(exit=>(countries[exit.country_code] ||= []).push(exit));
    Object.keys(countries).sort((a,b)=>countryName(a).localeCompare(countryName(b))).forEach(code=>list.appendChild(countryGroup(code,countries[code],makeRow,locationCountriesOpen,query)));
  });
  restoreCountryFocus(list,focus);
  if(!filtered.length){
    const empty=document.createElement("div");empty.className="card";empty.textContent="No locations found. Try another search or refresh the list.";
    const button=document.createElement("button");button.className="btn small";button.textContent="Refresh list";button.onclick=()=>ffi('refreshExitList',{freshness:0}).catch(e=>toast(e.message));empty.appendChild(document.createElement("br"));empty.appendChild(button);list.appendChild(empty);
  }
}
function escHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
// Native <select>/<option> is text-only: no image or SVG can render there.
// Strip any emoji/regional indicators from backend-provided names so the
// Location picker only shows clean text (full country names as headers).
function stripEmoji(s){ return String(s ?? "").replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu,"").replace(/\s{2,}/g," ").trim(); }
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
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="${pinned?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l-1 6 3 4v2H6v-2l3-4-1-6z"/><path d="M12 15v7"/></svg>`;
}
async function togglePin(exit, isPinned){
  let pins=[...appStatus.pinnedLocations]; const key=`${exit.country_code}:${exit.city_code}`;
  if(isPinned) pins=pins.filter(p=> `${p.country_code}:${p.city_code}`!==key);
  else pins.push({country_code:exit.country_code, city_code:exit.city_code, pinned_at: Math.floor(Date.now()/1000)});
  try{ await ffi('setPinnedExits',{exits:pins}); toast(isPinned?"Unpinned":"Pinned"); }catch(e){ toast("Error: "+e.message); }
}
async function connectCity(exit){
  const sel={city:{country_code:exit.country_code, city_code:exit.city_code}};
  try{ toast(`Connecting to ${exit.city_name}...`); await requestTunnel('startTunnel',{tunnelArgs:JSON.stringify({exit:sel})}); }catch(e){ toast("Error: "+e.message); }
}
function renderAccount(){
  const card=$("#accountStatusCard"), info=accountInfo;
  let heading="Status unavailable", detail="Refresh to load your subscription.", icon="account-expired.svg";
  if(info){
    if(!info.active){heading="Account expired";detail="Top up to reactivate your account.";}
    else{
      icon="paid-up.svg";
      const expiry=Number(info.current_expiry), renewing=!!(info.stripe_subscription || info.apple_subscription || info.google_subscription);
      heading=renewing?"Subscription active":"Paid Up";
      detail=Number.isFinite(expiry) && expiry>0?`${renewing?"Renews":"Expires"} on ${new Date(expiry*1000).toLocaleDateString()}.`:"Your account is active.";
    }
  }
  card.innerHTML=`<img class="account-status-icon" src="./assets/${icon}" alt="" /><div class="account-status-copy"><h2>${heading}</h2><p>${escHtml(detail)}</p></div><div class="account-status-actions"><button class="btn text small" onclick="pollAccountNow()">↻ Refresh</button><a class="btn primary" href="https://obscura.com/pay#account_id=${encodeURIComponent(appStatus.accountId)}" target="_blank" rel="noopener">Manage Payments ↗</a></div>`;
  $("#accountNumberDisplay").textContent=accountRevealed?formatPartial(appStatus.accountId || ""):"XXXX – XXXX – XXXX – XXXX – XXXX";
  $("#btnToggleAccount").textContent=accountRevealed?"Hide":"Show";
  $("#btnToggleAccount").setAttribute("aria-label",accountRevealed?"Hide account number":"Show account number");
  $("#manageTunnelsLink").href=`https://obscura.com/account/tunnels#account_id=${encodeURIComponent(appStatus.accountId)}`;
}
function applyLocalColorScheme(value){
  if(value==="auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme=value;
  $$(".scheme-btn").forEach(button=>{const active=button.dataset.scheme===value;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
  try{localStorage.setItem("obscura-color-scheme",value);}catch{}
}
function firewallStatusText(status){
  switch(status){
    case "blocking": return "Firewall blocking traffic outside VPN tunnels. Local network exceptions follow your settings.";
    case "inactive": return "Firewall block is not active.";
    case "applying": return "Applying firewall rules…";
    case "failed": return "Could not apply firewall rules. Protection is not confirmed.";
    default: return "Firewall protection has not been confirmed.";
  }
}
function renderSettings(){
  if(!appStatus) return;
  $("#toggleAutoConnect").checked = !!appStatus.autoConnect;
  $("#toggleLocalNetwork").checked = !!appStatus.localNetworkAccess;
  const killSwitchAvailable = (appStatus.featureFlagKeys || []).includes("killSwitch");
  $("#killSwitchSettings").classList.toggle("hidden", !killSwitchAvailable);
  $("#toggleKillSwitch").checked = appStatus.featureFlags?.killSwitch === true;
  $("#killSwitchStatus").textContent = firewallStatusText(appStatus.firewallStatus);
  $("#toggleLoginItem").checked = !!osStatus.loginItemStatus?.registered;
  const block=appStatus.dnsContentBlock || {};
  $$("#dnsBlockGrid input").forEach(cb=> cb.checked = !!block[cb.dataset.dns]);
  const mode = appStatus.useSystemDns ? "system" : "obscura";
  $$('input[name="dnsMode"]').forEach(r=> r.checked = r.value===mode);
}
document.addEventListener("DOMContentLoaded", ()=>{
  buildPixelGrid();
  let motion="system";try{motion=localStorage.getItem("obscura-pixel-motion") || "system";}catch{}
  setPixelMotion(motion);
  $("#pixelMotionMode").onchange=event=>setPixelMotion(event.target.value);
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change",()=>setPixelMotion($("#pixelMotionMode").value));
  let scheme="auto";try{scheme=localStorage.getItem("obscura-color-scheme") || "auto";}catch{}
  applyLocalColorScheme(["auto","light","dark"].includes(scheme)?scheme:"auto");
  $("#nav").addEventListener("click", e=>{ const btn=e.target.closest(".nav-btn"); if(btn) requestNavigation(btn.dataset.view); });
  // Back/forward or manual hash edit: push to backend, let long-poll confirm.
  // Own syncHashToView uses replaceState so it does not fire this.
  window.addEventListener("hashchange", ()=>{
    if(!osStatus) return;
    const h=location.hash.replace("#","");
    if(isValidView(h) && h!==osStatus.navigationView) requestNavigation(h);
  });
  $("#citySelect").onchange=renderCityChoice;
  $("#citySearch").oninput=renderCityOptions;
  $("#cityPicker").addEventListener("toggle",()=>{if($("#cityPicker").open){renderCityOptions();positionCityPopover();}});
  document.addEventListener("focusin",event=>{if(!$("#cityPicker").contains(event.target))$("#cityPicker").open=false;});
  document.addEventListener("click",event=>{if(!$("#cityPicker").contains(event.target))$("#cityPicker").open=false;});
  document.addEventListener("keydown",event=>{if(event.key==="Escape" && $("#cityPicker").open){event.preventDefault();$("#cityPicker").open=false;$("#cityPickerTrigger").focus();}});
  window.addEventListener("resize",positionCityPopover);
  window.addEventListener("scroll",positionCityPopover,{passive:true});
  $("#btnLocationConnect").onclick=()=>{
    const status=appStatus?.vpnStatus;
    const stop=!!(status?.connected || status?.connecting);
    requestTunnel(stop?'stopTunnel':'startTunnel',stop?{}:{tunnelArgs:JSON.stringify({exit:{any:{}}})}).catch(e=>toast(e.message));
  };
  $("#btnRestartService").onclick=async()=>{
    try{ await invoke('restartService',{enable:true}); toast("Restart requested, waiting for service..."); }
    catch(e){
      const raw = e.message || String(e);
      let hint = raw;
      if(raw.includes("serviceEnableAndRestartFailed")) hint = "Enable+restart failed (auth dismissed? pkexec missing?). Try in terminal: sudo systemctl enable --now obscura.service";
      else if(raw.includes("serviceStartTimeout")) hint = "Service initialization is still pending. Check: journalctl -u obscura.service -n 50 --no-pager";
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
  $("#btnQuickConnect").onclick=()=> requestTunnel('startTunnel',{tunnelArgs:JSON.stringify({exit:{any:{}}})}).catch(e=>toast(e.message));
  $("#btnCancelConnect").onclick=()=> requestTunnel('stopTunnel').catch(e=>toast(e.message));
  $("#btnDisconnect").onclick=()=> requestTunnel('stopTunnel').catch(e=>toast(e.message));
  $("#btnDisconnectCity").onclick=()=> requestTunnel('stopTunnel').catch(e=>toast(e.message));
  $("#btnConnectCity").onclick=()=>{
    const val=$("#citySelect").value; if(!val) return; const [country_code,city_code]=val.split(":");
    requestTunnel('startTunnel',{tunnelArgs:JSON.stringify({exit:{city:{country_code,city_code}}})}).catch(e=>toast(e.message));
  };
  $("#locationSearch").addEventListener("input", renderLocation);
  $("#btnToggleAccount").onclick=()=>{
    accountRevealed=!accountRevealed;
    renderAccount();
  };
  $("#btnCopyAccount").onclick=()=>{ navigator.clipboard.writeText(appStatus.accountId); toast("Copied"); };
  $("#btnLogout").onclick=async()=>{
    if(!confirm("Log out?")) return;
    try{ await requestTunnel('stopTunnel'); }catch(e){}
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
    try{ await ffi('setFeatureFlag',{flag:'killSwitch', active:enabled}); toast("Kill switch preference saved"); }
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
  $$(".scheme-btn").forEach(b=> b.onclick=async()=>{try{await invoke('setColorScheme',{value:b.dataset.scheme});applyLocalColorScheme(b.dataset.scheme);}catch(e){toast(e.message);}});
  $("#btnDebugBundle").onclick=async()=>{
    const fb=$("#feedbackInput").value.trim() || "Debug archive requested from Help";
    try{
      $("#btnDebugBundle").disabled=true; $("#btnDebugBundle").textContent="Generating...";
      const path=await invoke('debugBundle',{userFeedback:fb});
      $("#debugPath").textContent=path; $("#btnRevealDebug").classList.remove("hidden");
      $("#btnRevealDebug").onclick=()=> invoke('revealItemInDir',{path}).catch(e=>toast(e.message));
      toast("Bundle generated");
    }catch(e){ toast(e.message); } finally{ $("#btnDebugBundle").disabled=false; $("#btnDebugBundle").textContent="Create Debugging Archive"; }
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
