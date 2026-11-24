import { createPluginTranslator, currentLocale } from './i18n';
import { tr, fmt } from './i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BellRing, BookOpenText, Code2, ListTodo, Paperclip, Puzzle, Sparkles, Sunrise, TrendingUp, Waves } from 'lucide-react';
import { DataTree, Empty, usePanelDraft, type PanelProps } from './primitives';
import { detailOf, errorMessage, titleOf, type Plugin, type Schema, type Tool } from './types';
const pluginIcons = {
    todo: ListTodo, clipline: Paperclip, snippets: Code2, vocabulary: BookOpenText,
    trends: TrendingUp, morning: Sunrise, attention: BellRing, wellness: Waves,
};
export function PluginIcon({ plugin, size = 20 }: {
    plugin: Plugin;
    size?: number;
}) {
    const name = (plugin.icon || '').toLowerCase().replace(/[_ -]/g, '');
    const pluginIcon = pluginIcons[plugin.id as keyof typeof pluginIcons];
    const namedIcons: Record<string, typeof ListTodo> = { listtodo: ListTodo, paperclip: Paperclip, code: Code2, sparkles: Sparkles, book: BookOpenText, bell: BellRing, sunrise: Sunrise, trends: TrendingUp, wave: Waves };
    const Icon = pluginIcon ?? namedIcons[name] ?? Puzzle;
    return <Icon size={size} strokeWidth={1.8}/>;
}
export function PluginLabel({ plugin, detail = true }: {
    plugin: Plugin;
    detail?: boolean;
}) {
    return <span className="plugin-label"><strong>{tr(titleOf(plugin))}</strong>{detail && detailOf(plugin) && <small>{tr(detailOf(plugin))}</small>}</span>;
}
export function schemaFields(schema?: Plugin['settings']): Record<string, Schema> {
    if (!schema || typeof schema !== 'object')
        return {};
    if ('properties' in schema && schema.properties)
        return schema.properties as Record<string, Schema>;
    if ('type' in schema && typeof schema.type === 'string')
        return {};
    return schema as Record<string, Schema>;
}
export function SchemaField({ name, field, value, set, required }: {
    name: string;
    field: Schema;
    value: unknown;
    set: (value: unknown) => void;
    required?: boolean;
}) {
    const kind = Array.isArray(field.type) ? field.type.find(type => type !== 'null') : field.type;
    const caption = field.title || field.label || name;
    if (kind === 'boolean')
        return <label className="checkbox-field"><input type="checkbox" checked={Boolean(value)} onChange={event => set(event.target.checked)}/><span>{caption}{field.description && <small>{field.description}</small>}</span></label>;
    let control: ReactNode;
    const options = field.enum ?? field.options;
    if (options)
        control = <select required={required} value={value == null ? '' : String(value)} onChange={event => set(options.find(item => String(item) === event.target.value) ?? event.target.value)}>
    <option value="">{tr("请选择")}</option>{options.map((item, index) => <option key={String(item)} value={String(item)}>{field.enumNames?.[index] || String(item)}</option>)}
  </select>;
    else if (kind === 'object' || kind === 'array') {
        control = <textarea rows={3} required={required} placeholder={kind === 'object' ? '{}' : '[]'} value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)} onChange={event => set(event.target.value)}/>;
    }
    else if ((kind === 'number' || kind === 'integer') && name === 'dueAt') {
        const date = value ? new Date(Number(value)) : null;
        const local = date && Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
        control = <input type="datetime-local" required={required} value={local} onChange={event => set(event.target.value ? new Date(event.target.value).getTime() : null)}/>;
    }
    else if (kind === 'number' || kind === 'integer')
        control = <input type="number" step={kind === 'integer' ? 1 : 'any'} required={required} min={field.minimum ?? field.min} max={field.maximum ?? field.max} value={value == null ? '' : String(value)} onChange={event => set(event.target.value === '' ? undefined : Number(event.target.value))}/>;
    else if (['text', 'notes', 'body', 'content', 'prompt'].includes(name))
        control = <textarea required={required} rows={3} value={String(value ?? '')} minLength={field.minLength} onChange={event => set(event.target.value)}/>;
    else
        control = <input required={required} type={kind === 'time' ? 'time' : field.format === 'uri' ? 'url' : field.format === 'date-time' ? 'datetime-local' : field.format === 'password' ? 'password' : 'text'} minLength={field.minLength} value={String(value ?? '')} onChange={event => set(event.target.value)}/>;
    return <label>{caption}{control}{field.description && <small>{field.description}</small>}</label>;
}
export function normalizeValues(values: Record<string, unknown>, fields: Record<string, Schema>) {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => {
        const field = fields[key];
        return [key, typeof value === 'string' && (field?.type === 'array' || field?.type === 'object') ? JSON.parse(value) : value];
    }));
}
export function GenericPanel({ plugin, tools, feedback, edit }: PanelProps & {
    plugin: Plugin;
    tools: Tool[];
}) {
    const available = tools.filter(tool => tool.pluginId === plugin.id || tool.name.startsWith(`${plugin.id.replace(/-/g, '_')}_`) || plugin.tools?.some(item => (typeof item === 'string' ? item : item.name) === tool.name));
    const [selected, setSelected] = usePanelDraft(plugin.id+'.operation','',edit);
    const [values, setValues] = usePanelDraft<Record<string, unknown>>(plugin.id+'.operation-values',{});
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<unknown>(null);
    const tool = available.find(item => item.name === selected);
    const fields = tool?.inputSchema?.properties ?? {};
    if (!available.length)
        return <Empty icon={<Puzzle size={22}/>} title={tr("此插件无需面板操作")} detail={tr(detailOf(plugin))}/>;
    return <>
    <label className="tool-picker">{tr("选择操作")}<select value={selected} onChange={event => {
            const name = event.target.value;
            const next = available.find(item => item.name === name);
            setSelected(name);
            setValues(Object.fromEntries(Object.entries(next?.inputSchema?.properties ?? {}).filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default])));
            setResult(null);
            edit(!!name);
        }}><option value="">{tr("请选择")}</option>{available.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
    {tool && <form className="editor" onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                    setResult(await window.notch.rpc(tool.name, normalizeValues(values, fields)));
                    feedback(tr("操作已执行"));
                }
                catch (error) {
                    feedback(errorMessage(error), 'error');
                }
                finally {
                    setBusy(false);
                }
            }}>
      {tool.description && <p className="quiet">{tool.description}</p>}
      {Object.entries(fields).map(([name, field]) => <SchemaField key={name} name={name} field={field} value={values[name]} required={tool.inputSchema?.required?.includes(name)} set={value => setValues({ ...values, [name]: value })}/>)}
      <div className="form-actions"><button className="button quiet-button" type="button" onClick={() => { setSelected(''); edit(false); }}>{tr("取消")}</button><button className="button primary" disabled={busy}>{tr("运行操作")}</button></div>
    </form>}
    {!!result && <div className="feature-card"><DataTree value={result}/></div>}
  </>;
}
export function RuntimePanel({ plugin, tools, values, props }: {
    plugin: Plugin;
    tools: Tool[];
    values: Record<string, unknown>;
    props: PanelProps;
}) {
    const container = useRef<HTMLDivElement>(null);
    const [failure, setFailure] = useState('');
    const revision = plugin.revision ?? (typeof plugin.ui === 'object' ? plugin.ui.revision : undefined) ?? plugin.version;
    const configKey = JSON.stringify(values);
    const locale = currentLocale();
    useEffect(() => {
        const node = container.current;
        if (!node)
            return;
        let active = true;
        let cleanup: unknown;
        setFailure('');
        async function mount() {
            try {
                const module = await import(/* @vite-ignore */ window.notch.pluginUrl(plugin.id, revision));
                if (typeof module.mount !== 'function')
                    throw new Error(tr("插件界面需要导出 mount 函数"));
                if (active) {
                    cleanup = await module.mount(node, {
                        rpc: (method: string, params?: Record<string, unknown>) => window.notch.rpc(method, params),
                        activate:(options:Record<string,unknown>={})=>window.notch.rpc('ui.activate',{...options,pluginId:plugin.id}),
                        settings: JSON.parse(configKey), plugin, mode: 'notch', feedback: props.feedback, locale, t: createPluginTranslator(plugin.id).fmt, edit: props.edit, itemId: props.itemId,
                    });
                    if (!active && typeof cleanup === 'function')
                        cleanup();
                }
            }
            catch (error) {
                if (active)
                    setFailure(errorMessage(error));
            }
        }
        void mount();
        return () => {
            active = false;
            if (typeof cleanup === 'function')
                cleanup();
            node.replaceChildren();
        };
    }, [plugin.id, revision, configKey, locale,props.itemId]);
    return <><div className="runtime-panel" ref={container}/>{failure && <><p className="inline-error" role="alert">{failure}</p><GenericPanel plugin={plugin} tools={tools} {...props}/></>}</>;
}
