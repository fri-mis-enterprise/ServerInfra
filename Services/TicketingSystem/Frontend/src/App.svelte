<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from "svelte";
  import { themeChange } from "theme-change";
  import { initPushNotifications } from "./lib/pwa";
  import type { Snippet } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import {
    getCurrentUser,
    hasRole,
    displayName,
    userInitials,
  } from "./stores/user.svelte";
  import { getUnreadCount } from "./stores/notifications.svelte";
  import { getMessageUnreadCount } from "./stores/messages.svelte";
  import { navigate, isActive, route } from "./router.svelte";
  import auth from "./auth.svelte";
  import ModalProvider from "./components/ModalProvider.svelte";
  import AlertProvider from "./components/AlertProvider.svelte";
  import ReloadPrompt from "./components/ReloadPrompt.svelte";
  import {
    LayoutDashboard,
    Ticket,
    Plus,
    ListTodo,
    ClipboardCheck,
    Bell,
    MessageSquare,
    Users,
    ScrollText,
    Star,
    BarChart3,
    Settings,
    LogOut,
    Menu,
    Sun,
    Moon,
    ChevronLeft,
    User as UserIcon,
  } from "lucide-svelte";

  type NavItem = {
    icon: typeof LayoutDashboard;
    label: string;
    href: string;
    roles?: string[];
    badge?: () => number;
  };

  let { children }: { children: Snippet } = $props();

  let user = $derived(getCurrentUser());
  let unread = $derived(getUnreadCount());
  let msgUnread = $derived(getMessageUnreadCount());
  let isDark = $state(false);
  let drawerOpen = $state(false);
  let closingFromPopstate = false;

  onMount(() => {
    themeChange(false);
    const theme = document.documentElement.getAttribute("data-theme");
    isDark = theme === "ticketing";

    const currentUser = getCurrentUser();
    if (currentUser) {
      initPushNotifications(currentUser).catch(console.error);
    }

    const handlePopstate = () => {
      if (window.location.hash !== "#drawer" && drawerOpen) {
        closingFromPopstate = true;
        drawerOpen = false;
        setTimeout(() => {
          closingFromPopstate = false;
        }, 100);
      }
    };

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  });

  const navItems: NavItem[] = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/" },
    { icon: Plus, label: "New Ticket", href: "/tickets/new" },
    { icon: ListTodo, label: "My Tickets", href: "/my-tickets" },
    {
      icon: MessageSquare,
      label: "Messages",
      href: "/messages",
      badge: () => msgUnread,
    },
    {
      icon: ClipboardCheck,
      label: "My Approvals",
      href: "/approvals",
      roles: ["approver", "admin"],
    },
    {
      icon: Bell,
      label: "Notifications",
      href: "/notifications",
      badge: () => unread,
    },
  ];

  const adminItems: NavItem[] = [
    { icon: Users, label: "Users", href: "/admin/users", roles: ["admin"] },
    {
      icon: ScrollText,
      label: "Audit Log",
      href: "/admin/audit",
      roles: ["admin", "mis"],
    },
    { icon: Star, label: "CSAT", href: "/admin/csat", roles: ["admin", "mis"] },
    { icon: BarChart3, label: "Reports", href: "/admin/reports", roles: ["admin", "mis"] },
    {
      icon: Settings,
      label: "Management",
      href: "/admin/management",
      roles: ["admin"],
    },
  ];

  let pageTitle = $derived(
    [...navItems, ...adminItems].find((item) => item.href === route.pathname)?.label
      ?? (route.pathname.startsWith('/tickets/') ? 'Ticket details'
        : route.pathname.startsWith('/messages') ? 'Messages' : 'My profile'),
  );

  function canSee(item: NavItem): boolean {
    if (!item.roles) return true;
    return item.roles.some((r) => hasRole(r as any));
  }

  function toggleTheme() {
    isDark = !isDark;
    const newTheme = isDark ? "ticketing" : "ticketing-light";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
  }

  function handleDrawerChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    drawerOpen = checked;
    if (checked) {
      pushState('#drawer', {});
    } else if (!closingFromPopstate && window.location.hash === "#drawer") {
      window.history.back();
    }
  }

  function closeDrawer() {
    if (drawerOpen) {
      drawerOpen = false;
      if (window.location.hash === "#drawer") {
        const url = new URL(window.location.href);
        url.hash = "";
        replaceState(url, {});
      }
    }
  }
</script>

