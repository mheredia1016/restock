self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
  let d={};
  try{d=event.data?event.data.json():{}}catch{d={body:event.data?event.data.text():"Product status changed"}}
  const options={
    body:d.body||"Product status changed",
    icon:d.icon||"/icon-192.png",
    badge:d.badge||"/icon-192.png",
    image:d.image||undefined,
    tag:d.tag||`restock-${Date.now()}`,
    renotify:true,
    requireInteraction:d.status==="in_stock",
    data:{url:d.url||"/"}
  };
  event.waitUntil(self.registration.showNotification(d.title||"Restock Alert",options));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification.data?.url||"/";
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){if("focus" in client){await client.focus(); if("navigate" in client) await client.navigate(url); return;}}
    if(clients.openWindow) return clients.openWindow(url);
  })());
});
