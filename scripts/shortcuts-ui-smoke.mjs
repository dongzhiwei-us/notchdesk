// Isolated settings component; no desktop hotkeys or production data are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import paths from './paths.cjs';
const base = process.platform === 'win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME, '../temp/notchdesk') : os.tmpdir();
await fs.mkdir(base, { recursive: true }); const scratch = await fs.mkdtemp(path.join(base, 'shortcuts-ui-'));
const fixture = `
import React,{useState,useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
import {Settings} from './src/ui/settings';import {applyLocale,subscribeLocale,currentLocale} from './src/ui/i18n';
import {normalizeShortcut,resolveShortcut,shortcutBindings,shortcutFromEvent} from './src/shared/shortcuts';
import clipline from './plugins/clipline/manifest.json';import todo from './plugins/todo/manifest.json';import './src/ui/style.css';
const plugins=[clipline,todo].map(plugin=>({...plugin,enabled:true}));let settings=Object.fromEntries(plugins.map(plugin=>[plugin.id,{values:Object.fromEntries(Object.entries(plugin.settings).map(([key,field])=>[key,field.default]))}]));
let refresh=()=>{},listeners=[];window.paused=false;window.recordingEvents=[];window.fireCount=0;window.savedSettings=()=>structuredClone(settings);
const runtime=()=>shortcutBindings({plugins,settings}).map(binding=>({...binding,accelerator:resolveShortcut(binding.shortcut,window.notch.platform),status:'registered'}));
window.notch.shortcutRecording=async(active,token)=>{window.paused=active;window.recordingEvents.push({active,token});};
window.notch.shortcutStatus=async()=>runtime();window.notch.retryShortcuts=async()=>runtime();window.notch.onEvent=fn=>{listeners.push(fn);return()=>{listeners=listeners.filter(listener=>listener!==fn)}};
window.notch.rpc=async(method,args={})=>{
 if(method==='settings.patch'){
  const next={...settings,[args.pluginId]:{values:{...settings[args.pluginId].values,...args.values}}};const keys=new Set();
  for(const binding of shortcutBindings({plugins,settings:next})){const actual=resolveShortcut(binding.shortcut,window.notch.platform);if(keys.has(actual))throw Error('快捷键与另一个插件或上绳快捷键冲突。');keys.add(actual);}
  settings=next;listeners.forEach(fn=>fn({type:'shortcuts.changed',payload:runtime()}));return {values:settings[args.pluginId].values};
 }
 if(method==='plugins.enable'){plugins.find(plugin=>plugin.id===args.id).enabled=args.enabled;return {ok:true};}
 throw Error('Unexpected fixture method '+method);
};
window.addEventListener('keydown',event=>{try{const shortcut=shortcutFromEvent(event);if(shortcut&&resolveShortcut(shortcut,'darwin')==='Control+Alt+Super+P'&&!window.paused)window.fireCount++;}catch{}},true);
applyLocale('zh-CN',[]);
function Fixture(){useSyncExternalStore(subscribeLocale,currentLocale);const[revision,setRevision]=useState(0),[message,setMessage]=useState('');refresh=()=>setRevision(value=>value+1);
return <><nav style={{display:'flex',gap:8,padding:8}}><button id="english" onClick={()=>applyLocale('en-US',[])}>English</button><button id="windows" onClick={()=>{window.notch.platform='win32';refresh();}}>Windows</button></nav><main className="settings-page theme" data-mode="light" data-palette="graphite" style={{width:'100%',minHeight:'100vh',padding:12}}><Settings state={{plugins,settings,theme:{locale:currentLocale()},notifications:[],host:{online:true}}} section="plugins" standalone refresh={refresh} feedback={setMessage}/><p role="status">{message}</p></main></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: paths.root }, bundle: true, platform: 'browser', format: 'iife', outfile: path.join(scratch, 'fixture.js'), jsx: 'automatic', logLevel: 'warning' });
await fs.writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>window.notch={platform:"darwin",systemLocale:"zh-CN"};</script><script src="fixture.js"></script></body></html>');
const executablePath = process.env.NOTCH_TEST_CHROMIUM || (process.platform === 'win32' && process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234/chrome-win64/chrome.exe') : chromium.executablePath());
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 710, height: 820 } }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(scratch, 'index.html')).href);
    const clip = page.locator('[data-plugin-id=clipline]'), todo = page.locator('[data-plugin-id=todo]');
    await clip.getByRole('button', { name: '配置剪贴绳', exact: true }).click();
    await todo.getByRole('button', { name: '配置待办', exact: true }).click();
    assert.equal(await clip.getByRole('textbox', { name: '固定/取消固定快捷键', exact: true }).inputValue(), '⌃⌥⌘P');
    assert.equal(await todo.getByRole('textbox', { name: '打开插件快捷键', exact: true }).inputValue(), '');
    await todo.getByRole('button', { name: '录入', exact: true }).click();
    const input = todo.getByRole('textbox', { name: '打开插件快捷键', exact: true });
    await input.focus(); await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.down('Meta'); await page.keyboard.down('p');
    assert.equal(await page.evaluate(() => window.paused), true); assert.equal(await page.evaluate(() => window.fireCount), 0);
    await page.keyboard.up('p'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt'); await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => window.paused), false); assert.equal(await input.inputValue(), '⌃⌥⌘P');
    await todo.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByText('快捷键与另一个插件或上绳快捷键冲突。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.savedSettings().todo.values.shortcut), '');
    await todo.getByRole('button', { name: '录入', exact: true }).click(); await input.press('Control+Alt+Meta+t');
    await todo.getByRole('button', { name: '保存设置', exact: true }).click();
    assert.equal(await page.evaluate(() => window.savedSettings().todo.values.shortcut), 'Control+Alt+Super+T');
    await todo.getByRole('button', { name: '清空快捷键', exact: true }).click(); assert.equal(await input.inputValue(), '');
    await todo.getByRole('button', { name: '录入', exact: true }).click(); await input.press('Escape'); assert.equal(await page.evaluate(() => window.paused), false);
    await todo.getByRole('button', { name: '录入', exact: true }).click(); await todo.getByRole('button', { name: '配置待办', exact: true }).click(); assert.equal(await page.evaluate(() => window.paused), false);
    await clip.getByRole('textbox', { name: '固定/取消固定快捷键', exact: true }).locator('..').getByRole('button', { name: '清空快捷键', exact: true }).click();
    assert.equal(await clip.getByRole('textbox', { name: '固定/取消固定快捷键', exact: true }).inputValue(), '');
    await clip.getByRole('textbox', { name: '固定/取消固定快捷键', exact: true }).locator('..').getByRole('button', { name: '恢复默认快捷键', exact: true }).click();
    await clip.screenshot({ path: path.join(scratch, 'mac-shortcuts.png') });
    await page.locator('#windows').click(); await page.locator('#english').click();
    assert.equal(await clip.getByRole('textbox', { name: 'Pin / unpin shortcut', exact: true }).inputValue(), 'Ctrl+Alt+Win+P');
    await page.setViewportSize({ width: 470, height: 820 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await clip.screenshot({ path: path.join(scratch, 'windows-shortcuts-en.png') });
    assert.deepEqual(errors, []); console.log('PASS recorder suspension, key release, conflicts, clearing, defaults, blur/unmount, macOS/Windows labels and locales.');
} finally { await browser.close(); console.log('UI verification files:', scratch); }
