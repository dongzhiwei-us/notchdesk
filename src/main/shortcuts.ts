import { resolveShortcut, type ShortcutBinding, type ShortcutStatus } from '../shared/shortcuts';
type Adapter = { register: (accelerator: string, callback: () => void) => boolean; unregister: (accelerator: string) => void };
// Reconcile only changed bindings; ordinary todo/state updates never churn OS grabs.
export class ShortcutRegistry {
    private active = new Map<string, { accelerator: string; binding: ShortcutBinding }>();
    private signature = '';
    private statuses: ShortcutStatus[] = [];
    constructor(private adapter: Adapter, private platform: string, private invoke: (binding: ShortcutBinding) => Promise<unknown>, private changed: (statuses: ShortcutStatus[]) => void) {}
    snapshot() { return structuredClone(this.statuses); }
    sync(bindings: ShortcutBinding[], force = false) {
        const signature = JSON.stringify(bindings); if (!force && signature === this.signature) return;
        this.signature = signature;
        const desired = new Map(bindings.map(binding => [binding.id, binding]));
        for (const [id, old] of this.active) {
            let next = ''; try { next = resolveShortcut(desired.get(id)?.shortcut ?? '', this.platform); } catch {}
            if (next !== old.accelerator) { this.adapter.unregister(old.accelerator); this.active.delete(id); }
        }
        const claimed = new Map([...this.active].map(([id, binding]) => [binding.accelerator, id]));
        this.statuses = bindings.map(binding => {
            let accelerator = '';
            try { accelerator = resolveShortcut(binding.shortcut, this.platform); } catch { return { ...binding, accelerator, status: 'failed', reason: 'invalid' }; }
            if (claimed.has(accelerator) && claimed.get(accelerator) !== binding.id) return { ...binding, accelerator, status: 'failed', reason: 'duplicate' };
            claimed.set(accelerator, binding.id);
            if (this.active.has(binding.id)) return { ...binding, accelerator, status: 'registered' };
            let busy = false;
            try {
                if (this.adapter.register(accelerator, () => { if (busy) return; busy = true; void this.invoke(binding).catch(() => {}).finally(() => { busy = false; }); })) {
                    this.active.set(binding.id, { accelerator, binding }); return { ...binding, accelerator, status: 'registered' };
                }
            } catch { return { ...binding, accelerator, status: 'failed', reason: 'invalid' }; }
            return { ...binding, accelerator, status: 'failed', reason: 'in-use' };
        });
        this.changed(this.snapshot());
    }
    dispose() { for (const old of this.active.values()) this.adapter.unregister(old.accelerator); this.active.clear(); this.signature = ''; this.statuses = []; }
}
