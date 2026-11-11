/**
 * Safe, framework-free helpers for visualize renderers.
 */

export function stripCodeFence(source: string): string {
  const trimmed = source.trim()
  const fenced = trimmed.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

/** Parse strict JSON, then the narrow JS-object subset models commonly emit. */
export function parseChartConfig(source: string): unknown {
  const raw = stripCodeFence(source)
  try {
    return JSON.parse(raw)
  } catch {
    const jsonish = raw
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) =>
        JSON.stringify(value.replace(/\\'/g, "'")),
      )
      .replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(jsonish)
  }
}

/** Split multiple concatenated SVG blocks so their ids can be scoped separately. */
export function splitSvgBlocks(raw: string): string[] {
  const blocks = raw.match(/<svg[\s\S]*?<\/svg>/gi)
  return blocks?.length ? blocks : [raw.trim()]
}

let svgScopeSequence = 0

/**
 * Parse and sanitize an LLM-authored SVG. Scripts, embedded HTML/media,
 * javascript URLs and on* handlers are stripped before inline rendering.
 * Element ids are scoped to avoid collisions with other messages.
 */
export function sanitizeSvg(raw: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(raw.trim(), 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg') return ''
  if (root.getElementsByTagName('parsererror').length > 0) return ''

  const stripSelector = 'script,foreignObject,iframe,object,embed,audio,video,handler'
  root.querySelectorAll(stripSelector).forEach(node => node.remove())
  const ids = new Set<string>()
  root.querySelectorAll('[id]').forEach(node => {
    const id = node.getAttribute('id')
    if (id) ids.add(id)
  })
  const prefix = ids.size ? `dtsvg${svgScopeSequence++}-` : ''

  const walk = (element: Element): void => {
    const tag = element.nodeName.toLowerCase()
    const ownId = element.getAttribute('id')
    if (ownId && ids.has(ownId)) element.setAttribute('id', prefix + ownId)
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      const compact = attr.value.replace(/\s+/g, '').toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name)
        continue
      }
      if (
        (name === 'href' || name === 'xlink:href') &&
        (compact.startsWith('javascript:') ||
          (compact.startsWith('data:') && !compact.startsWith('data:image/')))
      ) {
        element.removeAttribute(attr.name)
        continue
      }
      if (name === 'style' && compact.includes('javascript:')) {
        element.removeAttribute(attr.name)
        continue
      }
      if (
        (tag === 'set' || tag === 'animate') &&
        name === 'attributename' &&
        compact.startsWith('on')
      ) {
        element.remove()
        return
      }
      let value = attr.value.replace(
        /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
        (match, quote: string, id: string) =>
          ids.has(id) ? `url(${quote}#${prefix}${id}${quote})` : match,
      )
      if ((name === 'href' || name.endsWith(':href')) && value.startsWith('#') && ids.has(value.slice(1))) {
        value = `#${prefix}${value.slice(1)}`
      } else if (name === 'aria-labelledby' || name === 'aria-describedby') {
        value = value
          .split(/\s+/)
          .map(token => (ids.has(token) ? prefix + token : token))
          .join(' ')
      }
      if (value !== attr.value) element.setAttribute(attr.name, value)
    }
    Array.from(element.children).forEach(walk)
  }
  walk(root)
  return root.outerHTML
}

const KATEX_HEAD = [
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin="anonymous">',
  '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin="anonymous"><\/script>',
  '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin="anonymous"><\/script>',
  '<script>document.addEventListener("DOMContentLoaded",function(){var n=0,i=setInterval(function(){if(typeof renderMathInElement==="function"){clearInterval(i);try{renderMathInElement(document.body,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false},{left:"\\\\(",right:"\\\\)",display:false},{left:"\\\\[",right:"\\\\]",display:true}],throwOnError:false})}catch(e){}}}else if(++n>50)clearInterval(i)},100)})<\/script>',
].join('\n')

function injectKatex(html: string): string {
  const lower = html.toLowerCase()
  if (lower.includes('katex@') || lower.includes('katex.min.')) return html
  if (html.includes('</head>')) return html.replace('</head>', `${KATEX_HEAD}\n</head>`)
  if (/<head([^>]*)>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>\n${KATEX_HEAD}`)
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /(<html[^>]*>)/i,
      `$1\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${KATEX_HEAD}</head>`,
    )
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${KATEX_HEAD}</head><body>${html}</body></html>`
}

const BRIDGE_SCRIPT = `<script data-dt-bridge>
(function(){
  window.sendPrompt=function(text){try{parent.postMessage({type:"dt:visualize-prompt",text:String(text||"")},"*")}catch(e){}};
  function report(){try{var h=document.body&&document.body.scrollHeight||document.documentElement.scrollHeight||0;parent.postMessage({type:"dt:visualize-height",height:h},"*")}catch(e){}}
  var frame=0;function schedule(){if(frame)return;frame=(requestAnimationFrame||function(fn){return setTimeout(fn,0)})(function(){frame=0;report()})}
  function start(){try{if(document.body&&window.ResizeObserver){new ResizeObserver(schedule).observe(document.body)}if(document.body&&window.MutationObserver){new MutationObserver(schedule).observe(document.body,{attributes:true,characterData:true,childList:true,subtree:true})}schedule()}catch(e){report()}}
  if(document.body)start();else document.addEventListener("DOMContentLoaded",start,{once:true});
  window.addEventListener("load",schedule);
})();
<\/script>`

export function sanitizeIframeHtml(html: string): string {
  return html
    .replace(/\s(href|src|formaction)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
    .replace(/\starget\s*=\s*(['"])_(top|parent)\1/gi, ' target="_self"')
}

/** Inject KaTeX and the host bridge, then strip parent-navigation vectors. */
export function prepareIframeHtml(html: string): string {
  const prepared = sanitizeIframeHtml(injectKatex(html || ''))
  if (prepared.includes('</body>')) return prepared.replace('</body>', `${BRIDGE_SCRIPT}\n</body>`)
  if (prepared.includes('</html>')) return prepared.replace('</html>', `${BRIDGE_SCRIPT}\n</html>`)
  return `${prepared}\n${BRIDGE_SCRIPT}`
}
