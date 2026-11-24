const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { action, text, choice, boolean, idSchema, rows, save, getRow, change, remove, record } = require('../shared.cjs');

const imageLimit = 12 * 1024 * 1024;
const copyLimit = 96 * 1024 * 1024;
const types = {
  '.png': ['image/png', 'image'], '.jpg': ['image/jpeg', 'image'], '.jpeg': ['image/jpeg', 'image'], '.gif': ['image/gif', 'image'],
  '.webp': ['image/webp', 'image'], '.bmp': ['image/bmp', 'image'], '.avif': ['image/avif', 'image'], '.ico': ['image/x-icon', 'image'],
  '.pdf': ['application/pdf', 'pdf'], '.md': ['text/markdown', 'markdown'], '.markdown': ['text/markdown', 'markdown'],
  '.html': ['text/html', 'html'], '.htm': ['text/html', 'html'], '.mp4': ['video/mp4', 'video'], '.webm': ['video/webm', 'video'],
  '.mov': ['video/quicktime', 'video'], '.ogv': ['video/ogg', 'video'], '.txt': ['text/plain', 'text'], '.json': ['application/json', 'text'],
  '.csv': ['text/csv', 'text'], '.js': ['text/plain', 'text'], '.ts': ['text/plain', 'text'], '.css': ['text/plain', 'text'],
  '.py': ['text/plain', 'text'], '.log': ['text/plain', 'text'], '.svg': ['text/plain', 'text'],
};
const supportedImages = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/avif': '.avif', 'image/x-icon': '.ico',
};
const printable = (value) => typeof value === 'string' && value.trim().length > 0;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const prefix = (buffer, bytes) => buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));

