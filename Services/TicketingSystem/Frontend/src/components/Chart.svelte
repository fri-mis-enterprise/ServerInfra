<script lang="ts">
  import { onMount } from "svelte";
  import Chart, { type ChartConfiguration, type ChartTypeRegistry } from "chart.js/auto";

  let { 
    type, 
    data, 
    options = {}, 
    class: className = "" 
  } = $props<{
    type: keyof ChartTypeRegistry;
    data: any;
    options?: any;
    class?: string;
  }>();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let chart: Chart | null = null;
  let theme = $state('');

  onMount(() => {
    const root = document.documentElement;
    const updateTheme = () => { theme = root.dataset.theme ?? ''; };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  });

  $effect(() => {
    // Re-create the chart when its data or theme changes.
    if (canvas && data) {
      Chart.defaults.color = theme === 'ticketing' ? '#c0b8a8' : '#424848';
      Chart.defaults.font.family = getComputedStyle(canvas).fontFamily;
      if (chart) {
        chart.destroy();
      }

      chart = new Chart(canvas, {
        type,
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...options
        }
      });
    }

    return () => {
      if (chart) {
        chart.destroy();
        chart = null;
      }
    };
  });
</script>

<div class="relative w-full h-full {className}">
  <canvas bind:this={canvas}></canvas>
</div>
