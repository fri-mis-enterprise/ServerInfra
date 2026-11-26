import { self } from '$app/service-worker'
import { immutable, assets as staticAssets } from '$app/manifest'
import { version } from '$app/env'

const cachePrefix = `ticketing-assets:${self.registration.scope}:`
const cacheName = `${cachePrefix}${version}`
const assets = new Set([...immutable, ...staticAssets].map(file => new URL(file.path, self.registration.scope).pathname))

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll([...assets])))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !assets.has(url.pathname)) return
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(event.request)) ?? fetch(event.request)))
})

// Handle Push Notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json()
    const options: any = {
      body: data.body,
      icon: new URL('icon.png', self.registration.scope).href,
      badge: new URL('icon.png', self.registration.scope).href,
      vibrate: [100, 50, 100],
      tag: data.tag,
      renotify: !!data.tag,
      data: {
        url: data.url || '/'
      },
      actions: [
        { action: 'open', title: 'View' },
        { action: 'close', title: 'Close' }
      ]
    }

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    )
  }
})

// Handle Notification Clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // If user clicked the 'close' button, do nothing else
  if (event.action === 'close') {
    return
  }

  const dataUrl = event.notification.data?.url || '/notifications'
  const urlToOpen = new URL(dataUrl.replace(/^\//, ''), self.registration.scope).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If we have a window already, try to navigate it and focus
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client && 'navigate' in client) {
          return (client as WindowClient).navigate(urlToOpen).then(c => c?.focus())
        }
      }

      // 2. Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen)
      }
    })
  )
})

// Handle Skip Waiting message from the frontend
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})
