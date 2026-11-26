<script lang="ts">
  import { onMount } from "svelte";
  import { deleteNotification } from "../../lib/notifications.remote";
  import { navigate } from "../../router.svelte";
  import {
    getNotifications,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
  } from "../../stores/notifications.svelte";
  import Pagination from "../../components/Pagination.svelte";
  import {
    Bell,
    BellOff,
    CheckCheck,
    Trash2,
    Ticket,
    UserPlus,
    ClipboardCheck,
    MessageSquare,
    TriangleAlert,
  } from "lucide-svelte";

  let loading = $state(true);
  let pagination = $state({ page: 1, limit: 20, total: 0, pages: 0 });
  let notifications = $derived(getNotifications());
  let unread = $derived(getUnreadCount());

  const iconMap: Record<string, typeof Bell> = {
    ticket_created: Ticket,
    ticket_assigned: UserPlus,
    approval_requested: ClipboardCheck,
    approval_decided: CheckCheck,
    ticket_resolved: CheckCheck,
    ticket_reopened: TriangleAlert,
    escalated: TriangleAlert,
    comment_added: MessageSquare,
  };

  onMount(async () => {
    const res = await fetchNotifications(1, 20);
    if (res) pagination = res.pagination;
    loading = false;
  });

  async function loadPage(page: number) {
    loading = true;
    const res = await fetchNotifications(page, 20);
    if (res) pagination = res.pagination;
    loading = false;
  }

  async function handleMarkAllRead() {
    await markAllAsRead();
  }

  async function handleDelete(id: number) {
    await deleteNotification(id);
    await loadPage(pagination.page);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }
</script>

<div class="flex flex-col gap-6 max-w-3xl mx-auto">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex flex-col">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Bell size={18} />
        </div>
        <h1 class="text-3xl font-bold tracking-tight">Notifications</h1>
      </div>
      <p class="text-xs opacity-60 font-medium">{unread} unread updates requiring your attention.</p>
    </div>
    <div class="flex gap-2">
      {#if unread > 0}
        <button class="btn btn-ghost btn-sm gap-2" onclick={handleMarkAllRead}>
          <CheckCheck size={16} /> Mark all read
        </button>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center py-20">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else if notifications.length === 0}
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body items-center text-center py-16">
        <BellOff size={48} class="opacity-20 mb-2" />
        <h2 class="text-lg font-semibold opacity-60">No notifications</h2>
        <p class="text-sm opacity-40">You're all caught up!</p>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-1">
      {#each notifications as notif (notif.id)}
        {@const Icon = iconMap[notif.type] ?? Bell}
        <div
          class="flex items-start gap-3 p-3 rounded-lg transition-colors {notif.is_read
            ? 'opacity-60'
            : 'bg-base-200'}"
          role="button"
          tabindex="0"
          onclick={() => {
            if (!notif.is_read) markAsRead(notif.id);
            if (notif.ticket_id) {
              (navigate as any)(`/tickets/${notif.ticket_id}`);
            } else if (notif.type === 'message_received') {
              (navigate as any)("/messages");
            }
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") e.currentTarget.click();
          }}
        >
          <div
            class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 {notif.is_read
              ? 'bg-base-300'
              : 'bg-primary/15 text-primary'}"
          >
            <Icon size={16} />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm {notif.is_read ? '' : 'font-medium'}">
              {notif.message}
            </p>
            <p class="text-xs opacity-50 mt-0.5">{timeAgo(notif.created_at)}</p>
          </div>
          {#if !notif.is_read}
            <div class="w-2 h-2 rounded-full bg-primary shrink-0 mt-2"></div>
          {/if}
          <button
            class="btn btn-ghost btn-xs opacity-40 hover:opacity-100"
            onclick={(e) => {
              e.stopPropagation();
              handleDelete(notif.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      {/each}
    </div>

    <div class="flex justify-center">
      <Pagination {pagination} onPageChange={loadPage} />
    </div>
  {/if}
</div>
