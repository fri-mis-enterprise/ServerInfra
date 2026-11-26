<script lang="ts">
  import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleUser,
    Menu,
  } from "lucide-svelte";

  type NavItem = {
    icon: typeof ChevronDown;
    label: string;
    href?: string;
    sublinks?: NavItem[];
  };

  // List of navigation items
  let navitems: NavItem[] = [
    { icon: ChevronLeft, label: "Home" },
    {
      icon: ChevronDown,
      label: "Options",
      sublinks: [
        { icon: ChevronRight, label: "Sublink 1" },
        { icon: ChevronRight, label: "Sublink 2" },
      ],
    },
  ];
</script>

<nav class="nav">
  <div class="drawer">
    <h1>Menu</h1>
    {@render navcontents()}
  </div>

  <button>
    <Menu />
  </button>

  <div class="profile">
    <CircleUser />
  </div>
</nav>

{#snippet navcontents()}
  {#each navitems as item}
    {#if item.sublinks}
      <details>
        <summary> <item.icon /> {item.label} </summary>
        {#each item.sublinks as sublink}
          <a href={sublink.href}>
            <sublink.icon />
            {sublink.label}
          </a>
        {/each}
      </details>
    {:else}
      <a href={item.href}> <item.icon /> {item.label} </a>
    {/if}
  {/each}
{/snippet}

<style>
  nav {
    display: flex;
    align-items: center;
    border: 1px solid #ccc;

    .profile {
      margin-left: auto;
    }
  }
</style>
