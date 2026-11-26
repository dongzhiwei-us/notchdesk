const { action, text, idSchema, rows, save, getRow, change, remove, record, requiredText } = require('../shared.cjs');

module.exports.activate = (ctx) => {
  const fields = { title: text(180), text: text(100000) };
  action(ctx, 'snippets_list', '查看命令、Prompt 和文本片段', {}, [], () => rows(ctx));
  action(ctx, 'snippets_add', '保存一段常用文字，text 支持 Markdown 原文', fields, ['title', 'text'], ({ title, text }) => {
    const row = record({ title: requiredText(title), text });
    save(ctx, [row, ...rows(ctx)]);
    return row;
  }, {activate:true});
  action(ctx, 'snippets_update', '修改文本片段，text 支持 Markdown 原文', { id: idSchema, ...fields }, ['id'], ({ id, ...update }) => {
    if (update.title !== undefined) update.title = requiredText(update.title);
    return change(ctx, id, update);
  });
  action(ctx, 'snippets_remove', '删除文本片段', { id: idSchema }, ['id'], ({ id }) => remove(ctx, id));
  action(ctx, 'snippets_copy', '将文本片段复制到系统剪贴板', { id: idSchema }, ['id'], async ({ id }) => {
    await ctx.native('clipboard.write', { kind: 'text', text: getRow(ctx, id).text });
    return { copied: true, id };
  });
};
