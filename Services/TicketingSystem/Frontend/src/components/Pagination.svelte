<script lang="ts">
  import type { Pagination } from "../lib/types";
  import { ChevronLeft, ChevronRight } from "lucide-svelte";

  let { pagination, onPageChange }: {
    pagination: Pagination;
    onPageChange: (page: number) => void;
  } = $props();

  let pages = $derived(() => {
    const arr: (number | '...')[] = [];
    const { page, pages: total } = pagination;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) arr.push(i);
    } else {
      arr.push(1);
      if (page > 3) arr.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) {
        arr.push(i);
      }
      if (page < total - 2) arr.push('...');
      arr.push(total);
    }
    return arr;
  });
</script>

{#if pagination.pages > 1}
  <div class="join">
    <button
      class="join-item btn btn-sm"
      disabled={pagination.page <= 1}
      onclick={() => onPageChange(pagination.page - 1)}
    >
      <ChevronLeft size={16} />
    </button>

    {#each pages() as p}
      {#if p === '...'}
        <button class="join-item btn btn-sm btn-disabled">…</button>
      {:else}
        <button
          class="join-item btn btn-sm"
          class:btn-active={p === pagination.page}
          onclick={() => onPageChange(p as number)}
        >
          {p}
        </button>
      {/if}
    {/each}

    <button
      class="join-item btn btn-sm"
      disabled={pagination.page >= pagination.pages}
      onclick={() => onPageChange(pagination.page + 1)}
    >
      <ChevronRight size={16} />
    </button>
  </div>
{/if}
