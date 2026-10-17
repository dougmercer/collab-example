<script lang="ts">
  import { toasts } from '../lib/stores'
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <button class="toast" class:error={t.kind === 'error'} onclick={() => toasts.dismiss(t.id)}>{t.message}</button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 200;
    align-items: center;
  }
  .toast { border: none; background: #1f2933; color: #fff; padding: 8px 14px; border-radius: var(--radius); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); }
  .toast.error { background: var(--danger); }
</style>
