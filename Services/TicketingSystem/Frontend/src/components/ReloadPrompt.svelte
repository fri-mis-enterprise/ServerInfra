<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { RefreshCw, X } from 'lucide-svelte';

  let needRefresh = $state(false);
  let registration: ServiceWorkerRegistration | undefined;

  onMount(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(`${resolve('/')}service-worker.js`, { type: 'module' }).then(result => {
      registration = result;
      needRefresh = !!result.waiting;
      result.addEventListener('updatefound', () => {
        result.installing?.addEventListener('statechange', () => {
          needRefresh = !!result.waiting && !!navigator.serviceWorker.controller;
        });
      });
    }).catch(error => console.error('[PWA] Registration failed:', error));
  });

  function updateServiceWorker() {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }

  function close() {
    needRefresh = false;
  }
</script>

{#if needRefresh}
  <div class="toast toast-bottom toast-center z-[100] w-full max-w-md p-4">
    <div class="alert alert-info shadow-lg flex flex-col sm:flex-row justify-between items-center gap-4">
      <div class="flex items-center gap-3">
        <div class="bg-primary/20 p-2 rounded-full text-primary">
          <RefreshCw size={20} class="animate-spin-slow" />
        </div>
        <div class="flex flex-col">
          <span class="font-bold text-sm">Update Available</span>
          <span class="text-xs opacity-80">New features and fixes are ready.</span>
        </div>
      </div>
      <div class="flex items-center gap-2 w-full sm:w-auto">
        <button 
          class="btn btn-primary btn-sm flex-1 sm:flex-none" 
          onclick={updateServiceWorker}
        >
          Update Now
        </button>
        <button 
          class="btn btn-ghost btn-sm btn-square" 
          onclick={close}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.animate-spin-slow) {
    animation: spin 8s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
