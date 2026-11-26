<script lang="ts">
  import { resolve } from '$app/paths';
  import auth from "../../auth.svelte";
  import { Ticket } from "lucide-svelte";

  let username = $state("");
  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = "";
    loading = true;
    const msg = await auth.login(username, password);
    if (msg) error = msg;
    loading = false;
  }
</script>

<div class="card bg-base-100 border border-base-300 shadow-sm w-full max-w-sm">
  <div class="card-body gap-6">
    <!-- Branding -->
    <div class="flex flex-col items-center gap-2">
      <div class="bg-primary text-primary-content w-14 h-14 rounded-2xl flex items-center justify-center">
        <Ticket size={28} />
      </div>
      <h1 class="text-2xl font-bold">Welcome back</h1>
      <p class="text-sm opacity-60">Sign in to your account</p>
    </div>

    <!-- Error alert -->
    {#if error}
      <div role="alert" class="alert alert-error alert-soft text-sm">
        {error}
      </div>
    {/if}

    <!-- Form -->
    <form onsubmit={handleLogin} class="flex flex-col gap-4">
      <fieldset class="fieldset">
        <label class="label" for="login-username">Username</label>
        <input
          type="text"
          id="login-username"
          class="input input-bordered w-full"
          placeholder="Enter your username"
          required
          bind:value={username}
          disabled={loading}
        />
      </fieldset>

      <fieldset class="fieldset">
        <label class="label" for="login-password">Password</label>
        <input
          type="password"
          id="login-password"
          class="input input-bordered w-full"
          placeholder="Enter your password"
          required
          bind:value={password}
          disabled={loading}
        />
      </fieldset>

      <button
        class="btn btn-primary w-full mt-2"
        type="submit"
        disabled={loading}
      >
        {#if loading}
          <span class="loading loading-spinner loading-sm"></span>
        {/if}
        Sign In
      </button>
    </form>

    <p class="text-sm text-center opacity-60">
      Don't have an account?
      <a href="{resolve('/')}register" class="link link-primary">Register</a>
    </p>
  </div>
</div>
