<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import { Table } from "@tiptap/extension-table";
  import { TableRow } from "@tiptap/extension-table-row";
  import { TableCell } from "@tiptap/extension-table-cell";
  import { TableHeader } from "@tiptap/extension-table-header";

  let {
    value = $bindable(""),
    disabled = $bindable(false),
    class: className = "min-h-[500px]",
    "data-tour": dataTour = undefined,
    id = undefined,
    "aria-label": accessibleLabel = undefined,
    "aria-describedby": describedBy = undefined,
    "aria-invalid": invalid = false,
  } = $props();

  let element: HTMLDivElement;
  let editor: Editor | null = $state(null);

  onMount(() => {
    editor = new Editor({
      element: element,
      extensions: [
        StarterKit,
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content: value,
      editable: !disabled,
      onUpdate: ({ editor }) => {
        value = editor.getHTML();
      },
      editorProps: {
        attributes: {
          class: `prose prose-sm max-w-none focus:outline-none p-4 ${className}`,
          ...(id ? { id } : {}),
          role: "textbox",
          "aria-multiline": "true",
          ...(accessibleLabel ? { "aria-label": accessibleLabel } : {}),
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
        },
      },
    });
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
  });

  $effect(() => {
    if (editor && editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  });

  $effect(() => {
    if (editor) {
      editor.setEditable(!disabled);
      editor.view.dom.setAttribute("aria-invalid", String(invalid));
    }
  });
</script>

<div class="flex flex-col flex-1 overflow-x-auto bg-base-100" data-tour={dataTour}>
  <div bind:this={element} class="flex flex-col flex-1"></div>
</div>

<style>
  /* Enable horizontal scroll for wide tables */
  :global(.prose) {
    max-width: none !important;
  }

  :global(.tiptap table) {
    border-collapse: collapse;
    margin: 0;
    overflow: auto; /* Allows table container to scroll */
    width: 100%;
    display: block; /* Essential for overflow on tables */
  }

  :global(.tiptap table td, .tiptap table th) {
    border: 1px solid #ced4da;
    box-sizing: border-box;
    min-width: 1em;
    padding: 3px 5px;
    position: relative;
    vertical-align: top;
  }

  :global(.tiptap table th) {
    background-color: rgba(0, 0, 0, 0.05);
    font-weight: bold;
    text-align: left;
  }

  :global(.tiptap p) {
    margin: 0.5em 0;
  }

  /* REPLACE the last two :global blocks with these */
  :global(.tiptap) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 260px;
  }

  :global(.ProseMirror) {
    flex: 1;
    min-height: 260px;
  }
</style>
