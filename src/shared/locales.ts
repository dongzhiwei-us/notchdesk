export const localeOptions = [
  {value:'system', label:'跟随系统'},
  {value:'zh-CN', label:'简体中文'},
  {value:'en-US', label:'English'}
] as const;
export const supportedLocales = ['zh-CN','en-US'] as const;
export function resolveLocale(preference:string, systemLanguage:string) {
  if(preference==='zh-CN'||preference==='en-US')return preference;
  return systemLanguage.toLowerCase().startsWith('zh')?'zh-CN':'en-US';
}
