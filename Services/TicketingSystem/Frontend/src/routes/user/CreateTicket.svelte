<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { z } from "zod";
  import { createTicket } from "../../lib/ticket-actions.remote";
  import { createTicketSchema } from "../../lib/validation/ticket-writes";
  import { api } from "../../lib/api";
  import { getAffectedSystems, getRequestTypes, getDepartments, getHardwareItems } from "../../stores/reference.svelte";
  import { navigate } from "../../router.svelte";
  import { getCurrentUser, hasRole } from "../../stores/user.svelte";
  import RichTextEditor from "../../components/RichTextEditor.svelte";
  import SearchableSelect from "../../components/SearchableSelect.svelte";
  import { Send, HelpCircle, Paperclip, Upload, X, FileText, Check, ShieldCheck, TriangleAlert } from "lucide-svelte";
  import { createTicketTour, startTourIfNeverSeen } from "../../lib/tutorial";

  const draftSchema = createTicketSchema.partial().extend({
    title: z.string().optional(), description: z.string().optional(), due_date: z.string().optional(),
    createdTicketId: z.number().int().positive().nullable().optional(),
  });
  let title = $state("");
  let description = $state("");
  let priority = $state("medium");
  let request_type_id = $state<number | undefined>();
  let affected_system_id = $state<number | undefined>();
  let hardware_item_id = $state<number | undefined>();
  let department_id = $state<number | undefined>();
  let requires_approval = $state(false);
  let due_date = $state("");
  let other_request_type = $state("");
  let other_affected_system = $state("");
  let other_department = $state("");
  let files = $state<{ file: File; preview?: string }[]>([]);
  let fileInput: HTMLInputElement;
  let form: HTMLFormElement;
  let dragDepth = $state(0);
  let error = $state("");
  let fileError = $state("");
  let fieldErrors = $state<Record<string, string>>({});
  let loading = $state(false);
  let createdTicketId = $state<number | null>(null);
  let completed = $state(false);
  let draftKey = $state("");
  let draftStatus = $state("");
  let restored = $state(false);

  const systems = $derived(getAffectedSystems());
  const requestTypes = $derived(getRequestTypes());
  const departments = $derived(getDepartments());
  const hardwareOptions = $derived(getHardwareItems());
  const requestName = $derived(requestTypes.find(item => item.id === request_type_id)?.name);
  const isHardwareIssue = $derived(requestName === "Hardware Issue");
  const isOtherRequestType = $derived(requestName === "Others");
  const isOtherAffectedSystem = $derived(systems.find(item => item.id === affected_system_id)?.name === "Others");
  const isOtherDepartment = $derived(departments.find(item => item.id === department_id)?.name === "Others");
  const snapshot = $derived(JSON.stringify({ title, description, priority, request_type_id, affected_system_id,
    hardware_item_id, department_id, requires_approval, due_date, other_request_type,
    other_affected_system, other_department, createdTicketId }));
  const hasDraft = $derived(!!(title || description || request_type_id || affected_system_id || hardware_item_id ||
    department_id || requires_approval || due_date || other_request_type || other_affected_system || other_department || priority !== "medium" || createdTicketId));
  const slaHint = $derived(({ low: "5 days", medium: "3 days", high: "24 hours", critical: "4 hours" } as Record<string, string>)[priority]);

  onMount(() => {
    const user = getCurrentUser();
    if (user) {
      draftKey = `ticket_draft:${user.id}`;
      try {
        const stored = localStorage.getItem(draftKey);
        if (stored) {
          const draft = draftSchema.parse(JSON.parse(stored));
          title = draft.title ?? ""; description = draft.description ?? ""; priority = draft.priority ?? "medium";
          request_type_id = draft.request_type_id ?? undefined; affected_system_id = draft.affected_system_id ?? undefined;
          hardware_item_id = draft.hardware_item_id ?? undefined; department_id = draft.department_id ?? undefined;
          requires_approval = draft.requires_approval ?? false; due_date = draft.due_date ?? "";
          other_request_type = draft.other_request_type ?? ""; other_affected_system = draft.other_affected_system ?? "";
          other_department = draft.other_department ?? ""; createdTicketId = draft.createdTicketId ?? null;
          restored = true;
        }
      } catch { draftStatus = "Draft could not be restored."; }
    }
    startTourIfNeverSeen("ticket_create", createTicketTour);
  });

  function saveDraft(value: string) {
    if (!draftKey || completed) return;
    try {
      localStorage.setItem(draftKey, value);
      draftStatus = "Draft saved on this device";
    } catch { draftStatus = "Draft could not be saved on this device."; }
  }

  $effect(() => {
    const value = snapshot;
    if (!draftKey || completed || !hasDraft) return;
    const timer = setTimeout(() => saveDraft(value), 400);
    return () => clearTimeout(timer);
  });

  onDestroy(() => {
    // Save edits made just before navigating away, before the debounce fires.
    if (hasDraft && !completed) saveDraft(snapshot);
    files.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview); });
  });

  function discardDraft() {
    if (loading || createdTicketId) return;
    title = ""; description = ""; priority = "medium";
    request_type_id = affected_system_id = hardware_item_id = department_id = undefined;
    requires_approval = false; due_date = other_request_type = other_affected_system = other_department = "";
    files.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview); });
    files = []; error = fileError = draftStatus = ""; fieldErrors = {}; restored = false;
    try { if (draftKey) localStorage.removeItem(draftKey); }
    catch { draftStatus = "Saved draft could not be removed from this device."; }
  }

  function addFiles(incoming: File[]) {
    if (loading) return;
    const additions = incoming.filter(file => !files.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified));
    try {
      api.validateUploads([...files.map(item => item.file), ...additions]);
      files = [...files, ...additions.map(file => ({ file, preview: /^image\/(jpeg|png|webp|gif)$/.test(file.type) ? URL.createObjectURL(file) : undefined }))];
      fileError = "";
    } catch (failure) { fileError = failure instanceof Error ? failure.message : "Could not add files."; }
  }

  function removeFile(index: number) {
    if (files[index].preview) URL.revokeObjectURL(files[index].preview!);
    files = files.filter((_, position) => position !== index);
    fileError = "";
  }

  function handlePaste(event: ClipboardEvent) {
    const images = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith("image/"));
    if (images.length) { event.preventDefault(); addFiles(images); }
  }

  async function focusError() {
    await tick();
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }

  async function finishTicket() {
    if (!createdTicketId) return;
    completed = true;
    try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* Navigation still works without storage. */ }
    await navigate("/tickets/:id", { params: { id: String(createdTicketId) } });
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (loading) return;
    fieldErrors = {}; error = "";
    if (!createdTicketId) {
      const parsedDate = due_date ? new Date(due_date) : undefined;
      const result = createTicketSchema.safeParse({ title, description, priority,
        request_type_id, affected_system_id: isHardwareIssue ? undefined : affected_system_id,
        hardware_item_id: isHardwareIssue ? hardware_item_id : undefined, department_id, requires_approval,
        other_request_type: isOtherRequestType ? other_request_type : undefined,
        other_affected_system: !isHardwareIssue && isOtherAffectedSystem ? other_affected_system : undefined,
        other_department: isOtherDepartment ? other_department : undefined,
        due_date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : due_date || undefined,
      });
      if (!result.success) for (const issue of result.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      if (title.trim().length < 5) fieldErrors.title = "Use at least 5 characters for a clear subject.";
      const content = new DOMParser().parseFromString(description, "text/html").body.textContent ?? "";
      if (content.trim().length < 20) fieldErrors.description = "Describe the issue in at least 20 characters.";
      for (const [field, needed, value] of [
        ["other_request_type", isOtherRequestType, other_request_type],
        ["other_affected_system", !isHardwareIssue && isOtherAffectedSystem, other_affected_system],
        ["other_department", isOtherDepartment, other_department],
      ] as const) if (needed && !value.trim()) fieldErrors[field] = "Please specify a value.";
      if (!result.success || Object.keys(fieldErrors).length) { await focusError(); return; }
      loading = true;
      try {
        api.validateUploads(files.map(item => item.file));
        const ticket = await createTicket(result.data);
        createdTicketId = ticket.id;
        // Persist the ID before uploading so refresh/retry cannot create another ticket.
        saveDraft(JSON.stringify({ ...JSON.parse(snapshot), createdTicketId }));
      } catch (failure) {
        error = failure instanceof Error ? failure.message : "Could not create ticket.";
        loading = false;
        return;
      }
    }
    loading = true;
    try {
      if (files.length) await api.upload(createdTicketId!, files.map(item => item.file));
      await finishTicket();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "Could not upload attachments.";
    } finally { loading = false; }
  }
