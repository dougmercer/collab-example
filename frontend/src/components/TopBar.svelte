<script lang="ts">
  import { userColor } from '../lib/identity'
  import { collab } from '../lib/stores'
  import type { User } from '../lib/types'

  const me: User = $derived({ client_id: collab.clientId, name: collab.name })
  const others = $derived(collab.connection === 'online' ? collab.users.filter((u) => u.client_id !== collab.clientId) : [])
  const status = $derived(
    collab.connection === 'online' ? 'Live' : collab.connection === 'connecting' ? 'Connecting…' : 'Reconnecting…',
  )

  function rename() {
    const name = prompt('Your name, as others see it', collab.name)
    if (name !== null) collab.rename(name)
  }
</script>

<header class="topbar">
  <div class="brand">Shared Sketch</div>
  <span class="status {collab.connection}"><span class="pulse"></span>{status}</span>
  <div class="grow"></div>
  <div class="people">
    <button class="person me" onclick={rename} title="Change your name">
      <span class="dot" style:background={userColor(me.client_id)}></span>{me.name} <span class="muted">(you)</span>
    </button>
    {#each others as u (u.client_id)}
      <span class="person"><span class="dot" style:background={userColor(u.client_id)}></span>{u.name}</span>
    {/each}
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .brand { font-weight: 700; font-size: 14px; }
  .grow { flex: 1; }
  .status { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--warn); }
  .status.online .pulse { background: #2b8a3e; }
  .status.offline { color: var(--danger); }
  .status.offline .pulse { background: var(--danger); }
  .people { display: flex; gap: 6px; flex-wrap: wrap; }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: #fff;
  }
  .person.me:hover { background: #f0f2f5; }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
</style>
