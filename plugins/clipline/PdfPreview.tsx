import { createPluginTranslator } from '../../src/ui/i18n';
const { tr, fmt } = createPluginTranslator('clipline');
import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfPreview({ url,compact=false }: {
    url: string;
    compact?:boolean;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
    const [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        setDoc(null);
        setPage(1);
        setZoom(1);
        setError('');
        const base = new URL('./pdf-data/', document.baseURI).href;
        const task = getDocument({ url, useSystemFonts: true, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
        task.promise.then(pdf => {
            if (live)
                setDoc(pdf);
        }).catch(err => {
            if (live)
                setError(err.message);
        });
        return () => { live = false; void task.destroy(); };
    }, [url]);
    useEffect(() => {
        if (!doc || !canvas.current)
            return;
        let live = true, cancel: undefined | (() => void);
        async function render() {
            const item = await doc!.getPage(page);
            const node = canvas.current;
            if (!live || !node)
                return;
            const natural = item.getViewport({ scale: 1 }), width = Math.min(compact?260:760, Math.max(180, node.parentElement?.clientWidth || 400)) * zoom;
            const ratio = Math.min(2, window.devicePixelRatio || 1), viewport = item.getViewport({ scale: width * ratio / natural.width });
            node.width = Math.ceil(viewport.width);
            node.height = Math.ceil(viewport.height);
            node.style.width = width + 'px';
            const task = item.render({ canvas: node, viewport });
            cancel = () => task.cancel();
            await task.promise;
        }
        render().catch(err => {
            if (live)
                setError(err.message);
        });
        return () => { live = false; cancel?.(); };
    }, [doc, page, zoom,compact]);
    return <div style={{ width: '100%', minWidth: 0 }}>
  {!compact&&<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 6 }}>
   <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr("上一页")}</button>
   <span>{doc ? page + ' / ' + doc.numPages : tr("读取中")}</span>
   <button type="button" disabled={!doc || page >= doc.numPages} onClick={() => setPage(page + 1)}>{tr("下一页")}</button>
   <button type="button" onClick={() => setZoom(zoom >= 1.5 ? 1 : zoom + .25)}>{Math.round(zoom * 100)}%</button>
  </div>}
  {error ? <p role="alert">{error}</p> : <div style={{ maxHeight:compact?170:'min(58vh,620px)', overflow: 'auto' }}><canvas ref={canvas} aria-label={tr("PDF 第 ") + page + tr(" 页")}/></div>}
 </div>;
}
