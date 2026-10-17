<script lang="ts">
  import { userColor } from '../lib/identity'
  import { collab } from '../lib/stores'

  const sel = $derived(collab.selection)
  const fields = $derived(collab.fields)
  const server = $derived(collab.selectedShape)
  const editable = $derived(collab.editTarget !== null)
  const online = $derived(collab.connection === 'online')
  const lock = $derived(sel?.kind === 'shape' ? collab.lockOn(sel.id) : null)
  const heldByOther = $derived(lock && lock.client_id !== collab.clientId ? lock : null)
  const nameOk = $derived(!!fields?.name.trim())
  const corners = $derived(fields ? fields.geometry.coordinates[0].length - 1 : 0)
  const idleMinutes = $derived(Math.round(collab.config.idle_release_seconds / 60))

  function confirmDelete() {
    if (confirm(`Delete "${server?.name}" for everyone?`)) void collab.remove()
  }

  function savedAt(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
</script>

<aside class="panel">
  {#if !sel || !fields}
    <h3>Nothing selected</h3>
    <ol class="how">
      <li><strong>Draw a polygon.</strong> Only you can see it at first.</li>
      <li><strong>Pin it</strong> to share it with everyone.</li>
      <li>
        <strong>Click a pinned shape</strong> to lock it and edit it. Others see it as locked until you click away.
      </li>
    </ol>
    <p class="muted">Open this page in a second window to see it from someone else's side.</p>
  {:else}
    <div class="panel-header">
      <span class="swatch" style:background={fields.color}></span>
      <h3 class="grow">{sel.kind === 'draft' ? fields.name : (server?.name ?? fields.name)}</h3>
    </div>

    {#if sel.kind === 'draft'}
      <div class="notice info">This is a draft. Only you can see it until you pin it.</div>
    {:else if sel.status === 'locking'}
      <div class="notice info">Claiming the lock…</div>
    {:else if sel.status === 'editing'}
      <div class="notice ok">
        You have the lock. Others see this shape as locked until you click away, or after {idleMinutes} min idle.
      </div>
    {:else if sel.status === 'readonly'}
      {#if heldByOther}
        <div class="notice locked" style:--who={userColor(heldByOther.client_id)}>
          <strong>{heldByOther.user_name}</strong> is editing this shape. You'll see their changes when they save.
        </div>
      {:else}
        <div class="notice info">
          Nobody is editing this shape now.
          <button class="link" disabled={!online} onclick={() => collab.claim()}>Edit it</button>
        </div>
      {/if}
    {:else if sel.status === 'lost'}
      <div class="notice warn">
        <p>{sel.lostReason} Your unsaved changes are kept below.</p>
        <div class="button-row">
          <button class="btn btn-primary" disabled={!online} onclick={() => collab.claim()}>Reclaim lock</button>
          <button class="btn" onclick={() => collab.reject()}>Discard changes</button>
        </div>
      </div>
    {/if}

    <label class="field">
      <span>Name</span>
      <input type="text" maxlength="80" value={fields.name} disabled={!editable} oninput={(e) => collab.setField('name', e.currentTarget.value)} />
    </label>
    <label class="field">
      <span>Color</span>
      <input type="color" value={fields.color} disabled={!editable} oninput={(e) => collab.setField('color', e.currentTarget.value)} />
    </label>
    <div class="field">
      <span>Outline</span>
      <span class="muted">{corners} corners</span>
    </div>
    {#if editable}
      <p class="muted small">Drag the shape to move it, or drag its corners. Click a midpoint to add a corner.</p>
    {/if}

    {#if sel.kind === 'draft'}
      <div class="button-row">
        <button class="btn btn-primary" disabled={!nameOk || !online || collab.busy} onclick={() => collab.pin()}>Pin and share</button>
        <button class="btn" disabled={collab.busy} onclick={() => collab.discardDraft()}>Discard draft</button>
      </div>
    {:else if sel.status === 'editing'}
      <div class="button-row">
        <button class="btn btn-primary" disabled={!collab.dirty || !nameOk || collab.busy} onclick={() => collab.save()}>Save</button>
        <button class="btn" disabled={!collab.dirty || collab.busy} onclick={() => collab.reject()}>Reject changes</button>
        <span class="grow"></span>
        <button class="btn btn-danger" disabled={collab.busy} onclick={confirmDelete}>Delete</button>
      </div>
      {#if collab.dirty}<p class="muted small">Unsaved changes. Clicking away discards them.</p>{/if}
    {/if}

    {#if server}
      <p class="meta muted">Version {server.version} · saved by {server.updated_by} at {savedAt(server.updated_at)}</p>
    {/if}
  {/if}
</aside>

<style>
  .panel { border-left: 1px solid var(--border); background: var(--panel); }
  .grow { flex: 1; }
  .swatch { width: 14px; height: 14px; margin: 0; border-radius: 3px; flex: none; }
  .field input[type='text'] { flex: 1; max-width: 190px; }
  .field input[type='color'] { width: 44px; height: 26px; padding: 0 2px; border: 1px solid var(--border); border-radius: 4px; background: #fff; }
  .field input:disabled { opacity: 0.6; }
  .notice p { margin: 0 0 8px; }
  .notice.ok { background: #e3f4e8; color: #1b7a3a; }
  .notice.locked { background: color-mix(in srgb, var(--who) 12%, white); color: var(--who); border-left: 3px solid var(--who); }
  .small { font-size: 12px; margin: 0; }
  .meta { margin-top: auto; font-size: 12px; }
  .how { padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 8px; line-height: 1.4; }
</style>
