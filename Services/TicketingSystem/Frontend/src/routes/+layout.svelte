<script lang="ts">
  import { resolve } from '$app/paths';
  import '../app.css';
  import '@fontsource-variable/inter/index.css';
  import '@fontsource-variable/plus-jakarta-sans/index.css';
  import { page } from '$app/state';
  import App from '../App.svelte';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="manifest" href="{resolve('/')}manifest.webmanifest" />
</svelte:head>

<App>
  {#key page.url.pathname}
    {@render children()}
  {/key}
</App>
