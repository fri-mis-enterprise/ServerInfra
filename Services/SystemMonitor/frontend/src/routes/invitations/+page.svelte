<script>
  import { onMount } from "svelte";
  import { auth, api, notice, time } from "$lib/state";
  let data;
  let link = "";
  let input;
  let error = "";
  let busy = false;
  let copyLabel = "Copy link";
  onMount(() => {
    if ($auth.user?.username === "mis") load();
  });
  async function load() {
    try {
      data = await api("/invitations");
      error = "";
    } catch (e) {
      error = e.message;
    }
  }
  async function create() {
    busy = true;
    error = "";
    try {
      data = await api("/invitations", {});
      link = new URL(data.link, location.origin).href;
      copyLabel = "Copy link";
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
  async function revoke(id) {
    busy = true;
    try {
      const result = await api(`/invitations/${id}/revoke`, {});
      link = "";
      notice(result.message);
      await load();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
  async function copy() {
    input.select();
    try {
      await navigator.clipboard.writeText(link);
      copyLabel = "Copied";
    } catch {
      copyLabel = "Selected — press Ctrl+C";
    }
  }
</script>

<svelte:head><title>Invitations · DCR Access</title></svelte:head>
{#if $auth.user?.username !== "mis"}<section class="panel auth-panel">
    <h2>MIS access required</h2>
    <p class="auth-description">
      Only MIS can manage registration invitations.
    </p>
  </section>{:else}
  <section class="panel auth-panel">
    <p class="eyebrow">ACCOUNT ACCESS</p>
    <h2>Registration invitations</h2>
    <p class="auth-description">
      Create a link and share it with the person you want to invite. It creates
      one account, expires after 48 hours, and gives access to manage months and
      view the audit trail.
    </p>
    {#if error}<p class="field-error" role="alert">{error}</p>{/if}
    <div class="invitation-create">
      <button class="button button-primary" disabled={busy} on:click={create}
        >{busy ? "Please wait…" : "Create invitation"}</button
      >
    </div>
    {#if link}<div class="invitation-link">
        <label for="invitation-link"
          >Copy this link before leaving this page</label
        ><input
          bind:this={input}
          id="invitation-link"
          type="text"
          value={link}
          readonly
        /><button class="button button-secondary" on:click={copy}
          >{copyLabel}</button
        >
        <p class="input-help">
          The link is only shown here once. Share it directly with the intended
          person.
        </p>
      </div>{/if}
  </section>
  {#if data}<section class="panel audit-panel invitation-history">
      <div class="table-wrap">
        <table>
          <caption class="sr-only">Registration invitations</caption><thead
            ><tr
              ><th>Created · Manila</th><th>Expires · Manila</th><th>Status</th
              ><th>Action</th></tr
            ></thead
          ><tbody
            >{#each data.invitations as item (item.id)}<tr
                ><td>{time(item.created_at, true)}</td><td
                  >{time(item.expires_at, true)}</td
                ><td
                  >{item.used_by
                    ? `Used by @${item.used_by}`
                    : item.revoked_at
                      ? "Revoked"
                      : Date.parse(item.expires_at) <= Date.parse(data.now)
                        ? "Expired"
                        : "Ready to use"}</td
                ><td
                  >{#if !item.used_by && !item.revoked_at && Date.parse(item.expires_at) > Date.parse(data.now)}<button
                      class="button button-secondary"
                      disabled={busy}
                      on:click={() => revoke(item.id)}>Revoke</button
                    >{:else}—{/if}</td
                ></tr
              >{:else}<tr><td colspan="4">No invitations yet.</td></tr
              >{/each}</tbody
          >
        </table>
      </div>
    </section>{/if}
{/if}
