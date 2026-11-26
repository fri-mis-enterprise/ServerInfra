<script lang="ts">
  import { resolve } from '$app/paths';
  import auth from "../../auth.svelte";
  import { getReferenceData } from "../../lib/reference.remote";
  import type { Department } from "../../lib/types";
  import { Ticket } from "lucide-svelte";
  import { onMount } from "svelte";

  let first_name = $state("");
  let last_name = $state("");
  let email = $state("");
  let username = $state("");
  let password = $state("");
  let position = $state("");
  let department_id = $state<number | undefined>(undefined);
  let error = $state("");
  let loading = $state(false);
  let departments = $state<Department[]>([]);

  onMount(async () => {
    try {
      const data = await getReferenceData();
      if (data?.departments) departments = data.departments;
    } catch {
      // departments dropdown will be empty
    }
  });

  async function handleRegister(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    const msg = await auth.register({
      first_name,
      last_name,
      email,
      username,
      password,
      position: position || undefined,
      department_id,
    });
    if (msg) error = msg;
    loading = false;
  }
</script>

<div class="card bg-base-100 border border-base-300 shadow-sm w-full max-w-md">
  <div class="card-body gap-5">
    <!-- Branding -->
    <div class="flex flex-col items-center gap-2">
      <div
        class="bg-primary text-primary-content w-14 h-14 rounded-2xl flex items-center justify-center"
      >
        <Ticket size={28} />
      </div>
      <h1 class="text-2xl font-bold">Create Account</h1>
      <p class="text-sm opacity-60">Register for the ticketing system</p>
    </div>

    {#if error}
      <div role="alert" class="alert alert-error alert-soft text-sm">
        {error}
      </div>
    {/if}

    <form onsubmit={handleRegister} class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        <fieldset class="fieldset">
          <label class="label" for="reg-fname">First name</label>
          <input
            id="reg-fname"
            type="text"
            class="input input-bordered w-full"
            required
            bind:value={first_name}
            disabled={loading}
          />
        </fieldset>
        <fieldset class="fieldset">
          <label class="label" for="reg-lname">Last name</label>
          <input
            id="reg-lname"
            type="text"
            class="input input-bordered w-full"
            required
            bind:value={last_name}
            disabled={loading}
          />
        </fieldset>
      </div>

      <fieldset class="fieldset">
        <label class="label" for="reg-email">Email</label>
        <input
          id="reg-email"
          type="email"
          class="input input-bordered w-full"
          required
          bind:value={email}
          disabled={loading}
        />
      </fieldset>

      <fieldset class="fieldset">
        <label class="label" for="reg-username">Username</label>
        <input
          id="reg-username"
          type="text"
          class="input input-bordered w-full"
          required
          bind:value={username}
          disabled={loading}
        />
      </fieldset>

      <fieldset class="fieldset">
        <label class="label" for="reg-password">Password</label>
        <input
          id="reg-password"
          type="password"
          class="input input-bordered w-full"
          required
          bind:value={password}
          disabled={loading}
        />
      </fieldset>

      <div class="grid grid-cols-2 gap-3">
        <fieldset class="fieldset">
          <label class="label" for="reg-position">Position</label>
          <input
            id="reg-position"
            type="text"
            class="input input-bordered w-full"
            bind:value={position}
            disabled={loading}
          />
        </fieldset>
        <fieldset class="fieldset">
          <label class="label" for="reg-dept">Department</label>
          <select
            id="reg-dept"
            class="select select-bordered w-full"
            bind:value={department_id}
            disabled={loading}
          >
            <option value={undefined}>— None —</option>
            {#each departments as dept}
              <option value={dept.id}>{dept.name}</option>
            {/each}
          </select>
        </fieldset>
      </div>

      <button
        class="btn btn-primary w-full mt-2"
        type="submit"
        disabled={loading}
      >
        {#if loading}<span class="loading loading-spinner loading-sm"
          ></span>{/if}
        Create Account
      </button>
    </form>

    <p class="text-sm text-center opacity-60">
      Already have an account?
      <a href="{resolve('/')}login" class="link link-primary">Sign in</a>
    </p>
  </div>
</div>
