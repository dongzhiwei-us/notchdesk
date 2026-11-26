import { localeOptions } from '../shared/locales';
import { tr, fmt } from './i18n';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Bell, Check, CircleHelp, Code2, Copy, FolderOpen, Github, Gitlab, Layers2, Palette, Plug2, Settings2 } from 'lucide-react';
import { PluginIcon, PluginLabel, SchemaField, normalizeValues, schemaFields } from './common';
import { errorMessage, titleOf, type Account, type Plugin, type State, type Theme } from './types';
import { displayShortcut, type ShortcutStatus } from '../shared/shortcuts';
const sections = [
    { id: 'appearance', title: tr("外观"), icon: Palette }, { id: 'plugins', title: tr("插件"), icon: Layers2 }, { id: 'notifications', title: tr("通知"), icon: Bell },
    { id: 'accounts', title: tr("账号与来源"), icon: Plug2 }, { id: 'mcp', title: tr("MCP 连接"), icon: Code2 },
];
type SettingsProps = {
    state: State;
    refresh: () => void;
    section?: string;
    standalone?: boolean;
    feedback: (message: string, kind?: 'error' | 'info') => void;
};
function Appearance({ theme, refresh, feedback }: Pick<SettingsProps, 'refresh' | 'feedback'> & {
    theme: Theme;
}) {
    async function update(patch: Partial<Theme>) {
        try {
            await window.notch.rpc('theme.set', { ...theme, ...patch });
            refresh();
        }
        catch (error) {
            feedback(errorMessage(error), 'error');
        }
    }
    return <>
    <div className="setting-card"><label>{tr('界面语言')}<select aria-label={tr('界面语言')} value={theme.locale || 'system'} onChange={event => void update({ locale: event.target.value })}>{localeOptions.map(option => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}</select></label><label>{tr("圆盘位置")}<select value={theme.wheelPlacement || "edge"} onChange={event => void update({ wheelPlacement: event.target.value })}><option value="edge">{tr("顶边停靠")}</option><option value="floating">{tr("悬浮圆盘")}</option></select></label><label>{tr("显示模式")}<select value={theme.mode} onChange={event => void update({ mode: event.target.value })}><option value="system">{tr("跟随系统")}</option><option value="dark">{tr("深色")}</option><option value="light">{tr("浅色")}</option></select></label>
      <label>{tr("面板材质")}<select value={theme.material} onChange={event => void update({ material: event.target.value })}><option value="glass">{tr("磨砂")}</option><option value="solid">{tr("实色")}</option></select></label></div>
    <div className="setting-card"><h3>{tr("主题色")}</h3><div className="palette-grid">{[['graphite', tr("石墨")], ['tide', tr("潮汐")], ['amber', tr("琥珀")]].map(([id, text]) => <button className="palette-choice" data-swatch={id} aria-pressed={theme.palette === id} onClick={() => void update({ palette: id })} key={id}><span className="palette-swatch"/>{tr(text)}{theme.palette === id && <Check size={14}/>}</button>)}</div></div>
  </>;
}
function PluginSettings({ plugin, values, refresh, feedback, shortcutStatuses, retry }: {
    plugin: Plugin;
    values: Record<string, unknown>;
    shortcutStatuses: ShortcutStatus[];
    retry: () => void;
} & Pick<SettingsProps, 'refresh' | 'feedback'>) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(values);
    const [busy, setBusy] = useState(false);
    const fields = schemaFields(plugin.settings);
    useEffect(() => {
        if (!open)
            setDraft(values);
    }, [open, values]);
    async function update(method: string, params: Record<string, unknown>) {
        setBusy(true);
        try {
            await window.notch.rpc(method, params);
            refresh();
        }
        catch (error) {
            feedback(errorMessage(error), 'error');
        }
        finally {
            setBusy(false);
        }
    }
    return <article className="setting-card plugin-config" data-plugin-id={plugin.id}>
    <div className="row"><div className="tile-icon" data-plugin={plugin.id}><PluginIcon plugin={plugin} size={18}/></div><div className="row-content"><PluginLabel plugin={plugin}/></div>
      {!!Object.keys(fields).length && <button type="button" className="icon-button" aria-label={fmt("配置{{value0}}", { value0: titleOf(plugin) })} title={fmt("配置{{value0}}", { value0: titleOf(plugin) })} onClick={() => setOpen(!open)} aria-expanded={open}><Settings2 size={16}/></button>}
      <button type="button" className="toggle" aria-label={fmt("启用{{value0}}", { value0: titleOf(plugin) })} role="switch" aria-checked={plugin.enabled} disabled={busy} onClick={() => void update('plugins.enable', { id: plugin.id, enabled: !plugin.enabled })}><span /></button></div>
    <div className="plugin-placement"><div><span>{tr('显示在轮盘')}</span><p className="quiet">{plugin.presentation?.wheel===false?tr('后台运行，通过通知提醒；仍可在此配置。'):tr('在轮盘保留入口，方便随时打开。')}</p></div><button type="button" className="toggle" role="switch" aria-label={fmt('在轮盘显示{{value0}}',{value0:titleOf(plugin)})} aria-checked={plugin.presentation?.wheel!==false} disabled={busy} onClick={()=>void update('plugins.presentation',{id:plugin.id,wheel:plugin.presentation?.wheel===false})}><span/></button></div>
    {shortcutStatuses.filter(binding => binding.pluginId === plugin.id).map(binding => <div className={`shortcut-runtime ${binding.status === 'failed' ? 'inline-error' : 'quiet'}`} key={binding.id} role={binding.status === 'failed' ? 'status' : undefined}><span>{displayShortcut(binding.shortcut, window.notch.platform)} · {binding.status === 'registered' ? tr('全局快捷键已启用') : binding.reason === 'invalid' ? tr('快捷键格式无效') : binding.reason === 'duplicate' ? tr('快捷键与另一个插件冲突') : tr('快捷键被系统或其他应用占用')}</span>{binding.status === 'failed' && <button className="button quiet-button" type="button" onClick={retry}>{tr('重试注册')}</button>}</div>)}
    {open && <form className="editor" onSubmit={async (event) => {
                event.preventDefault();
                try {
                    await update('settings.patch', { pluginId: plugin.id, values: normalizeValues(draft, fields) });
                }
                catch (error) {
                    feedback(errorMessage(error), 'error');
                }
            }}>{Object.entries(fields).map(([name, field]) => <SchemaField key={name} name={name} field={field} value={draft[name] ?? field.default} set={value => setDraft({ ...draft, [name]: value })}/>)}<div className="form-actions"><button className="button primary" disabled={busy}>{tr("保存设置")}</button></div></form>}
  </article>;
}
function Accounts({ refresh, feedback }: Pick<SettingsProps, 'refresh' | 'feedback'>) {
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [options,setOptions]=useState<Record<string,{clientId?:string;hasSecret?:boolean}>>({});
  const [provider,setProvider]=useState<'github'|'gitlab'>('github');
  const [clientId,setClientId]=useState(''),[clientSecret,setClientSecret]=useState('');
  const [host,setHost]=useState(''),[token,setToken]=useState('');
  const [setup,setSetup]=useState(false),[busy,setBusy]=useState(false);
  async function load(){
    const result=await window.notch.accounts?.();setAccounts(Array.isArray(result)?result:result?.accounts||[]);
    setOptions(await window.notch.oauthOptions());
  }
  useEffect(()=>{void load().catch(error=>feedback(errorMessage(error),'error'));},[]);
  async function login(selected:'github'|'gitlab'){
    setProvider(selected);
    const app=options[selected];
    const sameProvider=selected===provider;
    if((!setup||!sameProvider) && !app?.clientId){setClientId('');setClientSecret('');setSetup(true);return;}
    setBusy(true);
    try{
      await window.notch.connectAccount?.({provider:selected,host:host||undefined,clientId:(sameProvider?clientId:undefined)||app?.clientId,clientSecret:(sameProvider?clientSecret:undefined)||undefined});
      setClientSecret('');setSetup(false);await load();refresh();feedback(tr('账号已连接'));
    }catch(error){feedback(errorMessage(error),'error');setSetup(true);}
    finally{setBusy(false);}
  }
  function registration(){
    const origin=provider==='github'?'https://github.com':host||'https://gitlab.com';
    const url=provider==='github'?new URL('/settings/applications/new',origin):new URL('/-/user_settings/applications',origin);
    if(provider==='github'){url.searchParams.set('oauth_application[name]','NotchDesk');url.searchParams.set('oauth_application[url]','http://127.0.0.1');url.searchParams.set('oauth_application[callback_url]','http://127.0.0.1:49317/callback');}
    void window.notch.openExternal(url.href).catch(error=>feedback(errorMessage(error),'error'));
  }
  return <>
    {(['github','gitlab'] as const).map(id=>{
      const account=accounts.find(item=>item.provider===id),Icon=id==='github'?Github:Gitlab;
      return <div className="setting-card account-status" key={id}><Icon size={22}/><div className="row-content"><strong>{id==='github'?'GitHub':'GitLab'}</strong><span className="quiet">{account?tr('已连接'):tr('未连接')}</span></div>
        {account?<button className="button" disabled={busy} onClick={async()=>{try{await window.notch.disconnectAccount?.(id);await load();refresh();}catch(error){feedback(errorMessage(error),'error');}}}>{tr('断开')}</button>:
        <button className="button primary" disabled={busy} onClick={()=>void login(id)}>{tr('浏览器登录')}</button>}</div>;
    })}
    {busy&&<p className="quiet" role="status">{tr('请在浏览器中完成授权，完成后将自动返回')}</p>}
    {setup&&<section className="setting-card editor"><h3>{tr('首次连接 OAuth 应用')}</h3>
      <p className="quiet">{tr('配置一次，后续可直接从账号入口登录')}</p>
      {provider==='gitlab'&&<label>{tr('GitLab 地址')}<input type="url" value={host} onChange={e=>setHost(e.target.value)} placeholder="https://gitlab.com"/></label>}
      <button className="button" onClick={registration}>{tr('在平台创建 OAuth 应用')} <ArrowUpRight size={14}/></button>
      <label>{tr('回调地址')}<input readOnly value="http://127.0.0.1:49317/callback"/></label>
      <label>Client ID<input value={clientId} onChange={e=>setClientId(e.target.value)} autoComplete="off"/></label>
      {provider==='github'&&<label>Client Secret<input type="password" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} autoComplete="off" placeholder={options.github?.hasSecret?tr('已保存，可留空'):undefined}/></label>}
      {provider==='gitlab'&&<p className="quiet">{tr('GitLab 应用请选择非机密客户端并启用 read_api')}</p>}
      <div className="form-actions"><button className="button" onClick={()=>setSetup(false)}>{tr('取消')}</button><button className="button primary" disabled={busy||!clientId.trim()} onClick={()=>void login(provider)}>{tr('保存并浏览器授权')}</button></div>
    </section>}
    <details className="setting-card"><summary>{tr('高级连接选项')}</summary><div className="editor">
      <label>{tr('服务')}<select value={provider} onChange={e=>{setProvider(e.target.value as 'github'|'gitlab');setClientId('');setClientSecret('');}}><option>github</option><option>gitlab</option></select></label>
      <button className="button" onClick={()=>{setClientId(options[provider]?.clientId||'');setSetup(true);}}>{tr('修改 OAuth 应用')}</button>
      <label>{tr('访问令牌')}<input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off"/></label>
      <button className="button" disabled={busy||!token.trim()} onClick={async()=>{setBusy(true);try{await window.notch.saveAccount?.({provider,host:host||undefined,token});setToken('');await load();refresh();feedback(tr('账号已连接'));}catch(error){feedback(errorMessage(error),'error');}finally{setBusy(false);}}}>{tr('保存令牌')}</button>
    </div></details>
  </>;
}
const mcpGroups = [['workspace', tr("工作区")], ['clipboard', tr("剪贴板")], ['files', tr("文件")], ['desktop', tr("桌面")], ['administration', tr("管理")]];
function Mcp({ feedback }: Pick<SettingsProps, 'feedback'>) {
    const [config, setConfig] = useState('');
    const [endpoint,setEndpoint]=useState('');
    const [groups, setGroups] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void (async () => {
            try {
                const result = await window.notch.mcpConfig?.();
                if (result){setConfig(JSON.stringify(result,null,2));if(typeof result==='object'&&'url' in result&&typeof result.url==='string')setEndpoint(result.url);}
                setGroups(await window.notch.mcpAccess?.() ?? []);
            }
            catch (error) {
                feedback(errorMessage(error), 'error');
            }
        })();
    }, []);
    return <>
    <div className="setting-card"><h3>HTTP MCP Server</h3><label>{tr('服务地址')}<input aria-label={tr('服务地址')} value={endpoint} readOnly spellCheck={false}/></label><button className="button" disabled={!endpoint} onClick={async()=>{try{await navigator.clipboard.writeText(endpoint);feedback(tr('链接已复制'));}catch(error){feedback(errorMessage(error),'error');}}}><Copy size={14}/>{tr('复制链接')}</button><p className="quiet">{tr('使用 Streamable HTTP，客户端需配置下方的 Authorization 请求头。')}</p><h3>{tr("客户端配置")}</h3><p className="quiet">{tr("将此配置添加到本机 MCP 客户端\uFF0C然后重新连接\u3002")}</p>{config && <><pre className="mcp-config">{config}</pre><button className="button" onClick={async () => {
                try {
                    await navigator.clipboard.writeText(config);
                    feedback(tr("配置已复制"));
                }
                catch (error) {
                    feedback(errorMessage(error), 'error');
                }
            }}><Copy size={14}/>{tr("复制配置")}</button></>}</div>
    {window.notch.setMcpAccess && <div className="setting-card"><h3>{tr("允许的能力")}</h3><div className="permission-list">{mcpGroups.map(([id, title]) => <label className="checkbox-field" key={id}><input type="checkbox" disabled={busy} checked={groups.includes(id)} onChange={async (event) => {
                    const updated = event.target.checked ? [...groups, id] : groups.filter(item => item !== id);
                    setBusy(true);
                    try {
                        await window.notch.setMcpAccess?.(updated);
                        setGroups(updated);
                    }
                    catch (error) {
                        feedback(errorMessage(error), 'error');
                    }
                    finally {
                        setBusy(false);
                    }
                }}/>{tr(title)}</label>)}</div></div>}
  </>;
}
function NotificationSettings({ options, refresh, feedback }: Pick<SettingsProps, 'refresh' | 'feedback'> & {
    options: Record<string, unknown>;
}) {
    const [draft, setDraft] = useState(options);
    const [busy, setBusy] = useState(false);
    useEffect(() => { setDraft(options); }, [options]);
    const choices = [['doNotDisturb', tr("勿扰模式")], ['quietEnabled', tr("启用静默时段")], ['allowUrgentInDnd', tr("允许紧急提醒穿透勿扰")], ['gentleWhileIdle', tr("空闲时采用温和提醒")]];
    return <form className="setting-card editor" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
                await window.notch.rpc('notifications.settings', draft);
                refresh();
                feedback(tr("通知设置已保存"));
            }
            catch (error) {
                feedback(errorMessage(error), 'error');
            }
            finally {
                setBusy(false);
            }
        }}><h3>{tr("浮层提醒")}</h3>{choices.map(([name, label]) => <label className="checkbox-field" key={name}><input type="checkbox" checked={Boolean(draft[name])} onChange={event => setDraft({ ...draft, [name]: event.target.checked })}/>{tr(label)}</label>)}
    {Boolean(draft.quietEnabled) && <div className="form-grid"><label>{tr("静默开始")}<input type="time" required value={String(draft.quietStart || '22:00')} onChange={event => setDraft({ ...draft, quietStart: event.target.value })}/></label><label>{tr("静默结束")}<input type="time" required value={String(draft.quietEnd || '08:00')} onChange={event => setDraft({ ...draft, quietEnd: event.target.value })}/></label></div>}
    <div className="form-actions"><button className="button primary" disabled={busy}>{tr("保存通知设置")}</button></div></form>;
}
export function Settings({ state, refresh, feedback, section, standalone }: SettingsProps) {
    const [shortcutStatuses, setShortcutStatuses] = useState<ShortcutStatus[]>([]);
    const retryShortcuts = () => { void window.notch.retryShortcuts?.().then(setShortcutStatuses).catch(error => feedback(errorMessage(error), 'error')); };
    useEffect(() => {
        let live = true;
        void window.notch.shortcutStatus?.().then(value => { if (live) setShortcutStatuses(value); }).catch(() => {});
        const stop = window.notch.onEvent?.(({ type, payload }) => { if (live && type === 'shortcuts.changed') setShortcutStatuses(payload); });
        return () => { live = false; stop?.(); };
    }, []);
    const [tab, setTab] = useState(sections.some(item => item.id === section) ? section : 'appearance');
    useEffect(() => {
        if (sections.some(item => item.id === section))
            setTab(section);
    }, [section]);
    return <div className={`settings-content${standalone ? ' standalone' : ''}`}>
    <header className="settings-heading"><div className="tile-icon"><Settings2 size={21}/></div><h1>{tr("悬屿设置")}</h1></header>
    <nav className="settings-nav" aria-label={tr("设置分类")}>{sections.map(({ id, title, icon: Icon }) => <button type="button" aria-pressed={tab === id} key={id} onClick={() => setTab(id)}><Icon size={16}/>{tr(title)}</button>)}</nav>
    <div className="settings-body">
      {tab === 'appearance' && <Appearance theme={state.theme} refresh={refresh} feedback={feedback}/>}
      {tab === 'plugins' && <><div className="toolbar"><div className="quiet">{state.plugins.filter(item => item.enabled).length}{tr("个插件已启用")}</div>{window.notch.openPluginsFolder && <button className="button" onClick={async () => {
                    try {
                        await window.notch.openPluginsFolder?.();
                    }
                    catch (error) {
                        feedback(errorMessage(error), 'error');
                    }
                }}><FolderOpen size={15}/>{tr("插件目录")}</button>}</div>{state.plugins.map(plugin => <PluginSettings key={plugin.id} plugin={plugin} values={state.settings[plugin.id]?.values ?? fallbackValues} refresh={refresh} feedback={feedback} shortcutStatuses={shortcutStatuses} retry={retryShortcuts}/>)}</>}
      {tab === 'notifications' && <NotificationSettings options={state.notificationSettings ?? fallbackValues} refresh={refresh} feedback={feedback}/>}
      {tab === 'accounts' && <Accounts refresh={refresh} feedback={feedback}/>}
      {tab === 'mcp' && <Mcp feedback={feedback}/>}
    </div>
    {!state.host?.online && <div className="settings-note"><CircleHelp size={14}/>{tr("本地服务连接中")}</div>}
  </div>;
}
const fallbackValues = {};
