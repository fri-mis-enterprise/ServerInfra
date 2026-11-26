<script lang="ts">
  import type { TicketPriority } from "../lib/types";
  import { TriangleAlert, ArrowUp, ArrowDown, Minus } from "lucide-svelte";

  let { priority }: { priority: TicketPriority } = $props();

  const priorityMap: Record<
    TicketPriority,
    { label: string; class: string; icon: typeof ArrowUp }
  > = {
    low: { label: "Low", class: "badge-info badge-soft", icon: ArrowDown },
    medium: { label: "Medium", class: "badge-warning badge-soft", icon: Minus },
    high: { label: "High", class: "badge-error badge-soft", icon: ArrowUp },
    critical: { label: "Critical", class: "badge-error", icon: TriangleAlert },
  };

  let config = $derived(
    priorityMap[priority] ?? {
      label: priority,
      class: "badge-ghost",
      icon: Minus,
    },
  );
</script>

<span class="badge badge-sm gap-1 {config.class}">
  <config.icon size={12} />
  {config.label}
</span>
