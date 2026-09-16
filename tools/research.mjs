import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import { parse as parseJS } from 'acorn';
import { format } from 'prettier';

const root = path.resolve('.materials');
const command = process.argv[2];
if (command === 'html') {
  for (const file of (await fs.readdir(root)).filter(f => f.endsWith('.html'))) {
    const html = await fs.readFile(path.join(root, file), 'utf8');
    const doc = parse(html);
    const matches = [];
    function visit(node) {
      const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
      if (node.tagName === 'video' || /^(danmu|bpx-player-dm-wrap)$/.test(attrs.class || '') || attrs.class?.includes('x6QYrwaa')) {
        matches.push({tag: node.tagName, class: attrs.class, style: attrs.style,
          children: node.childNodes?.filter(n=>n.tagName).length,
          ancestry: (()=>{const result=[]; for(let n=node.parentNode;n && result.length<5;n=n.parentNode) result.push({tag:n.tagName,attrs:Object.fromEntries((n.attrs||[]).filter(a=>/^(class|id|data-e2e|data-id|data-aweme-id)$/.test(a.name)).map(a=>[a.name,a.value]))}); return result;})()});
      }
      for(const child of node.childNodes || []) visit(child);
    }
    visit(doc);
    console.log(file,JSON.stringify(matches,null,2));
  }
} else if (command === 'module') {
  const file = process.argv[3];
  const id = process.argv[4];
  const source = await fs.readFile(file, 'utf8');
  const ast = parseJS(source, {ecmaVersion:'latest',sourceType:'script'});
  let found;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Property' && String(node.key.value) === id && node.value.type === 'FunctionExpression') found=source.slice(node.value.start,node.value.end);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(ast);
  if (!found) throw new Error('Module not found');
  await fs.writeFile(path.join(root, `module-${id}.js`),await format(`(${found})`,{parser:'babel'}));
  console.log(`Extracted module ${id}`);
}
