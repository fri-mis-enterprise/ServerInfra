<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { auth, api, notice } from "./state";
  import Icon from "./Icon.svelte";
  export let registering = false;
  let valid = false;
  let checking = registering;
  let error = "";
  let busy = false;
  let username = "";
  let displayName = "";
  let password = "";
  let confirmation = "";
  let show = false;
  let showConfirmation = false;
  let invitation = "";
  onMount(() => {
    if ($auth.user) {
      goto(`${base}/`, { replaceState: true });
      return;
    }
    if (registering) {
      invitation = $page.url.searchParams.get("invitation") || "";
      api(`/register?invitation=${encodeURIComponent(invitation)}`)
        .then(() => (valid = true))
        .catch((e) => (error = e.message))
        .finally(() => (checking = false));
    }
  });
  async function submit() {
    busy = true;
    error = "";
    try {
      const result = await api(registering ? "/register" : "/login", {
        username,
        password,
        display_name: displayName,
        confirm_password: confirmation,
        invitation,
      });
      auth.set(result);
      password = "";
      confirmation = "";
      if (registering) notice("Your account is ready. You are now signed in.");
      const next = $page.url.searchParams.get("next") || "";
      const safe =
        next.startsWith(`${base}/`) &&
        !next.startsWith(`${base}/login`) &&
        !next.startsWith(`${base}/register`);
      await goto(safe ? next : `${base}/`, { replaceState: true });
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>{registering ? "Create an account" : "Sign in"} · DCR Access</title
  ></svelte:head
>
{#if registering && checking}<p class="refresh-note" role="status">
    Checking invitation…
  </p>
{:else if registering && !valid}<section
    class="panel auth-panel invitation-message"
  >
    <p class="eyebrow">ACCOUNT ACCESS</p>
    <h2>Invitation required</h2>
    <p class="auth-description">
      {error || "Ask MIS for a registration link."} Each link can create one account
      and expires after 48 hours.
    </p>
    <p class="auth-switch">
      Already have an account? <a href={`${base}/login`}>Sign in</a>
    </p>
  </section>
{:else}
  <div class="auth-layout">
    <div class="auth-intro">
      <span class="auth-symbol"><Icon name="shield" /></span>
      <p class="eyebrow">DCR ACCESS MANAGEMENT</p>
      <h1>Accountable access.<br />Clear history.</h1>
      <p>
        Manage temporary month access with your own account. Every dashboard
        action is linked to the person who made it.
      </p>
      <div class="auth-feature">
        <Icon name="calendar" />Precise opening and closing schedules
      </div>
      <div class="auth-feature">
        <Icon name="clock" />An audit trail of access changes
      </div>
      <div class="auth-feature">
        <Icon name="shield" />Your own secure sign-in
      </div>
    </div>
    <section class="panel auth-panel">
      <h2>{registering ? "Create your account" : "Welcome back"}</h2>
      <p class="auth-description">
        {registering
          ? "Your invitation gives you access to manage months with your own account."
          : "Sign in to manage access and view the audit trail."}
      </p>
      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <form on:submit|preventDefault={submit} class="auth-form">
        <fieldset disabled={busy}>
          {#if registering}<label for="display-name"
              >Your name<input
                type="text"
                id="display-name"
                bind:value={displayName}
                autocomplete="name"
                maxlength="80"
                required
              /></label
            >{/if}
          <label for="username"
            >Username<input
              type="text"
              id="username"
              bind:value={username}
              autocomplete="username"
              maxlength="32"
              minlength={registering ? 3 : undefined}
              pattern={registering
                ? "[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
                : undefined}
              required
            /></label
          >
          {#if registering}<p class="input-help">
              3–32 characters. Letters, numbers, dots, hyphens, and underscores.
            </p>{/if}
          <label for="password">Password</label>
          <div class="password-field">
            <input
              type={show ? "text" : "password"}
              id="password"
              bind:value={password}
              autocomplete={registering ? "new-password" : "current-password"}
              minlength={registering ? 4 : undefined}
              maxlength="1024"
              required
            /><button
              class="password-toggle"
              type="button"
              on:click={() => (show = !show)}
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}>{show ? "Hide" : "Show"}</button
            >
          </div>
          {#if registering}<p class="input-help">Use at least 4 characters.</p>
            <label for="confirm-password">Confirm password</label>
            <div class="password-field">
              <input
                type={showConfirmation ? "text" : "password"}
                id="confirm-password"
                bind:value={confirmation}
                autocomplete="new-password"
                minlength="4"
                maxlength="1024"
                required
              /><button
                class="password-toggle"
                type="button"
                on:click={() => (showConfirmation = !showConfirmation)}
                aria-label={showConfirmation
                  ? "Hide confirmation password"
                  : "Show confirmation password"}
                aria-pressed={showConfirmation}
                >{showConfirmation ? "Hide" : "Show"}</button
              >
            </div>{/if}
          <button class="button button-primary auth-submit" type="submit"
            ><Icon name={registering ? "plus" : "arrow"} />{busy
              ? "Please wait…"
              : registering
                ? "Create account"
                : "Sign in"}</button
          >
        </fieldset>
      </form>
      <p class="auth-switch">
        {registering
          ? "Already have an account?"
          : "Need an account? Ask MIS for an invitation."}
        {#if registering}<a href={`${base}/login`}>Sign in</a>{/if}
      </p>
    </section>
  </div>
{/if}
