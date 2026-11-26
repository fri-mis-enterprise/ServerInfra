<script lang="ts">
  import { onMount } from "svelte";
  import { getAdminUsers, createUser, updateUser, deactivateUser, assignRole, removeRole as revokeRole } from "../../../lib/admin.remote";
  import { getAgentReport } from "../../../lib/csat.remote";
  import { adminUserListSchema, createUserSchema, updateUserDataSchema, roleSchema } from "../../../lib/validation/admin";
  import { getReferenceData } from "../../../lib/reference.remote";
  import type { User, Role, Department } from "../../../lib/types";
  import Pagination from "../../../components/Pagination.svelte";
  import { simpleConfirm, openCustomModal, triggerAlert } from "../../../stores/ui.svelte";
  import ReportModal from "../../../components/ReportModal.svelte";
  import {
    Search,
    Plus,
    Pencil,
    Trash2,
    Shield,
    X,
    UserPlus,
    Users,
    ClipboardList,
    ChevronUp,
    ChevronDown,
  } from "lucide-svelte";

  let users = $state<User[]>([]);
  let pagination = $state({ page: 1, limit: 20, total: 0, pages: 0 });
  let loading = $state(true);
  let departments = $state<Department[]>([]);
  let sortField = $state("created_at");
  let sortOrder = $state<"asc" | "desc">("desc");

  // Filters
  let search = $state("");
  let roleFilter = $state("");
  let deptFilter = $state("");
  let activeFilter = $state("");

  // Modal state
  let showModal = $state(false);
  let editingUser = $state<User | null>(null);
  let formData = $state({
    first_name: "",
    last_name: "",
    email: "",
    username: "",
    password: "",
    position: "",
    department_id: undefined as number | undefined,
    is_active: true,
  });
  let modalError = $state("");
  let modalLoading = $state(false);

  // Role modal
  let showRoleModal = $state(false);
  let roleTarget = $state<User | null>(null);
  let newRole = $state<Role>("user");

  onMount(async () => {
    await loadUsers();
    try {
      await getReferenceData().refresh();
      departments = (await getReferenceData()).departments;
    } catch { /* non-critical */ }
  });

  async function loadUsers(page = 1) {
    loading = true;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    params.set("sort", sortField);
    params.set("order", sortOrder);
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    if (deptFilter) params.set("department_id", deptFilter);
    if (activeFilter) params.set("is_active", activeFilter);

    try {
      const result = getAdminUsers(adminUserListSchema.parse(Object.fromEntries(params)));
      await result.refresh();
      const res = await result;
      if (res) {
        // Flatten roles if they are objects
        users = res.data.map((u: any) => ({
          ...u,
          roles: u.roles.map((r: any) => typeof r === 'object' ? r.role : r)
        }));
        pagination = res.pagination;
      }
    } catch (error) { triggerAlert(error instanceof Error ? error.message : 'Failed to load users', 'error'); }
    loading = false;
  }

  function handleSort(field: string) {
    if (sortField === field) {
      sortOrder = sortOrder === "asc" ? "desc" : "asc";
    } else {
      sortField = field;
      sortOrder = "asc";
    }
    loadUsers(1);
  }

  function openCreate() {
    editingUser = null;
    formData = { first_name: "", last_name: "", email: "", username: "", password: "", position: "", department_id: undefined, is_active: true };
    modalError = "";
    showModal = true;
  }

  function openEdit(user: User) {
    editingUser = user;
    formData = {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      username: user.username,
      password: "",
      position: user.position ?? "",
      department_id: user.department_id ?? undefined,
      is_active: user.is_active ?? true,
    };
    modalError = "";
    showModal = true;
  }

  async function saveUser(e: Event) {
    e.preventDefault();
    modalLoading = true;
    modalError = "";
    try {
      const body: Record<string, unknown> = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        username: formData.username,
        is_active: formData.is_active,
      };

      if (formData.password) body.password = formData.password;
      if (formData.position) body.position = formData.position;

      // Explicitly send department_id (allow null)
      body.department_id = formData.department_id ?? null;

      if (editingUser) {
        await updateUser({ id: editingUser.id, data: updateUserDataSchema.parse(body) });
      } else {
        await createUser(createUserSchema.parse(body));
      }
      showModal = false;
      await loadUsers(pagination.page);
    } catch (e: any) {
      modalError = e?.message ?? "Save failed";
    }
    modalLoading = false;
  }

  const roleColors: Record<string, string> = {
    admin: "badge-error",
    mis: "badge-info",
    approver: "badge-warning",
    user: "badge-neutral",
  };

  async function deleteUser(user: User) {
    if (!(await simpleConfirm(`Deactivate ${user.first_name} ${user.last_name}?`, true))) return;
    try {
      await deactivateUser(user.id);
      await loadUsers(pagination.page);
    } catch (error) { triggerAlert(error instanceof Error ? error.message : 'Failed to deactivate user', 'error'); }
  }

  function openRoles(user: User) {
    roleTarget = user;
    newRole = "user";
    showRoleModal = true;
  }

  async function addRole() {
    if (!roleTarget) return;
    try {
      await assignRole({ id: roleTarget.id, role: newRole });
      showRoleModal = false;
      await loadUsers(pagination.page);
    } catch (error) { triggerAlert(error instanceof Error ? error.message : 'Failed to assign role', 'error'); }
  }

  async function removeRole(userId: number, role: string) {
    if (!(await simpleConfirm(`Remove role "${role}"?`, true))) return;
    try {
      await revokeRole({ id: userId, role: roleSchema.parse(role) });
      await loadUsers(pagination.page);
    } catch (error) { triggerAlert(error instanceof Error ? error.message : 'Failed to remove role', 'error'); }
  }

  async function showReport(agentId: number) {
    try {
      const result = getAgentReport({ agent_id: agentId });
      await result.refresh();
      const data = await result;
      if (data) {
        openCustomModal(ReportModal, { data });
      }
    } catch (error) { triggerAlert(error instanceof Error ? error.message : 'Failed to load agent report', 'error'); }
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex flex-col">
      <div class="flex items-center gap-3 mb-1">
        <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Users size={18} />
        </div>
        <h1 class="text-3xl font-bold tracking-tight">User Management</h1>
      </div>
      <p class="text-xs opacity-60 font-medium">{pagination.total} registered users in the system.</p>
    </div>
    <button class="btn btn-primary gap-2 shadow-lg shadow-primary/20" onclick={openCreate}>
      <UserPlus size={18} /> Add User
    </button>
  </div>

  <!-- Filters -->
  <div class="card bg-base-200 border border-base-300 shadow-sm overflow-hidden">
    <div class="p-3">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          loadUsers(1);
        }}
        class="flex flex-col md:flex-row gap-3 items-center w-full"
      >
        <div class="join w-full flex-1 flex-nowrap">
          <div class="join-item flex items-center px-3 bg-base-100 border border-base-300 border-r-0">
            <Search size={14} class="opacity-50" />
          </div>
          <input
            id="user-search"
            type="text"
            class="input input-bordered input-sm join-item flex-1 focus:outline-none text-xs"
            placeholder="Search users..."
            bind:value={search}
          />
          <select
            class="select select-bordered select-sm join-item w-auto hidden sm:block focus:outline-none whitespace-nowrap text-xs shrink-0 min-w-fit bg-none appearance-none pr-3"
            bind:value={roleFilter}
            onchange={() => loadUsers(1)}
          >
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="mis">MIS</option>
            <option value="approver">Approver</option>
            <option value="user">User</option>
          </select>
          <select
            class="select select-bordered select-sm join-item w-auto hidden md:block focus:outline-none whitespace-nowrap text-xs shrink-0 min-w-fit bg-none appearance-none pr-3"
            bind:value={activeFilter}
            onchange={() => loadUsers(1)}
          >
            <option value="">All Statuses</option>
            <option value="true">Active Only</option>
            <option value="false">Inactive Only</option>
          </select>
          <button type="submit" class="btn btn-primary btn-sm join-item px-6 text-xs">Search</button>
        </div>

        <div class="flex items-center gap-3 w-full md:w-auto md:hidden px-1">
           <span class="text-xs font-bold opacity-50 uppercase">Filters</span>
           <!-- Mobile filters can be added here if needed, or just rely on the Search button -->
        </div>
      </form>
    </div>
  </div>

  <!-- Table -->
  <div class="card bg-base-200 shadow-sm">
    <div class="card-body p-0">
      {#if loading}
        <div class="flex justify-center py-12"><span class="loading loading-spinner loading-lg text-primary"></span></div>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => handleSort('last_name')}>
                  <div class="flex items-center gap-1">
                    Name
                    {#if sortField === 'last_name' || sortField === 'first_name'}
                      {#if sortOrder === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
                    {/if}
                  </div>
                </th>
                <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => handleSort('username')}>
                  <div class="flex items-center gap-1">
                    Username
                    {#if sortField === 'username'}
                      {#if sortOrder === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
                    {/if}
                  </div>
                </th>
                <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => handleSort('email')}>
                  <div class="flex items-center gap-1">
                    Email
                    {#if sortField === 'email'}
                      {#if sortOrder === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
                    {/if}
                  </div>
                </th>
                <th>Department</th>
                <th>Roles</th>
                <th class="cursor-pointer hover:bg-base-300 transition-colors select-none" onclick={() => handleSort('created_at')}>
                  <div class="flex items-center gap-1">
                    Created
                    {#if sortField === 'created_at'}
                      {#if sortOrder === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
                    {/if}
                  </div>
                </th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each users as user (user.id)}
                <tr class="hover:bg-base-300/30">
                  <td class="font-medium">{user.first_name} {user.last_name}</td>
                  <td class="font-mono text-sm opacity-70">{user.username}</td>
                  <td class="text-sm">{user.email}</td>
                  <td class="text-sm">{user.department?.name ?? "—"}</td>
                  <td>
                    <div class="flex flex-wrap gap-1.5">
                      {#each user.roles as role}
                        <span class="badge badge-sm badge-soft {roleColors[role] ?? 'badge-neutral'} gap-1 font-bold uppercase text-[10px]">
                          {role}
                          <button class="btn btn-ghost btn-xs btn-circle h-4 w-4 min-h-0 p-0 hover:bg-black/10" onclick={() => removeRole(user.id, role)}>
                            <X size={10} />
                          </button>
                        </span>
                      {/each}
                      <button class="btn btn-ghost btn-xs btn-circle h-6 w-6 min-h-0" onclick={() => openRoles(user)} title="Add Role">
                        <Plus size={14} />
                      </button>
                    </div>
                  </td>
                  <td class="text-xs opacity-60">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                  </td>
                  <td>
                    <span class="badge badge-xs {user.is_active ? 'badge-success' : 'badge-error'}">
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div class="flex gap-1">
                      {#if user.roles.includes('mis')}
                        <button class="btn btn-ghost btn-xs text-primary" onclick={() => showReport(user.id)} title="Performance Report">
                            <ClipboardList size={14} />
                        </button>
                      {/if}
                      <button class="btn btn-ghost btn-xs" onclick={() => openEdit(user)}><Pencil size={14} /></button>
                      <button class="btn btn-ghost btn-xs text-error" onclick={() => deleteUser(user)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="7" class="text-center py-8 opacity-50">No users found</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="flex justify-center p-4">
          <Pagination {pagination} onPageChange={loadUsers} />
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- ─── Create/Edit User Modal ─────────────────────────────── -->
{#if showModal}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="text-lg font-bold">{editingUser ? "Edit User" : "Create User"}</h3>
      {#if modalError}
        <div role="alert" class="alert alert-error alert-soft text-sm mt-3">{modalError}</div>
      {/if}
      <form onsubmit={saveUser} class="flex flex-col gap-3 mt-4">
        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <label class="label text-xs" for="edit-fname">First name</label>
            <input id="edit-fname" type="text" class="input input-bordered input-sm w-full" required bind:value={formData.first_name} />
          </fieldset>
          <fieldset class="fieldset">
            <label class="label text-xs" for="edit-lname">Last name</label>
            <input id="edit-lname" type="text" class="input input-bordered input-sm w-full" required bind:value={formData.last_name} />
          </fieldset>
        </div>
        <fieldset class="fieldset">
          <label class="label text-xs" for="edit-email">Email</label>
          <input id="edit-email" type="email" class="input input-bordered input-sm w-full" required bind:value={formData.email} />
        </fieldset>
        <fieldset class="fieldset">
          <label class="label text-xs" for="edit-user">Username</label>
          <input id="edit-user" type="text" class="input input-bordered input-sm w-full" required bind:value={formData.username} />
        </fieldset>
        <fieldset class="fieldset">
          <label class="label text-xs" for="edit-pass">Password {editingUser ? "(leave blank to keep)" : ""}</label>
          <input id="edit-pass" type="password" class="input input-bordered input-sm w-full" bind:value={formData.password} required={!editingUser} />
        </fieldset>
        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <label class="label text-xs" for="edit-pos">Position</label>
            <input id="edit-pos" type="text" class="input input-bordered input-sm w-full" bind:value={formData.position} />
          </fieldset>
          <fieldset class="fieldset">
            <label class="label text-xs" for="edit-dept">Department</label>
            <select id="edit-dept" class="select select-bordered select-sm w-full" bind:value={formData.department_id}>
              <option value={undefined}>— None —</option>
              {#each departments as dept}
                <option value={dept.id}>{dept.name}</option>
              {/each}
            </select>
          </fieldset>
        </div>
        <label class="label cursor-pointer justify-start gap-2">
          <input type="checkbox" class="checkbox checkbox-sm" bind:checked={formData.is_active} />
          <span class="text-sm">Active</span>
        </label>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={() => (showModal = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={modalLoading}>
            {#if modalLoading}<span class="loading loading-spinner loading-xs"></span>{/if}
            {editingUser ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" onclick={() => (showModal = false)} aria-label="close"></button>
  </div>
{/if}

<!-- ─── Add Role Modal ─────────────────────────────────────── -->
{#if showRoleModal && roleTarget}
  <div class="modal modal-open">
    <div class="modal-box max-w-xs">
      <h3 class="text-lg font-bold">Add Role</h3>
      <p class="text-sm opacity-60 mt-1">for {roleTarget.first_name} {roleTarget.last_name}</p>
      <fieldset class="fieldset mt-4">
        <select class="select select-bordered w-full" bind:value={newRole}>
          <option value="user">User</option>
          <option value="mis">MIS</option>
          <option value="approver">Approver</option>
          <option value="admin">Admin</option>
        </select>
      </fieldset>
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (showRoleModal = false)}>Cancel</button>
        <button class="btn btn-primary" onclick={addRole}>
          <Shield size={14} /> Assign
        </button>
      </div>
    </div>
    <button class="modal-backdrop" onclick={() => (showRoleModal = false)} aria-label="close"></button>
  </div>
{/if}
