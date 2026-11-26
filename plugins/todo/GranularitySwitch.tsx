import { useId } from 'react';
import { createPluginTranslator } from '../../src/ui/i18n';
import type { Granularity } from './calendar';
const { tr } = createPluginTranslator('todo');
export function GranularitySwitch({ value, onChange, label }: { value: Granularity; onChange: (value: Granularity) => void; label: string }) {
    const id = useId();
    return <div className="todo-granularity-control"><label htmlFor={id}>{label}</label><div className="todo-granularity-switch" data-granularity={value}>
        <span className="todo-granularity-thumb" aria-hidden="true"/><span aria-hidden="true">{tr('天')}</span><span aria-hidden="true">{tr('小时')}</span>
        <input id={id} type="range" min={0} max={1} step={1} value={value === 'day' ? 0 : 1} aria-label={label} aria-valuetext={value === 'day' ? tr('天') : tr('小时')} onChange={event => onChange(event.target.value === '0' ? 'day' : 'hour')}/>
    </div></div>;
}
