<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { getActiveUsers, getUserDirectory } from "../lib/users.remote";
  import type { UserContact } from "../lib/server/user-reads";
  import { Search, MessageSquare, User as UserIcon } from "lucide-svelte";
  import { navigate } from "../router.svelte";

  let activeUsers = $state<UserContact[]>([]);
  let allUsers = $state<UserContact[]>([]);
  let loading = $state(true);
  let interval: any;

  onMount(async () => {
    await loadContacts();
    interval = setInterval(loadContacts, 30000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  async function loadContacts() {
    try {
      await Promise.all([getActiveUsers().refresh(), getUserDirectory().refresh()]);
      const [active, all] = await Promise.all([
        getActiveUsers(),
        getUserDirectory(),
      ]);
      if (active) activeUsers = active;
      if (all) allUsers = all;
    } catch {
      /* handled */
    }
    loading = false;
  }

  function getContactName(contact: UserContact) {
    return `${contact.first_name} ${contact.last_name}`;
  }
</script>

<aside
  class="w-72 bg-base-200 border-l border-base-300 flex flex-col h-full hidden xl:flex"
>
  <div class="p-4 border-b border-base-300">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xs font-black uppercase tracking-widest opacity-40">
        Contacts
      </h2>
      <button
        class="btn btn-ghost btn-xs btn-circle"
        onclick={() => navigate("/messages")}
      >
        <MessageSquare size={14} />
      </button>
    </div>
    <div class="join w-full">
      <div
        class="join-item flex items-center px-2 bg-base-100 border border-base-300 border-r-0"
      >
        <Search size={12} class="opacity-40" />
      </div>
      <input
        type="text"
        class="input input-bordered input-xs join-item flex-1 focus:outline-none"
        placeholder="Search..."
      />
    </div>
  </div>

  <div class="flex-1 overflow-y-auto py-2">
    {#if loading}
      <div class="flex justify-center py-10">
        <span class="loading loading-spinner loading-sm text-primary"></span>
      </div>
    {:else}
      <!-- Active Users Section -->
      {#if activeUsers.length > 0}
        <h3 class="px-4 text-[10px] font-bold opacity-30 uppercase mb-2 mt-4">
          Online
        </h3>
        {#each activeUsers as contact (contact.id)}
          <button
            onclick={async () => await (navigate as any)(`/messages/${contact.id}`)}
            class="w-full px-4 py-2 flex items-center gap-3 hover:bg-base-300 transition-colors group text-left"
          >
            <div class="avatar online">
              <div
                class="w-8 h-8 rounded-full bg-neutral text-neutral-content flex items-center justify-center text-[10px] font-bold"
              >
                {contact.first_name[0]}{contact.last_name[0]}
              </div>
            </div>
            <p class="text-xs font-bold truncate">{getContactName(contact)}</p>
          </button>
        {/each}
        {/if}

        <!-- All Contacts Section -->
        <h3 class="px-4 text-[10px] font-bold opacity-30 uppercase mb-2 mt-4">
        All Staff
        </h3>
        {#each allUsers as contact (contact.id)}
        <button
          onclick={async () => await (navigate as any)(`/messages/${contact.id}`)}
          class="w-full px-4 py-2 flex items-center gap-3 hover:bg-base-300 transition-colors group text-left"
        >
          <div class="avatar">
            <div
              class="w-8 h-8 rounded-full bg-base-300 flex items-center justify-center text-[10px] font-bold opacity-60"
            >
              {contact.first_name[0]}{contact.last_name[0]}
            </div>
          </div>
          <p class="text-xs font-bold truncate">{getContactName(contact)}</p>
        </button>
        {/each}
    {/if}
  </div>

  <div class="p-4 border-t border-base-300 bg-base-300/50">
    <button
      class="btn btn-primary btn-sm btn-block gap-2 text-[10px] font-black uppercase tracking-widest"
      onclick={() => navigate("/messages")}
    >
      <MessageSquare size={14} /> Open Messages
    </button>
  </div>
</aside>
