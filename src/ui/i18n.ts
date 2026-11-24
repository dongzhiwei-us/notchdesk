import i18next from 'i18next';
import chinese from '../locales/zh-CN.json';
import english from '../locales/en-US.json';
import {resolveLocale} from '../shared/locales';

const reverse = new Map(Object.entries(english).map(([key,value])=>[value,key]));
void i18next.init({
  lng:resolveLocale('system',window.notch?.systemLocale || navigator.language),
  fallbackLng:'zh-CN',initAsync:false,keySeparator:false,nsSeparator:false,
  interpolation:{escapeValue:false},
  resources:{'zh-CN':{translation:chinese},'en-US':{translation:english}}
});
export function tr<T>(value:T):T {
  if(typeof value!=='string')return value;
  return i18next.t(reverse.get(value)||value) as T;
}
export const fmt=(key:string,values:Record<string,unknown>)=>i18next.t(key,values);
export function createPluginTranslator(pluginId:string) {
  const namespace='plugin-'+pluginId;
  function translate(key:string,values:Record<string,unknown>={}) {
    return String(i18next.t(reverse.get(key)||key,{...values,ns:namespace,fallbackNS:'translation'}));
  }
  return {tr:<T>(value:T):T=>typeof value==='string'?translate(value) as T:value,fmt:translate};
}
export function applyLocale(preference:string, plugins:{id:string;translations?:Record<string,Record<string,string>>}[]) {
  for(const plugin of plugins)for(const [locale,messages]of Object.entries(plugin.translations||{})) {
    i18next.removeResourceBundle(locale,'plugin-'+plugin.id);
    i18next.addResourceBundle(locale,'plugin-'+plugin.id,messages,true,true);
  }
  const language=resolveLocale(preference,window.notch?.systemLocale||navigator.language);
  if(i18next.language!==language)void i18next.changeLanguage(language);
  document.documentElement.lang=language;
}
export const currentLocale=()=>i18next.language;
export const subscribeLocale=(callback:()=>void)=>{i18next.on('languageChanged',callback);return ()=>{i18next.off('languageChanged',callback);};};
