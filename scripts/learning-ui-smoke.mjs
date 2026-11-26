// Isolated Chromium component checks; never starts Electron or production data.
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
const scratch = await fs.mkdtemp(path.join(base, 'learning-ui-'));
console.log('UI verification files:', scratch);
const fixture = `
import React,{useState,useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
import {VocabularyPanel} from './plugins/vocabulary/Panel';import {TrendsPanel} from './plugins/trends/Panel';
import {applyLocale,subscribeLocale,currentLocale} from './src/ui/i18n';import catalog from './plugins/vocabulary/catalog.cjs';
import vocabularyZh from './plugins/vocabulary/locales/zh-CN.json';import vocabularyEn from './plugins/vocabulary/locales/en-US.json';import trendsZh from './plugins/trends/locales/zh-CN.json';import trendsEn from './plugins/trends/locales/en-US.json';import './src/ui/style.css';
const messages=[{id:'vocabulary',translations:{'zh-CN':vocabularyZh,'en-US':vocabularyEn}},{id:'trends',translations:{'zh-CN':trendsZh,'en-US':trendsEn}}];
let words=structuredClone(catalog),position=0;
const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
let archives={'2026-11-25':'# 开源趋势 · 2026-11-25\\n\\n## GitHub Trending\\n\\n### 1. public/agent\\n\\nA useful developer tool.\\n\\n[查看详情](https://github.com/public/agent)','2026-11-24':'# 开源趋势 · 2026-11-24\\n\\nOlder captured trends.'};
window.opened=[];window.notch.openExternal=async url=>window.opened.push(url);
window.notch.rpc=async(method,args={})=>{
 if(method==='vocabulary_list'){const favorites=words.filter(word=>word.favorite);return structuredClone({words,favorites,due:favorites.filter(word=>!word.reviewed),reviewed:favorites.filter(word=>word.reviewed).length});}
 if(method==='vocabulary_explore'){const available=words.filter(word=>!word.favorite);if(args.next)position++;return structuredClone({item:available[position%available.length]??null,remaining:available.length});}
 if(method==='vocabulary_favorite'){const word=words.find(word=>word.id===args.id);word.favorite=args.favorite;return structuredClone(word);}
 if(method==='vocabulary_review'){const word=words.find(word=>word.id===args.id);word.reviewed=true;return structuredClone(word);}
 if(method==='vocabulary_add'){const word={...args,id:args.id??'custom-word',favorite:true};words=words.filter(item=>item.id!==word.id);words.unshift(word);return structuredClone(word);}
 if(method==='vocabulary_remove'){words=words.filter(word=>word.id!==args.id);return {removed:true};}
 if(method==='trends_archive_list')return {directory:'/local/notchdesk/assets/trends/archives',days:Object.keys(archives).sort().reverse().map(date=>({date,count:21,partial:false})),schedule:{enabled:true,time:'10:00',timezone:'Asia/Shanghai'}};
 if(method==='trends_archive_get')return {date:args.date,found:!!archives[args.date],content:archives[args.date]};
 if(method==='trends_archive_save'){archives[today]='# 开源趋势 · '+today+'\\n\\nSaved today.';return {date:today};}
 if(method==='trends_archive_open'){window.archiveOpened=args.date;return {ok:true};}
 if(method==='trends_sources')return [];
 if(method==='trends_list')return {items:[{id:'org/repo',fullName:'org/repo',url:'https://github.com/org/repo',description:'Today’s public repository trend',stars:1234,language:'TypeScript'}]};
 if(method==='trends_feed_list'){const hf=args.source==='huggingface';return {source:args.source,items:Array.from({length:10},(_,index)=>({id:'item-'+index,rank:index+1,title:hf?'organization/long-developer-model-'+index:'Building reliable agent workflows: a practical guide '+index,url:hf?'https://huggingface.co/organization/model-'+index:'https://claude.dev/blog/post-'+index+'/',task:'text-generation',likes:1200,downloads:480000,date:'2026-11-25',readingMinutes:8})),fetchedAt:Date.now(),...(args.force?{stale:true,error:'offline fixture'}:{})};}
 throw Error('Unexpected fixture method '+method);
};
applyLocale('zh-CN',messages);
function Fixture(){useSyncExternalStore(subscribeLocale,currentLocale);const[panel,setPanel]=useState('vocabulary'),[mode,setMode]=useState('light'),[itemId,setItemId]=useState('');return <><nav style={{display:'flex',gap:8,padding:8}}><button id="fixture-trends" onClick={()=>setPanel('trends')}>Trends</button><button id="fixture-vocabulary" onClick={()=>setPanel('vocabulary')}>Vocabulary</button><button id="fixture-mcp-favorites" onClick={()=>setItemId('favorites:'+Date.now())}>Favorites</button><button id="fixture-dark" onClick={()=>setMode('dark')}>Dark</button><button id="fixture-english" onClick={()=>applyLocale('en-US',messages)}>English</button></nav><main className="island theme" data-mode={mode} data-palette="graphite" data-plugin={panel} style={{width:'100%',height:'calc(100vh - 50px)',overflow:'auto',padding:12,background:'var(--bg)'}}>{panel==='vocabulary'?<VocabularyPanel revision={0} itemId={itemId} feedback={()=>{}} edit={()=>{}}/>:<TrendsPanel revision={0} feedback={()=>{}} edit={()=>{}}/>}</main></>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: paths.root }, bundle: true, format: 'iife', platform: 'browser', outfile: path.join(scratch, 'fixture.js'), jsx: 'automatic', logLevel: 'warning' });
await fs.writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>window.notch={systemLocale:"zh-CN",platform:"darwin"};</script><script src="fixture.js"></script></body></html>');
const executablePath = process.env.NOTCH_TEST_CHROMIUM || (process.platform === 'win32' && process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234/chrome-win64/chrome.exe') : chromium.executablePath());
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 440, height: 900 }, timezoneId: 'Asia/Shanghai' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(scratch, 'index.html')).href);
    await page.locator('.vocabulary-card h2').filter({ hasText: 'idempotent' }).waitFor();
    assert.match(await page.locator('.vocabulary-phonetic').innerText(), /aɪ/);
    assert.equal(await page.locator('.vocabulary-examples li').count(), 2);
    await page.locator('.vocabulary-workspace').screenshot({ path: path.join(scratch, 'vocabulary-explore.png') });
    await page.getByRole('button', { name: '收藏词汇', exact: true }).click();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    await page.locator('.vocabulary-favorites .row').waitFor();
    assert.equal(await page.locator('.vocabulary-card h2').innerText(), 'idempotent');
    await page.getByRole('button', { name: '复习', exact: true }).click();
    await page.getByRole('button', { name: '显示释义与例句', exact: true }).click();
    assert.equal(await page.locator('.vocabulary-examples li').count(), 2);
    await page.getByRole('button', { name: '记住了', exact: true }).click();
    await page.getByText('本轮复习完成', { exact: true }).waitFor();
    await page.getByRole('button', { name: '复习全部收藏', exact: true }).click();
    await page.getByRole('button', { name: '显示释义与例句', exact: true }).waitFor();
    await page.getByRole('button', { name: '探索', exact: true }).click();
    assert.notEqual(await page.locator('.vocabulary-card h2').innerText(), 'idempotent');
    await page.getByRole('button', { name: '收录词汇', exact: true }).click();
    await page.getByRole('textbox', { name: '词汇', exact: true }).fill('resilience');
    await page.getByRole('textbox', { name: '音标', exact: true }).fill('/rɪˈzɪliəns/');
    await page.getByRole('textbox', { name: '释义', exact: true }).fill('韧性');
    await page.getByRole('textbox', { name: '例句 1', exact: true }).fill('Retries improve resilience.');
    await page.getByRole('textbox', { name: '例句 2', exact: true }).fill('We test resilience under load.');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.vocabulary-card h2').filter({ hasText: 'resilience' }).waitFor();
    await page.locator('#fixture-dark').click(); await page.locator('.vocabulary-workspace').screenshot({ path: path.join(scratch, 'vocabulary-favorites-dark.png') });
    await page.locator('#fixture-trends').click();
    await page.getByRole('button', { name: '打开今日 GitHub Trending', exact: true }).click();
    assert.equal(await page.evaluate(() => window.opened.at(-1)), 'https://github.com/trending?since=daily');
    await page.getByRole('button', { name: '历史归档', exact: true }).click();
    await page.locator('.trends-archive-document h1').filter({hasText:'2026-11-25'}).waitFor();
    await page.getByRole('button', {name:'更早的归档',exact:true}).click();
    await page.locator('.trends-archive-document h1').filter({hasText:'2026-11-24'}).waitFor();
    await page.getByRole('button', {name:'保存今日',exact:true}).click();
    await page.getByText('Saved today.',{exact:true}).waitFor();
    await page.getByRole('button', {name:'打开文档',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.archiveOpened));
    await page.locator('.trends-archive').screenshot({path:path.join(scratch,'archive-history.png')});
    await page.getByRole('button', { name: 'Hugging Face', exact: true }).click();
    await page.locator('.trends-ranked-row').nth(9).waitFor();
    assert.equal(await page.locator('.trends-ranked-row').count(), 10);
    await page.locator('.trends-ranked-row .row-title').first().click();
    assert.equal(await page.evaluate(() => window.opened.at(-1)), 'https://huggingface.co/organization/model-0');
    await page.getByRole('button', { name: '刷新趋势', exact: true }).click();
    await page.getByText(/更新失败，正在显示本地缓存/).waitFor();
    assert.equal(await page.locator('.trends-ranked-row').count(), 10);
    await page.locator('#fixture-english').click();
    await page.getByText('Top 10 trending models', { exact: true }).waitFor();
    await page.locator('.trends-workspace').screenshot({ path: path.join(scratch, 'models-dark-en.png') });
    await page.getByRole('button', { name: 'claude.dev', exact: true }).click();
    await page.locator('.trends-ranked-row').nth(9).waitFor();
    assert.equal(await page.locator('.trends-ranked-row .row-title').first().evaluate(element => getComputedStyle(element).whiteSpace), 'normal');
    await page.setViewportSize({ width: 340, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.trends-workspace').screenshot({ path: path.join(scratch, 'articles-narrow-en.png') });
    await page.locator('#fixture-vocabulary').click();
    await page.getByRole('button', { name: 'Save to favorites', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#fixture-mcp-favorites').click();
    await page.getByText('My favorites', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Explore', exact: true }).click();
    await page.locator('#fixture-mcp-favorites').click();
    await page.getByText('My favorites', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: full word cards, favorites, review, custom entries, trend links, ten-item feeds, offline cache, locales and narrow layouts.');
} finally { await browser.close(); }