function detectImage(buffer) {
  if (prefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (prefix(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (['ftypavif', 'ftypavis'].includes(buffer.toString('ascii', 4, 12))) return 'image/avif';
  if (prefix(buffer, [0, 0, 1, 0])) return 'image/x-icon';
  throw new Error('图片格式无法识别');
}

function inspectFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('请选择本地绝对路径');
  const realPath = fs.realpathSync(filePath);
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) throw new Error('请选择文件');
  return { path: realPath, size: stat.size, modifiedAt: stat.mtimeMs };
}

function publicCard(row) {
  const { filePath, storedName, fingerprint, ...card } = row;
  card.pinned = Boolean(row.pinnedAt);
  if (row.kind !== 'text') card.assetId = row.id;
  if (row.kind === 'file' && !storedName) card.missing = !fs.existsSync(filePath);
  return card;
}

module.exports.activate = (ctx) => {
  const windowState=()=>({pinned:ctx.store.get('windowPinned',false)===true});
  action(ctx,'clip_window_get','读取整条剪贴绳的固定状态，与单个挂件置顶独立',{},[],windowState);
  action(ctx,'clip_window_set','固定或取消固定整条剪贴绳；固定后失焦保留展示',{pinned:boolean},['pinned'],async({pinned})=>{
    ctx.store.set('windowPinned',pinned);
    try{await ctx.native('ui.clipline_pin',{pinned});return {...windowState(),synced:true};}
    catch{ctx.log('warn','clipline.pin_sync_deferred');return {...windowState(),synced:false};}
  });
  action(ctx,'clip_window_hide','主动收起剪贴绳内容，保留固定偏好，与圆环收起独立',{},[],()=>ctx.native('ui.clipline_hide',{}));
  const defaultLayout = { x: 0.5, y: 0.2, anchor: 'notch' };
  function layout(){
    const saved=ctx.store.get('layout', null);
    if(!saved||(!saved.anchor&&saved.x===0.5&&saved.y===0.5&&!saved.displayId))return {...defaultLayout};
    return {...saved,anchor:saved.anchor||'screen'};
  }
  action(ctx, 'clip_layout_get', '读取跨屏剪贴绳的位置；默认跟随圆盘下方，手动移动保存屏幕相对坐标', {}, [], layout);
  action(ctx, 'clip_layout_set', '保存悬挂位置，reset=true 恢复跟随圆盘下方', {
    x: {type:'number',minimum:0,maximum:1}, y: {type:'number',minimum:0,maximum:1}, displayId: text(100), anchor:choice('notch','screen'), reset: boolean,
    shiftX: {type:'number',minimum:-1,maximum:1},
  }, [], ({x,y,displayId,anchor,reset,shiftX}) => {
    const next = reset ? {...defaultLayout} : {...layout(),anchor:anchor||'screen', ...(x===undefined?{}:{x}), ...(y===undefined?{}:{y}), ...(displayId===undefined?{}:{displayId})};
    if(shiftX)save(ctx,rows(ctx).map(row=>typeof row.hangX==='number'?{...row,hangX:Math.max(0,Math.min(1,row.hangX+shiftX))}:row));
    ctx.store.set('layout', next);
    return next;
  });
  const input = {
    kind: choice('text', 'image', 'file'), text: text(200000, 0), base64: text(Math.ceil(imageLimit / 3) * 4 + 140),
    mime: text(160), path: text(32000), name: text(240), storage: choice('reference', 'copy'),
  };

  function resolved(row) {
    return {
      ...publicCard(row),
      ...(row.kind === 'text' ? {} : { path: row.storedName ? path.join(ctx.assetDir, row.storedName) : row.filePath }),
    };
  }

  function stash(data) {
    const now = Date.now();
    let fields;
    let buffer;
    if (data.kind === 'text') {
      if (!printable(data.text) || data.text.length > 200000) throw new Error('请输入不超过 20 万字符的文本');
      fields = {
        kind: 'text', name: data.name?.trim() || data.text.trim().split(/\r?\n/)[0].slice(0, 42),
        mime: 'text/plain', preview: 'text', size: Buffer.byteLength(data.text), text: data.text, fingerprint: digest(data.text),
      };
    } else if (data.kind === 'image') {
      const encoded = data.base64?.replace(/^data:[^;,]+;base64,/, '');
      if (!encoded || encoded.length > Math.ceil(imageLimit / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error('图片过大或格式无效，12 MB 以上请直接挂载文件');
      }
      buffer = Buffer.from(encoded, 'base64');
      const mime = detectImage(buffer);
      fields = { kind: 'image', name: data.name?.trim() || '剪贴图片' + supportedImages[mime], mime, preview: 'image', size: buffer.length, fingerprint: digest(buffer) };
    } else if (data.kind === 'file') {
      const stats = inspectFile(data.path);
      const name = data.name?.trim() || path.basename(stats.path);
      const extension = path.extname(stats.path).toLowerCase();
      const [mime, preview] = types[extension] ?? ['application/octet-stream', 'file'];
      const copy = (data.storage ?? (ctx.config().copyFiles ? 'copy' : 'reference')) === 'copy';
      if (copy && stats.size > copyLimit) {
        if (data.storage === 'copy') throw new Error('96 MB 以上请使用原文件引用');
      }
      fields = {
        kind: 'file', name, mime, preview, size: stats.size, filePath: stats.path,
        fingerprint: stats.path + ':' + stats.size + ':' + stats.modifiedAt, storage: copy && stats.size <= copyLimit ? 'copy' : 'reference',
      };
    } else {
      throw new Error('当前剪贴板中没有可挂载的内容');
    }

    const current = rows(ctx);
    const previous = current.find((row) => row.kind === fields.kind && row.fingerprint === fields.fingerprint && row.storage === fields.storage);
    if (previous) return publicCard(previous);
    const row = record(fields, now);
    if (buffer || row.storage === 'copy') {
      const extension = buffer ? supportedImages[row.mime] : path.extname(row.filePath).toLowerCase();
      row.storedName = row.id + (/^\.[a-z0-9]{1,15}$/.test(extension) ? extension : '');
      fs.mkdirSync(ctx.assetDir, { recursive: true });
      const target = path.join(ctx.assetDir, row.storedName);
      if (buffer) fs.writeFileSync(target, buffer, { flag: 'wx' });
      else fs.copyFileSync(row.filePath, target, fs.constants.COPYFILE_EXCL);
      if (row.storage === 'copy') delete row.filePath;
    }
    try {
      save(ctx, [row, ...current]);
    } catch (error) {
      if (row.storedName) fs.rmSync(path.join(ctx.assetDir, row.storedName), { force: true });
      throw error;
    }
    return publicCard(row);
  }

  function ordered() {
    const order = ctx.store.get('order', []);
    const rank = new Map(order.map((id, index) => [id, index]));
    return rows(ctx).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) ||
      (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1) || b.createdAt - a.createdAt);
  }
  action(ctx, 'clip_list', '浏览水平剪贴绳上的挂件', {}, [], () => ordered().map(publicCard));
  action(ctx, 'clip_move', '沿整屏绳子定位挂件：x 为屏幕横向比例 0..1，resetPosition 恢复自动布局；也支持 beforeId 排序', {
    id:idSchema,beforeId:idSchema,x:{type:'number',minimum:0,maximum:1},resetPosition:boolean,
  }, ['id'], ({id, beforeId, x, resetPosition}) => {
    getRow(ctx, id);
    if (beforeId) getRow(ctx, beforeId);
    if(resetPosition||x!==undefined)change(ctx,id,{hangX:resetPosition?null:x});
    if(beforeId!==id&&(beforeId||(x===undefined&&!resetPosition))){
      const order = ordered().map(item => item.id).filter(value => value !== id);
      order.splice(beforeId ? order.indexOf(beforeId) : order.length, 0, id);
      ctx.store.set('order', order);
    }
    return ordered().map(publicCard);
  });
  action(ctx, 'clip_capture', '手动挂起系统剪贴板内容', {}, [], async () => stash(await ctx.native('clipboard.capture', {})), {activate:true});
  action(ctx, 'clip_import', '挂起文本、图片或本地文件', input, ['kind'], stash, {activate:true});
  action(ctx, 'clip_resolve', '在桌面内解析指定挂件预览', { id: idSchema }, ['id'], ({ id }) => resolved(getRow(ctx, id)));
  action(ctx, 'clip_pin', '置顶或取消置顶剪贴挂件', { id: idSchema, pinned: boolean }, ['id'], ({ id, pinned = true }) => {
    const row = getRow(ctx, id);
    return publicCard(change(ctx, id, { pinnedAt: pinned ? row.pinnedAt ?? Date.now() : null }));
  });
  action(ctx, 'clip_relink', '重新定位一个原文件引用', { id: idSchema, path: text(32000) }, ['id', 'path'], ({ id, path: selected }) => {
    const row = getRow(ctx, id);
    if (row.kind !== 'file' || row.storage !== 'reference') throw new Error('只有原文件引用可以重新定位');
    const stats = inspectFile(selected);
    const extension = path.extname(stats.path).toLowerCase();
    const [mime, preview] = types[extension] ?? ['application/octet-stream', 'file'];
    const name = row.name === path.basename(row.filePath) ? path.basename(stats.path) : row.name;
    const next = change(ctx, id, {
      name, mime, preview, size: stats.size, filePath: stats.path, fingerprint: stats.path + ':' + stats.size + ':' + stats.modifiedAt,
    });
    return publicCard(next);
  });
  action(ctx, 'clip_remove', '移除一个挂件', { id: idSchema }, ['id'], ({ id }) => {
    const row = rows(ctx).find((item) => item.id === id);
    const result = remove(ctx, id);
    if (row?.storedName) fs.rmSync(path.join(ctx.assetDir, row.storedName), { force: true });
    return result;
  });
  action(ctx, 'clip_copy', '把一个挂件写回系统剪贴板', { id: idSchema }, ['id'], async ({ id }) => {
    const row = resolved(getRow(ctx, id));
    let content = { kind: row.kind };
    if (row.kind === 'text') content.text = row.text;
    else if (row.kind === 'image' || (row.preview === 'image' && row.size <= imageLimit)) {
      const stats = inspectFile(row.path);
      if (stats.size > imageLimit) throw new Error('图片超过 12 MB，请打开原文件');
      content = { kind: 'image', path: stats.path, mime: row.mime };
    } else content.path = inspectFile(row.path).path;
    await ctx.native('clipboard.write', content);
    return { copied: true, id };
  });
  action(ctx, 'clip_copy_path', '复制悬挂文件的路径文字', { id: idSchema }, ['id'], async ({ id }) => {
    const row = resolved(getRow(ctx, id));
    if (row.kind !== 'file') throw new Error('请选择悬挂的文件');
    const filePath = inspectFile(row.path).path;
    await ctx.native('clipboard.write', { kind: 'text', text: filePath });
    return { copied: true, id };
  });
  action(ctx, 'clip_open', '打开桌面挂件预览', { id: idSchema }, ['id'], ({ id }) => {
    getRow(ctx, id);
    return ctx.native('ui.open', { view: 'clipline', pluginId: 'clipline', assetId: id });
  });
  action(ctx, 'clip_open_file', '用系统默认应用打开悬挂文件', { id: idSchema }, ['id'], ({ id }) => {
    const row = resolved(getRow(ctx, id));
    return ctx.native('file.open', { path: inspectFile(row.path).path });
  });
};
