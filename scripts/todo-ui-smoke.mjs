// Isolated component checks; does not start Electron or access production data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import paths from './paths.cjs';

const base = process.platform === 'win32' && process.env.XDG_DATA_HOME ? path.resolve(process.env.XDG_DATA_HOME, '../temp/notchdesk') : os.tmpdir();
await fs.mkdir(base, { recursive: true });
const scratch = await fs.mkdtemp(path.join(base, 'todo-ui-'));
console.log('UI verification files:', scratch);
const markdown = '## Implementation\n\n- [x] **Keep data local**\n- [ ] Preserve IDs\n\n```ts\nconst saved = true;\n```\n\n<script>window.__injected = true</script><img src=x onerror="window.__injected = true">';
const fixture = `
import React,{useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {TodoPanel} from './plugins/todo/Panel';
import {SnippetsPanel} from './plugins/snippets/Panel';
import {applyLocale,subscribeLocale,currentLocale} from './src/ui/i18n';
import todoZh from './plugins/todo/locales/zh-CN.json';import todoEn from './plugins/todo/locales/en-US.json';
import snippetZh from './plugins/snippets/locales/zh-CN.json';import snippetEn from './plugins/snippets/locales/en-US.json';
import './src/ui/style.css';
const messages=[{id:'todo',translations:{'zh-CN':todoZh,'en-US':todoEn}},{id:'snippets',translations:{'zh-CN':snippetZh,'en-US':snippetEn}}];
const start=new Date();start.setHours(9,0,0,0);
let tasks=[{id:'one',title:'界面与本地存储',notes:'### Delivery\\n\\n保持数据在本机。',startAt:start.getTime()+1234,endAt:start.getTime()+3*3600000+5678,status:'in-progress'},
{id:'two',title:'Review & release',notes:'',startAt:start.getTime()+86400000,endAt:start.getTime()+2*86400000+3600000,status:'pending'}];
let tags=[],granularity='day';
Object.defineProperty(window,'fixtureTasks',{get:()=>structuredClone(tasks)});
let snippets=[{id:'snippet',title:'Code review',text:${JSON.stringify(markdown)}}];
window.notch.rpc=async(method,args={})=>{
  if(method==='todo_list')return structuredClone(tasks);
  if(method==='todo_tags_list')return structuredClone(tags);
  if(method==='todo_view_get')return {granularity};
  if(method==='todo_view_set'){granularity=args.granularity;return {granularity};}
  if(method==='todo_tag_add'){const tag={id:'tag-'+args.name,name:args.name};if(!tags.some(item=>item.id===tag.id))tags.push(tag);return tag;}
  if(method==='todo_tag_remove'){tags=tags.filter(tag=>tag.id!==args.id);tasks=tasks.map(task=>task.tagId===args.id?{...task,tagId:null}:task);return {removed:true};}
  if(method==='snippets_list')return structuredClone(snippets);
  if(method==='todo_add'){const times=args.timeGranularity==='day'?{startAt:args.startDate?new Date(args.startDate+'T00:00').getTime():null,endAt:args.endDate?new Date(args.endDate+'T23:59:59.999').getTime():null}:{};const row={...args,...times,id:'new-'+tasks.length,status:'pending',dueAt:times.endAt??args.endAt};tasks.unshift(row);return row;}
  if(method==='todo_update'){tasks=tasks.map(row=>row.id===args.id?{...row,...args}:row);return tasks.find(row=>row.id===args.id);}
  if(method==='snippets_add'){const row={...args,id:'new-snippet'};snippets.unshift(row);return row;}
  if(method==='snippets_copy')return {copied:true};
  throw Error('Unexpected fixture method '+method);
};
applyLocale('zh-CN',messages);
function Fixture(){useSyncExternalStore(subscribeLocale,currentLocale);const[panel,setPanel]=useState('todo');const[mode,setMode]=useState('light');
return <><nav style={{display:'flex',gap:8,padding:8}}><button id="fixture-snippets" onClick={()=>setPanel('snippets')}>Snippets</button><button id="fixture-dark" onClick={()=>setMode('dark')}>Dark</button><button id="fixture-english" onClick={()=>applyLocale('en-US',messages)}>English</button></nav>
<main className="island theme" data-mode={mode} data-palette="graphite" data-plugin={panel} style={{width:'100%',height:'calc(100vh - 50px)',overflow:'auto',padding:12,background:'var(--bg)'}}>
{panel==='todo'?<TodoPanel revision={0} feedback={()=>{}} edit={()=>{}}/>:<SnippetsPanel revision={0} feedback={()=>{}} edit={()=>{}}/>}</main></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: paths.root }, bundle: true, format: 'iife', platform: 'browser', outfile: path.join(scratch, 'fixture.js'), jsx: 'automatic', logLevel: 'warning' });
await fs.writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>window.notch={systemLocale:"zh-CN",platform:"darwin",openExternal:async()=>{}};</script><script src="fixture.js"></script></body></html>');
const executablePath = process.env.NOTCH_TEST_CHROMIUM || (process.platform === 'win32' && process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234/chrome-win64/chrome.exe') : chromium.executablePath());
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 440, height: 860 }, timezoneId: 'Asia/Shanghai' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(scratch, 'index.html')).href);
    await page.getByText('界面与本地存储', { exact: true }).last().waitFor();
    await page.locator('.todo-workspace').screenshot({ path: path.join(scratch, 'todo-light.png') });
    await page.getByRole('button', { name: /^在.+新增待办$/ }).first().click();
    assert.ok(await page.getByLabel('开始日期', { exact: true }).inputValue());
    assert.ok(await page.getByLabel('结束日期', { exact: true }).inputValue());
    await page.getByLabel('任务', { exact: true }).fill('A timeline task');
    await page.getByRole('textbox', { name: '详细内容', exact: true }).fill(markdown);
    await page.getByRole('button', { name: '预览', exact: true }).click();
    assert.equal(await page.locator('.markdown-editor-preview h2').innerText(), 'Implementation');
    assert.match(await page.locator('.markdown-editor-preview').innerText(), /☑/);
    assert.equal(await page.locator('.markdown-body script,.markdown-body img').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    await page.getByRole('button', { name: '创建待办', exact: true }).click();
    await page.locator('.todo-agenda').getByText('A timeline task', { exact: true }).waitFor();
    assert.equal(await page.locator('.todo-time-bar').getByText('A timeline task', { exact: true }).count(), 1);
    const range = await page.locator('.todo-range-create').boundingBox();
    await page.mouse.move(range.x + range.width * .2, range.y + range.height / 2); await page.mouse.down();
    await page.mouse.move(range.x + range.width * .55, range.y + range.height / 2, { steps: 8 }); await page.mouse.up();
    const from = await page.getByLabel('开始日期', { exact: true }).inputValue(), until = await page.getByLabel('结束日期', { exact: true }).inputValue();
    assert.ok(until > from && until.slice(0, 10) !== from.slice(0, 10));
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', {name:'管理标签',exact:true}).click();
    for(const name of ['MR','chore','coding','CR']){
        await page.getByRole('textbox',{name:'新标签',exact:true}).fill(name);
        await page.getByRole('button',{name:'添加标签',exact:true}).click();
        await page.locator('.todo-tag-chip').filter({hasText:name}).waitFor();
    }
    await page.getByRole('button', {name:'管理标签',exact:true}).click();
    const beforeEdit=await page.evaluate(()=>window.fixtureTasks.find(task=>task.id==='one'));
    await page.locator('.todo-agenda').getByText('界面与本地存储',{exact:true}).click();
    await page.getByRole('combobox',{name:'标签',exact:true}).selectOption({label:'MR'});
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    const afterEdit=await page.evaluate(()=>window.fixtureTasks.find(task=>task.id==='one'));
    assert.equal(afterEdit.startAt,beforeEdit.startAt);assert.equal(afterEdit.endAt,beforeEdit.endAt);
    const original=await page.evaluate(()=>window.fixtureTasks.map(task=>({id:task.id,startAt:task.startAt,endAt:task.endAt})));
    await page.getByRole('slider',{name:'视图粒度',exact:true}).focus();await page.getByRole('slider',{name:'视图粒度',exact:true}).press('ArrowRight');
    await page.locator('.todo-timeline[data-granularity=hour]').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.fixtureTasks.map(task=>({id:task.id,startAt:task.startAt,endAt:task.endAt}))),original);
    await page.locator('.todo-date-axis button').nth(9).click();
    assert.match(await page.getByLabel('开始时间',{exact:true}).inputValue(),/T09:00$/);
    assert.match(await page.getByLabel('结束时间',{exact:true}).inputValue(),/T10:00$/);
    await page.getByLabel('任务',{exact:true}).fill('Hour-level coding');
    await page.getByRole('combobox',{name:'标签',exact:true}).selectOption({label:'coding'});
    await page.getByRole('button',{name:'创建待办',exact:true}).click();
    await page.locator('.todo-agenda .todo-task-tag').filter({hasText:'coding'}).waitFor();
    await page.locator('.todo-workspace').screenshot({path:path.join(scratch,'todo-hours-tags.png')});
    await page.getByRole('combobox',{name:'筛选标签',exact:true}).selectOption({label:'coding'});
    assert.equal(await page.locator('.todo-agenda .todo-row').count(),1);
    await page.getByRole('combobox',{name:'筛选标签',exact:true}).selectOption('*');
    const viewport=await page.locator('.todo-timeline-scroll').boundingBox();const hourRange=await page.locator('.todo-range-create').boundingBox();
    await page.mouse.move(viewport.x+viewport.width*.1,hourRange.y+hourRange.height/2);await page.mouse.down();await page.mouse.move(viewport.x+viewport.width*.8,hourRange.y+hourRange.height/2,{steps:6});await page.mouse.up();
    const hourFrom=await page.getByLabel('开始时间',{exact:true}).inputValue(),hourUntil=await page.getByLabel('结束时间',{exact:true}).inputValue();
    assert.ok(new Date(hourUntil)-new Date(hourFrom)>=2*3600000);
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('button',{name:'管理标签',exact:true}).click();
    await page.getByRole('button',{name:'删除标签 coding',exact:true}).click();
    await page.locator('.todo-tag-chip').filter({hasText:'coding'}).waitFor({state:'detached'});
    assert.equal(await page.locator('.todo-agenda .todo-task-tag').filter({hasText:'coding'}).count(),0);
    assert.ok(await page.evaluate(()=>window.fixtureTasks.some(task=>task.title==='Hour-level coding')));
    await page.getByRole('button',{name:'管理标签',exact:true}).click();
    await page.getByRole('slider',{name:'视图粒度',exact:true}).focus();await page.getByRole('slider',{name:'视图粒度',exact:true}).press('ArrowLeft');
    await page.locator('#fixture-dark').click(); await page.locator('.todo-workspace').screenshot({ path: path.join(scratch, 'todo-dark.png') });
    await page.locator('#fixture-english').click();await page.setViewportSize({width:340,height:860});
    await page.getByRole('slider',{name:'Timeline scale',exact:true}).focus();await page.getByRole('slider',{name:'Timeline scale',exact:true}).press('ArrowRight');
    await page.locator('.todo-timeline[data-granularity=hour]').waitFor();
    assert.ok(await page.evaluate(()=>document.querySelector('main').scrollWidth<=document.querySelector('main').clientWidth+1));
    await page.locator('#fixture-snippets').click(); await page.locator('#fixture-english').click();
    await page.setViewportSize({ width: 340, height: 860 });
    await page.getByRole('button', { name: 'New snippet', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Markdown input');
    await page.getByRole('textbox', { name: 'Snippets', exact: true }).fill(markdown);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.equal(await page.locator('.markdown-editor-preview h2').innerText(), 'Implementation');
    await page.locator('.editor').screenshot({ path: path.join(scratch, 'snippet-markdown-en.png') });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Markdown input', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS day/hour sliders and range creation, tags CRUD/filtering, exact timestamp preservation, Markdown, locales and narrow layout');
    console.log('Screenshots:', scratch);
} finally { await browser.close(); }
