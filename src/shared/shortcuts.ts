export const clipPinShortcut = 'Control+Alt+Super+P';
const order = ['Control', 'Alt', 'Shift', 'Super', 'CommandOrControl'];
const modifiers: Record<string, string> = { control: 'Control', ctrl: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super', command: 'Super', cmd: 'Super', win: 'Super', windows: 'Super', commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl' };
const keys = ['Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert', 'Return', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv', ...Array.from({ length: 10 }, (_, i) => 'num' + i)];
const aliases: Record<string, string> = { enter: 'Return', esc: 'Escape', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', ' ': 'Space', commakey: ',' };
export function normalizeShortcut(input: unknown): string {
    if (typeof input !== 'string' || input.length > 160) throw Error('快捷键格式无效');
    if (!input.trim()) return '';
    const source = input.trim().replace(/\+\+$/, '+Plus').replace(/\+,$/, '+CommaKey');
    const tokens = source.split(/[+,]/).map(value => value.trim());
    if (tokens.some(value => !value)) throw Error('快捷键格式无效');
    const mods = new Set<string>(); let key = '';
    for (const token of tokens) {
        const modifier = modifiers[token.toLowerCase()];
        if (modifier) { mods.add(modifier); continue; }
        const code = aliases[token.toLowerCase()] || keys.find(value => value.toLowerCase() === token.toLowerCase()) || (/^[a-z0-9]$/i.test(token) || /^F(?:[1-9]|1\d|2[0-4])$/i.test(token) ? token.toUpperCase() : /^[)\!@#$%^&*(:;=<>.?/~`{}\]\[|\\_\-]$/.test(token) ? token : '');
        if (!code || key) throw Error('快捷键格式无效'); key = code;
    }
    if (!key) throw Error('请同时按下修饰键和一个按键');
    if (!mods.size && !/^F\d+$/.test(key) && !/^(Media|Volume)/.test(key)) throw Error('快捷键需要至少一个修饰键');
    return [...order.filter(value => mods.has(value)), key].join('+');
}
export function resolveShortcut(value: string, platform: string) {
    const normalized = normalizeShortcut(value); if (!normalized) return '';
    return normalizeShortcut(normalized.replace('CommandOrControl', platform === 'darwin' ? 'Super' : 'Control'));
}
export function displayShortcut(value: string, platform: string) {
    if (!value) return '';
    try {
        const resolved = resolveShortcut(value, platform), parts = resolved.split('+');
        const labels: Record<string, string> = platform === 'darwin' ? { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' } : { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' };
        return parts.map(part => labels[part] || part).join(platform === 'darwin' ? '' : '+');
    } catch { return value; }
}
export function shortcutFromEvent(event: { code: string; key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (['Control', 'Alt', 'Meta', 'Shift', 'AltGraph'].includes(event.key)) return null;
    let key = event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : event.code === 'Space' ? 'Space' : event.key === '+' ? 'Plus' : event.key;
    if (event.code.startsWith('Numpad')) key = ({ NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Return' } as Record<string, string>)[event.code] || 'num' + event.code.slice(6);
    if (key === ',') key = 'CommaKey';
    return normalizeShortcut([event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+'));
}
export function pluginShortcutField(id: string) {
    return { type: 'string' as const, format: 'accelerator', label: id === 'clipline' ? '固定/取消固定快捷键' : '打开插件快捷键', default: id === 'clipline' ? clipPinShortcut : '' };
}
export type ShortcutBinding = { id: string; pluginId: string; field: string; shortcut: string; action: 'open' | 'pin' | 'capture' };
export type ShortcutStatus = ShortcutBinding & { accelerator: string; status: 'registered' | 'failed'; reason?: 'in-use' | 'invalid' | 'duplicate' };
export function shortcutBindings(state: { plugins: { id: string; enabled: boolean }[]; settings: Record<string, { values?: Record<string, unknown> }> }): ShortcutBinding[] {
    return state.plugins.filter(plugin => plugin.enabled).flatMap(plugin => {
        const values = state.settings[plugin.id]?.values ?? {}, result: ShortcutBinding[] = [];
        const shortcut = values.shortcut ?? pluginShortcutField(plugin.id).default;
        if (typeof shortcut === 'string' && shortcut.trim()) result.push({ id: plugin.id + ':shortcut', pluginId: plugin.id, field: 'shortcut', shortcut, action: plugin.id === 'clipline' ? 'pin' : 'open' });
        const capture = values.captureShortcut ?? 'CommandOrControl+Alt+V';
        if (plugin.id === 'clipline' && typeof capture === 'string' && capture.trim()) result.push({ id: 'clipline:captureShortcut', pluginId: plugin.id, field: 'captureShortcut', shortcut: capture, action: 'capture' });
        return result;
    });
}
