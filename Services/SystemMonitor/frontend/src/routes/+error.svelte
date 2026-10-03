<script>
  import { page } from "$app/stores";
  import { base } from "$app/paths";
</script>

<section class="panel auth-panel">
  <p class="eyebrow">{$page.status}</p>
  <h2>Page unavailable</h2>
  <p class="auth-description">
    {$page.error?.message || "This page could not be loaded."}
  </p>
  <p class="auth-switch"><a href={`${base}/`}>Return to overview</a></p>
</section>
