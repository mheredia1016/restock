const $=s=>document.querySelector(s), els={watching:$("#watching"),inStock:$("#inStock"),outStock:$("#outStock"),devices:$("#devices"),agentStatus:$("#agentStatus"),store:$("#store"),grid:$("#grid"),template:$("#card"),form:$("#addForm"),url:$("#url"),message:$("#message"),refresh:$("#refresh"),checkAll:$("#checkAll"),push:$("#push"),test:$("#test"),badges:$("#serviceBadges"),toast:$("#toast")};
const api=async(url,opt={})=>{const r=await fetch(url,{headers:{"content-type":"application/json"},...opt});const d=await r.json().catch(()=>({}));if(!r.ok&&r.status!==202)throw Error(d.error||`Request failed ${r.status}`);return d};
function toast(m){els.toast.textContent=m;els.toast.classList.add("show");setTimeout(()=>els.toast.classList.remove("show"),3200)}
function badge(text,ok){return `<span class="badge ${ok?"good":"neutral"}">${text}</span>`}
function status(w){if(!w.enabled)return["Paused","neutral"];if(w.status==="in_stock")return["In Stock","good"];if(w.status==="out_of_stock")return["Out of Stock","bad"];return["Unknown","neutral"]}
function when(value){return value?new Date(value).toLocaleString():"Never"}
function render(w){const n=els.template.content.firstElementChild.cloneNode(true),[label,cls]=status(w);
n.querySelector(".status").textContent=label;n.querySelector(".status").className=`status ${cls}`;
n.querySelector(".id").textContent=`#${w.id}`;
n.querySelector("h3").textContent=w.title||"Pending first successful check";
n.querySelector(".price").textContent=w.price||"Price unknown";
n.querySelector(".meta").textContent=[w.sku&&`SKU ${w.sku}`,w.source].filter(Boolean).join(" • ")||"Waiting for product details";
n.querySelector(".availability").textContent=w.availabilityText?`Availability: ${w.availabilityText}`:"Availability details unavailable";
n.querySelector(".checked").textContent=`Last attempt: ${when(w.lastCheckedAt)}${w.lastError?` • ${w.lastError}`:""}`;
n.querySelector(".success").textContent=`Last complete result: ${when(w.lastSuccessfulAt)}`;
const a=n.querySelector("a");a.href=w.pageUrl||w.url;
if(w.image){const i=n.querySelector("img");i.src=w.image;i.alt=w.title||"Product image";i.style.display="block";i.onerror=()=>{i.style.display="none";n.querySelector(".media span").style.display="block"};n.querySelector(".media span").style.display="none"}
n.querySelector(".check").onclick=async()=>{const r=await api(`/api/watches/${w.id}/check`,{method:"POST",body:"{}"});toast(r.pendingAgent?"Queued for the home agent":"Checked");load()};
n.querySelector(".toggle").textContent=w.enabled?"Pause":"Resume";n.querySelector(".toggle").onclick=async()=>{await api(`/api/watches/${w.id}`,{method:"PATCH",body:JSON.stringify({enabled:!w.enabled})});load()};
n.querySelector(".remove").onclick=async()=>{if(confirm("Remove this watch?")){await api(`/api/watches/${w.id}`,{method:"DELETE"});load()}};
return n}
async function getSub(){if(!("serviceWorker"in navigator)||!("PushManager"in window))return null;const r=await navigator.serviceWorker.register("/sw.js");return r.pushManager.getSubscription()}
function key(s){const p="=".repeat((4-s.length%4)%4),b=atob((s+p).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...b].map(c=>c.charCodeAt(0)))}
async function pushUi(configured){if(!configured){els.push.disabled=true;els.push.textContent="Push Not Configured";return}const s=await getSub();els.push.disabled=false;els.push.textContent=s?"Disable Browser Push":"Enable Browser Push"}
async function load(){const d=await api("/api/dashboard");els.watching.textContent=d.watches.length;els.inStock.textContent=d.watches.filter(w=>w.enabled&&w.status==="in_stock").length;els.outStock.textContent=d.watches.filter(w=>w.enabled&&w.status==="out_of_stock").length;els.devices.textContent=d.subscriptions;els.agentStatus.textContent=d.agent?.online?"Online":"Offline";els.agentStatus.className=d.agent?.online?"online":"offline";els.store.textContent=d.storeName;els.badges.innerHTML=badge(`Agent ${d.agent?.online?"Online":"Offline"}`,d.agent?.online)+badge(`Push ${d.services.pushConfigured?"Ready":"Off"}`,d.services.pushConfigured)+badge(`Email ${d.services.emailConfigured?"Ready":"Off"}`,d.services.emailConfigured)+badge(`Discord ${d.services.discordConnected?"Connected":"Off"}`,d.services.discordConnected);els.grid.innerHTML="";d.watches.forEach(w=>els.grid.appendChild(render(w)));await pushUi(d.services.pushConfigured)}
els.form.onsubmit=async e=>{e.preventDefault();els.message.textContent="Adding…";try{await api("/api/watches",{method:"POST",body:JSON.stringify({url:els.url.value})});els.url.value="";els.message.textContent="Added. The home agent will check it shortly.";load()}catch(err){els.message.textContent=err.message}};
els.refresh.onclick=load;els.checkAll.onclick=async()=>{els.checkAll.disabled=true;try{const r=await api("/api/check-all",{method:"POST",body:"{}"});toast(r.pendingAgent?"Home agent will check shortly":"All products checked");load()}finally{els.checkAll.disabled=false}};
els.test.onclick=async()=>{await api("/api/notifications/test",{method:"POST",body:"{}"});toast("Test alert sent")};
els.push.onclick=async()=>{const current=await getSub();if(current){await api("/api/push/unsubscribe",{method:"POST",body:JSON.stringify({endpoint:current.endpoint})});await current.unsubscribe();toast("Push disabled");return load()}if(await Notification.requestPermission()!=="granted")return toast("Permission not granted");const {publicKey}=await api("/api/push/public-key"),reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(publicKey)});await api("/api/push/subscribe",{method:"POST",body:JSON.stringify(sub)});toast("Push enabled");load()};
load();setInterval(load,30000);
