<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { auth, notices, api, notice } from "$lib/state";
  import Icon from "$lib/Icon.svelte";
  import SystemClock from "$lib/SystemClock.svelte";
  let ready = false;
  let error = "";
  let busy = false;
  $: path = $page.url.pathname.slice(base.length).replace(/\/$/, "") || "/";
  $: publicPage = ["/login", "/register"].includes(path);
  $: if (ready && !$auth.user && !publicPage)
    goto(
      `${base}/login?next=${encodeURIComponent($page.url.pathname + $page.url.search)}`,
      { replaceState: true },
    );
  async function initialize() {
    error = "";
    try {
      auth.set(await api("/session"));
      ready = true;
    } catch (e) {
      error = e.message;
    }
  }
  onMount(() => {
    initialize();
  });
  async function logout() {
    busy = true;
    try {
      auth.set(await api("/logout", {}));
      notices.set([]);
      await goto(`${base}/login`);
    } catch (e) {
      notice(e.message, "error");
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>System Monitor · Internal operations</title><meta
    name="description"
    content="Internal system monitoring and operations management"
  /></svelte:head
>
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href={`${base}/`}
      ><span class="brand-mark"><Icon name="grid" /></span><span
        >System <span class="brand-light">Monitor</span><small
          >INTERNAL OPERATIONS</small
        ></span
      ></a
    >
    <div class="topbar-tools">
      {#if $auth.user}<SystemClock /><span class="account"
          ><span class="avatar">{$auth.user.display_name[0].toUpperCase()}</span
          ><span
            >{$auth.user.display_name}<small>@{$auth.user.username}</small
            ></span
          ></span
        ><button class="logout-button" on:click={logout} disabled={busy}
          >Sign out</button
        >{:else}<span class="signed-out-label"
          >Internal operations · Account access</span
        >{/if}
    </div>
  </div>
</header>
<main id="main" class="page">
  {#if $auth.user}<nav class="page-nav" aria-label="Main navigation">
      <a class:selected={path === "/"} aria-current={path === "/" ? "page" : undefined} href={`${base}/`}
        ><Icon name="grid" />Systems</a
      ><a class:selected={["/dcr", "/open"].includes(path)} aria-current={path === "/dcr" ? "page" : undefined} href={`${base}/dcr`}
        ><Icon name="shield" />DCR access</a
      ><a class:selected={path === "/fast"} aria-current={path === "/fast" ? "page" : undefined} href={`${base}/fast`}
        ><Icon name="calendar" />FAST periods</a
      ><a class:selected={path === "/audit"} href={`${base}/audit`}
        ><Icon name="clock" />DCR audit trail</a
      >{#if $auth.user.username === "mis"}<a
          class:selected={path === "/invitations"}
          href={`${base}/invitations`}><Icon name="shield" />Invitations</a
        >{/if}
    </nav>{/if}
  <div class="notifications" aria-live="polite">
    {#each $notices as item (item.id)}<div
        class={`notice notice-${item.kind}`}
        role={item.kind === "error" ? "alert" : "status"}
      >
        <Icon name={item.kind === "success" ? "check" : "alert"} />
        <div>
          <strong
            >{item.kind === "error"
              ? "Action needs attention"
              : item.kind === "warning"
                ? "Check the result"
                : "Action completed"}</strong
          >
          <p>{item.text}</p>
        </div>
        <button
          class="icon-button"
          aria-label="Dismiss notification"
          on:click={() =>
            notices.update((items) => items.filter((n) => n.id !== item.id))}
          ><Icon name="close" /></button
        >
      </div>{/each}
  </div>
  {#if error}<section class="panel auth-panel">
      <h2>Connection unavailable</h2>
      <p class="auth-description">{error}</p>
      <button class="button button-primary" on:click={initialize}
        >Try again</button
      >
    </section>{:else if !ready}<p class="refresh-note" role="status">
      Connecting to System Monitor…
    </p>{:else if $auth.user || publicPage}<slot />{:else}<p
      class="refresh-note"
    >
      Opening sign-in…
    </p>{/if}
  <footer class="page-footer">
    <span>System Monitor · Internal operations</span><span
      >{$auth.user
        ? $auth.writes
          ? "DCR access changes enabled"
          : "DCR monitoring only"
        : "Personal account access"} <span class="footer-dot">·</span> Asia/Manila
      (UTC+08:00)</span
    >
  </footer>
</main>
