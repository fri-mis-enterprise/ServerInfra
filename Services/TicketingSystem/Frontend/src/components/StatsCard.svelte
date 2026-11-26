<script lang="ts">
  let { icon: Icon, label, value, color, sub, pct } = $props<{
    icon: any;
    label: string;
    value: string | number;
    color: "primary" | "secondary" | "accent" | "info" | "success" | "warning" | "error" | "neutral";
    sub?: string;
    pct?: number; // Optional percentage for a progress indicator
  }>();

  const bgClasses: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    accent: "bg-accent/10 text-accent",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-error/10 text-error",
    neutral: "bg-neutral text-neutral-content"
  };
</script>

<div class="stat min-w-0 bg-base-100 border border-base-300 rounded-box p-4">
  <div class="stat-figure row-span-2">
    <div class="p-2 rounded-lg {bgClasses[color]}">
      <Icon class="size-5" />
    </div>
  </div>
  
  <div class="stat-title text-xs text-base-content/70 leading-tight mb-2">{label}</div>
  <div class="stat-value text-2xl font-semibold text-base-content tabular-nums">{value}</div>
  
  {#if pct !== undefined}
    <div class="stat-desc col-span-2 mt-2 flex flex-col gap-1.5">
      <progress class="progress progress-{color} h-1.5 w-full" value={pct} max="100"></progress>
      <div class="flex justify-between items-center gap-2 text-xs text-base-content/70">
        <span>{sub ?? 'Completion'}</span>
        <span>{pct}%</span>
      </div>
    </div>
  {:else if sub}
    <div class="stat-desc col-span-2 text-xs truncate text-base-content/70 mt-1">
      {sub}
    </div>
  {/if}
</div>