</script>

<div class="ticket-create w-full min-w-0">
  <header class="flex flex-wrap items-start justify-between gap-4 mb-6">
    <div>
      <div class="flex items-center gap-2">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Create a ticket</h1>
        <button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Show ticket creation guide" onclick={() => createTicketTour().drive()}><HelpCircle size={18} /></button>
      </div>
      <p class="text-sm text-base-content/60 mt-1">Tell us what you need. We’ll help get it to the right team.</p>
    </div>
    <div class="flex items-center gap-3 text-xs text-base-content/60">
      <span role="status">{draftStatus}</span>
      {#if (hasDraft || files.length) && !createdTicketId}<button type="button" class="btn btn-ghost btn-sm" disabled={loading} onclick={discardDraft}>Discard draft</button>{/if}
    </div>
  </header>

  {#if restored}
    <p class="mb-4 text-sm text-base-content/70" role="status">Your saved draft was restored. Files aren’t saved with drafts; reattach them if needed.</p>
  {/if}
  {#if createdTicketId}
    <div class="alert alert-info mb-5" role="status">
      <Check size={20} />
      <div><strong>Ticket #{createdTicketId} has been created.</strong><p>Retry the attachments below, or open the ticket and add them later.</p></div>
      <button type="button" class="btn btn-sm" disabled={loading} onclick={finishTicket}>Open ticket</button>
    </div>
  {/if}
  {#if error}<div class="alert alert-error mb-5" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>{/if}

  <!-- Pasted screenshots are attached from any focused field in this form. -->
  <form bind:this={form} onsubmit={handleSubmit} onpastecapture={handlePaste} novalidate class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
    <div class="min-w-0 space-y-6">
      <section class="card bg-base-100 border border-base-300 p-4 sm:p-6">
        <fieldset disabled={loading || !!createdTicketId} class="min-w-0 space-y-5">
          <legend class="text-lg font-semibold mb-5">What can we help with?</legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <SearchableSelect label="Request type (optional)" items={requestTypes} bind:value={request_type_id} disabled={loading || !!createdTicketId} data-tour="ticket-request-type" />
              {#if isOtherRequestType}
                <label for="other_request_type" class="block text-sm mt-3 mb-1">Specify request type</label>
                <input id="other_request_type" class="input input-bordered w-full" bind:value={other_request_type} aria-invalid={!!fieldErrors.other_request_type} aria-describedby="other-request-error" />
                {#if fieldErrors.other_request_type}<p id="other-request-error" class="field-error">{fieldErrors.other_request_type}</p>{/if}
              {/if}
            </div>
            <div data-tour="ticket-system">
              {#if isHardwareIssue}
                <SearchableSelect label="Hardware item (optional)" items={hardwareOptions} bind:value={hardware_item_id} disabled={loading || !!createdTicketId} />
              {:else}
                <SearchableSelect label="Affected system (optional)" items={systems} bind:value={affected_system_id} disabled={loading || !!createdTicketId} />
                {#if isOtherAffectedSystem}
                  <label for="other_affected_system" class="block text-sm mt-3 mb-1">Specify system</label>
                  <input id="other_affected_system" class="input input-bordered w-full" bind:value={other_affected_system} aria-invalid={!!fieldErrors.other_affected_system} aria-describedby="other-system-error" />
                  {#if fieldErrors.other_affected_system}<p id="other-system-error" class="field-error">{fieldErrors.other_affected_system}</p>{/if}
                {/if}
              {/if}
            </div>
          </div>
          <div data-tour="ticket-subject">
            <label for="title" class="block text-sm font-medium mb-2">Subject <span class="text-base-content/50">(required)</span></label>
            <input id="title" type="text" class="input input-bordered w-full" placeholder={isHardwareIssue ? "e.g. Accounting printer won’t print" : "e.g. Unable to sign in to Payroll"} bind:value={title} required aria-invalid={!!fieldErrors.title} aria-describedby="title-error" />
            {#if fieldErrors.title}<p id="title-error" class="field-error">{fieldErrors.title}</p>{/if}
          </div>
          <div>
            <p class="block text-sm font-medium mb-2">Description <span class="text-base-content/50">(required)</span></p>
            <div class="rounded-xl border {fieldErrors.description ? 'border-error' : 'border-base-300'} overflow-hidden focus-within:border-primary" data-tour="ticket-description">
              <RichTextEditor id="description" aria-label="Issue description (required)" aria-invalid={!!fieldErrors.description} aria-describedby="description-help description-error" bind:value={description} disabled={loading || !!createdTicketId} class="min-h-[280px] lg:min-h-[360px]" />
            </div>
            {#if fieldErrors.description}<p id="description-error" class="field-error">{fieldErrors.description}</p>{/if}
            <div id="description-help" class="mt-3 rounded-lg bg-base-200/60 p-3 text-sm text-base-content/65">
              <p class="font-medium text-base-content/80 mb-1">A few useful details</p>
              {#if isHardwareIssue}
                <p>Where is the device? What happens when you use it? Include any error lights or messages and what you’ve tried.</p>
              {:else}
                <p>What happened? What did you expect? Include the steps, any error message, and what you’ve already tried.</p>
              {/if}
              <p class="mt-2 text-xs">You can paste tables from Excel. Pasted screenshots are added as attachments below.</p>
            </div>
          </div>
        </fieldset>
      </section>

      <section class="card bg-base-100 border border-base-300 p-4 sm:p-6" data-tour="ticket-attachments">
        <div class="flex items-center justify-between gap-3 mb-4"><h2 class="text-lg font-semibold flex items-center gap-2"><Paperclip size={18} /> Attachments <span class="text-sm font-normal text-base-content/50">(optional)</span></h2><span class="text-sm text-base-content/60">{files.length}/5</span></div>
        <input id="ticket-files" type="file" multiple class="sr-only" bind:this={fileInput} disabled={loading} onchange={() => { addFiles(Array.from(fileInput.files ?? [])); fileInput.value = ""; }} aria-label="Choose attachments" />
        <button type="button" class="w-full rounded-xl border-2 border-dashed p-5 sm:p-7 text-center transition-colors {dragDepth ? 'border-primary bg-primary/10' : 'border-base-300 hover:border-primary/50'}" disabled={loading}
          onclick={() => fileInput.click()}
          ondragenter={(event) => { event.preventDefault(); dragDepth++; }} ondragover={(event) => event.preventDefault()}
          ondragleave={() => dragDepth = Math.max(0, dragDepth - 1)}
          ondrop={(event) => { event.preventDefault(); dragDepth = 0; addFiles(Array.from(event.dataTransfer?.files ?? [])); }}>
          <Upload size={24} class="mx-auto text-primary mb-2" /><span class="block text-sm font-medium">Drop files here or choose files</span>
          <span class="block text-xs text-base-content/60 mt-1">Paste screenshots anywhere in the form · Up to 5 files, 20 MB each</span>
        </button>
        {#if fileError}<p class="field-error" role="alert">{fileError}</p>{/if}
        {#if files.length}
          <ul class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 mt-4">
            {#each files as item, index (item)}
              <li class="flex items-center gap-3 rounded-xl border border-base-300 p-3 min-w-0">
                {#if item.preview}<img src={item.preview} alt="Preview of {item.file.name}" class="w-12 h-12 object-cover rounded-lg shrink-0" />{:else}<FileText size={26} class="text-base-content/50 shrink-0" />{/if}
                <div class="min-w-0 flex-1"><p class="text-sm font-medium truncate" title={item.file.name}>{item.file.name}</p><p class="text-xs text-base-content/60">{item.file.size < 1024 * 1024 ? `${Math.ceil(item.file.size / 1024)} KB` : `${(item.file.size / 1024 / 1024).toFixed(1)} MB`}</p></div>
                <button type="button" class="btn btn-ghost btn-sm btn-circle shrink-0" aria-label="Remove {item.file.name}" disabled={loading} onclick={() => removeFile(index)}><X size={16} /></button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>

    <aside class="min-w-0 xl:sticky xl:top-6 space-y-4">
      <section class="card bg-base-100 border border-base-300 p-4 sm:p-6">
        <fieldset disabled={loading || !!createdTicketId} class="min-w-0 space-y-5">
          <legend class="text-lg font-semibold mb-5">Ticket details</legend>
          <div>
            <SearchableSelect label="Target department (optional)" items={departments} bind:value={department_id} disabled={loading || !!createdTicketId} data-tour="ticket-department" />
            <p class="text-xs text-base-content/60 mt-2">Choose the team that should handle your request. Leave blank if you’re unsure.</p>
            {#if isOtherDepartment}
              <label for="other_department" class="block text-sm mt-3 mb-1">Specify department</label>
              <input id="other_department" class="input input-bordered w-full" bind:value={other_department} aria-invalid={!!fieldErrors.other_department} aria-describedby="other-department-error" />
              {#if fieldErrors.other_department}<p id="other-department-error" class="field-error">{fieldErrors.other_department}</p>{/if}
            {/if}
          </div>
          <label class="flex gap-3 items-start cursor-pointer rounded-xl border border-base-300 p-3" data-tour="ticket-approval">
            <input id="requires_approval" type="checkbox" class="checkbox checkbox-primary checkbox-sm mt-0.5" bind:checked={requires_approval} />
            <span><span class="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={16} /> Requires approval</span><span class="block text-xs text-base-content/60 mt-1">For requests that need a manager’s review.</span></span>
          </label>
          {#if hasRole("admin", "mis")}
            <div class="border-t border-base-300 pt-4 space-y-4">
              <p class="text-xs font-medium text-base-content/50">Staff controls</p>
              <div>
                <label for="priority" class="block text-sm font-medium mb-2">Priority</label>
                <select id="priority" class="select select-bordered w-full" bind:value={priority} data-tour="ticket-priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
                <p class="text-xs text-base-content/60 mt-2">SLA target: <strong>{slaHint}</strong></p>
              </div>
              <div>
                <label for="due_date" class="block text-sm font-medium mb-2">Desired due date <span class="font-normal text-base-content/50">(optional)</span></label>
                <input id="due_date" type="datetime-local" class="input input-bordered w-full" bind:value={due_date} aria-invalid={!!fieldErrors.due_date} aria-describedby="due-date-error" data-tour="ticket-due-date" />
                {#if fieldErrors.due_date}<p id="due-date-error" class="field-error">Choose a valid date and time.</p>{/if}
              </div>
            </div>
          {/if}
        </fieldset>
      </section>
      <div class="sticky bottom-0 z-10 bg-base-100 border border-base-300 rounded-xl p-4 shadow-sm">
        <p class="text-xs text-base-content/60 mb-3">{createdTicketId ? 'Your ticket is saved. Only attachments will be retried.' : 'You can follow progress and add more details after submitting.'}</p>
        <button class="btn btn-primary w-full rounded-lg gap-2" type="submit" disabled={loading} data-tour="ticket-submit">
          {#if loading}<span class="loading loading-spinner loading-sm"></span>{createdTicketId ? "Uploading attachments…" : "Creating ticket…"}{:else}<Send size={16} />{createdTicketId ? (files.length ? "Retry attachments" : "Open ticket") : "Submit ticket"}{/if}
        </button>
      </div>
    </aside>
  </form>
</div>

<style>
  .field-error { margin-top: 0.4rem; font-size: 0.8125rem; color: var(--color-error); }
  .ticket-create :global(.label-text) { font-size: 0.875rem; font-weight: 500; text-transform: none; letter-spacing: normal; }
  .ticket-create :global([aria-invalid="true"]) { border-color: var(--color-error); }
</style>
