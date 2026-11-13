// Non-visual regression checks for the reversible Passiton brand palette.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=file=>fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8');
const palette=read('css/autumn-palette.css');
const index=read('index.html');
const privacy=read('integritetspolicy.html');
const styles=read('css/styles.css');

for(const hex of ['#632713','#FF8C00','#FFC72C','#FFF5EE']){
  assert.ok(palette.includes(hex),'Missing approved color '+hex);
}
for(const html of [index,privacy]){
  assert.match(html,/href="css\/autumn-palette\.css"/);
  assert.ok(html.indexOf('css/autumn-palette.css')>html.indexOf('css/privacy.css'),
    'Theme layer must load after existing component CSS');
  assert.match(html,/<meta name="theme-color" content="#632713"/);
}
assert.match(index,/src="js\/navigation-history\.js"/);
assert.match(index,/href="integritetspolicy\.html"/);
assert.match(styles,/--green:#0c5a43/); // Base CSS stays untouched; override is reversible.
assert.match(palette,/\.primary-cta[\s\S]*?background:var\(--pio-orange\)/);

function luminance(hex){
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>
    x<=0.04045?x/12.92:Math.pow((x+0.055)/1.055,2.4));
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(a,b){
  const hi=Math.max(luminance(a),luminance(b));
  const lo=Math.min(luminance(a),luminance(b));
  return (hi+0.05)/(lo+0.05);
}
assert.ok(contrast('#632713','#FF8C00')>=4.5,'Primary orange buttons must have AA text contrast');
assert.ok(contrast('#632713','#FF9900')>=4.5,'Hover buttons must maintain AA text contrast');
assert.ok(contrast('#632713','#FFF5EE')>=7,'Text on cream must have strong contrast');
assert.ok(contrast('#632713','#FFC72C')>=4.5,'Text on yellow must have AA contrast');
console.log('Passiton brand palette static regression tests passed');
