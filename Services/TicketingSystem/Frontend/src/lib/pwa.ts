import { getVapidPublicKey, subscribePush, unsubscribePush } from './notifications.remote';

// ============================================================
// PWA & Notification Helpers
// ============================================================

/**
 * Utility to convert base64 VAPID key to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.error('This browser does not support notifications.');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();

    return permission === 'granted';
  }

  return false;
}

export async function getPushSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription();
}

export async function subscribeToPush(publicVapidKey: string) {
  try {
    const registration = await navigator.serviceWorker.ready;
    
    let subscription = await registration.pushManager.getSubscription();
    const convertedKey = urlBase64ToUint8Array(publicVapidKey);
    const currentKey = subscription?.options.applicationServerKey;
    if (subscription && currentKey && !new Uint8Array(currentKey).every((value, index) => value === convertedKey[index])) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedKey
    });


    // Re-register existing subscriptions; rotate instead of taking another account's endpoint.
    for (let attempt = 0; ; attempt++) {
      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) throw new Error('Invalid browser push subscription');
      try {
        await subscribePush({ endpoint: subJson.endpoint, keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth } });
        return subscription;
      } catch (error) {
        if (attempt || (error as { status?: number }).status !== 409) throw error;
        await subscription.unsubscribe();
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedKey });
      }
    }
  } catch (error) {
    console.error('Failed to subscribe to push notifications:', error);
    return null;
  }
}

export function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches || 
         (window.navigator as any).standalone || 
         document.referrer.includes('android-app://');
}

/**
 * Initialize push notifications for the current user
 */
export async function initPushNotifications(user: any) {
  if (!user) {
    return;
  }

  try {
    const { publicKey } = await getVapidPublicKey();
    if (!publicKey) {
      console.warn('[PWA] Backend returned empty VAPID key - check backend environment variables');
      return;
    }
    
    const hasPermission = await requestNotificationPermission();
    if (hasPermission) {
      await subscribeToPush(publicKey);
    } else {
      console.warn('[PWA] Notification permission denied');
    }
  } catch (error) {
    console.error('[PWA] Error initializing push:', error);
  }
}

export async function stopPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try { await unsubscribePush(subscription.endpoint); }
  finally { await subscription.unsubscribe(); }
}