{#if !user}
  <div class="min-h-screen bg-base-200 flex items-center justify-center p-4 sm:p-8">
    {@render children()}
  </div>
{:else}
  <div class="drawer lg:drawer-open h-screen overflow-hidden">
    <input
      id="app-drawer"
      type="checkbox"
      class="drawer-toggle"
      bind:checked={drawerOpen}
      onchange={handleDrawerChange}
    />
    <div class="drawer-content flex flex-col h-full overflow-hidden">
      <!-- Navbar -->
      <nav
        class="navbar bg-base-100 border-b border-base-300 sticky top-0 z-30 px-4 md:px-6 gap-2 min-h-16"
      >
        <label
          for="app-drawer"
          aria-label="Open navigation"
          class="btn btn-ghost btn-sm btn-square lg:hidden"
          ><Menu size={20} /></label
        >
        <div class="flex-1 flex items-center gap-2">
          {#if !isActive("/")}
            <button
              class="btn btn-ghost btn-sm btn-square"
              aria-label="Go back"
              onclick={() => navigate(-1)}><ChevronLeft size={20} /></button
            >
          {/if}
          <span class="text-sm font-semibold truncate">{pageTitle}</span>
        </div>

        <button class="btn btn-ghost btn-sm btn-square" onclick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {#if isDark}<Sun size={18} />{:else}<Moon size={18} />{/if}
        </button>

        <a
          href="{resolve('/')}messages"
          class="btn btn-ghost btn-sm btn-square indicator"
          title="Messages"
        >
          <MessageSquare size={18} />
          {#if msgUnread > 0}
            <span class="indicator-item badge badge-primary badge-xs"
              >{msgUnread}</span
            >
          {/if}
        </a>

        <a
          href="{resolve('/')}notifications"
          class="btn btn-ghost btn-sm btn-square indicator"
          title="Notifications"
        >
          <Bell size={18} />
          {#if unread > 0}
            <span class="indicator-item badge badge-primary badge-xs"
              >{unread}</span
            >
          {/if}
        </a>

        <details class="dropdown dropdown-end">
          <summary class="btn btn-ghost btn-sm gap-2">
            <div class="avatar avatar-placeholder">
              <div class="bg-neutral text-neutral-content w-8 rounded-full">
                <span class="text-xs">{userInitials()}</span>
              </div>
            </div>
            <span class="hidden sm:inline text-sm whitespace-nowrap"
              >{displayName()}</span
            >
          </summary>
          <ul
            class="dropdown-content menu bg-base-200 rounded-box z-50 w-52 p-2 shadow-lg mt-2"
          >
            <li class="menu-title text-xs opacity-60">
              {user.roles?.map((r) => String(r).toUpperCase()).join(", ") ||
                "USER"}
            </li>
            <li><a href="{resolve('/')}profile"><UserIcon size={16} /> Profile</a></li>
            <li>
              <button onclick={() => auth.logout()}
                ><LogOut size={16} /> Logout</button
              >
            </li>
          </ul>
        </details>
      </nav>

      <!-- Main Layout -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <main
          class="workspace flex-1 flex flex-col min-w-0 min-h-0 bg-base-200 p-4 md:p-6 {route.pathname?.startsWith(
            '/messages',
          )
            ? 'overflow-hidden'
            : 'overflow-y-auto'}"
        >
          {@render children()}
        </main>
      </div>
    </div>

    <!-- Navigation Drawer -->
    <div class="drawer-side z-40">
      <label for="app-drawer" class="drawer-overlay" aria-label="Close navigation"></label>
      <aside
        class="app-sidebar bg-base-100 w-64 min-h-full flex flex-col border-r border-base-300"
      >
        <div class="flex items-center gap-3 px-5 min-h-16 border-b border-base-300">
          <div class="size-8 bg-primary text-primary-content rounded-lg flex items-center justify-center"><Ticket size={18} /></div>
          <div>
            <h2 class="text-sm font-semibold tracking-normal">MIS Support</h2>
            <p class="text-xs text-base-content/60">Ticketing system</p>
          </div>
        </div>
        <ul class="menu menu-md flex-1 p-3 gap-1 w-full">
          {#each navItems as item}
            {#if canSee(item)}
              <li>
                <a
                  href={resolve('/').slice(0, -1) + item.href}
                  onclick={closeDrawer}
                  aria-current={isActive(item.href as any) ? 'page' : undefined}
                  class="flex items-center justify-between px-3 py-2 rounded-lg"
                >
                  <div class="flex items-center gap-3">
                    <item.icon size={18} />
                    {item.label}
                  </div>
                  {#if item.badge && item.badge() > 0}
                    <span class="badge badge-primary badge-sm font-bold"
                      >{item.badge()}</span
                    >
                  {/if}
                </a>
              </li>
            {/if}
          {/each}

          {#if adminItems.some(canSee)}
            <li aria-hidden="true" class="border-t border-base-300 my-3"></li>
            <li
              class="menu-title px-3 text-xs font-medium text-base-content/60 mb-1"
            >
              Administration
            </li>
            {#each adminItems as item}
              {#if canSee(item)}
                <li>
                  <a
                    href={resolve('/').slice(0, -1) + item.href}
                    onclick={closeDrawer}
                    aria-current={isActive(item.href as any) ? 'page' : undefined}
                    class="flex items-center gap-3 px-3 py-2 rounded-lg"
                  >
                    <item.icon size={18} />
                    {item.label}
                  </a>
                </li>
              {/if}
            {/each}
          {/if}
        </ul>
      </aside>
    </div>
  </div>
{/if}

<ModalProvider />
<AlertProvider />
<ReloadPrompt />
