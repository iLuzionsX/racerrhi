import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
const dir=new URL('./dist/assets/terrain/',import.meta.url);mkdirSync(dir,{recursive:true});
// 4K normal maps can exceed 20 MB; keep the download bounded but large enough
// for the high-resolution sand/dirt maps used by the runoff shoulders.
const get=url=>execFileSync('curl',['-fLsS','--retry','2','--max-time','60',url],{maxBuffer:80*1024*1024});
for(const [id,prefix,resolution,kinds] of [
  ['asphalt_02','asphalt','2k'],
  ['leafy_grass','grass','2k'],
  ['rock_boulder_cracked','rock','2k'],
  // Balanced quality uses lightweight color maps; High switches to the 4K versions below.
  ['sandy_gravel_02','sand-1k','1k',[['Diffuse','color']]],
  ['dirt_aerial_02','dirt-1k','1k',[['Diffuse','color']]],
  // Higher-resolution runoff surfaces: the sand is visible beside the racing line,
  // while the dirt layer fills the wider graded shoulder beneath it.
  ['sandy_gravel_02','sand','4k',[['Diffuse','color']]],
  ['dirt_aerial_02','dirt','4k',[['Diffuse','color']]],
]){
 const meta=JSON.parse(get('https://api.polyhaven.com/files/'+id));
 for(const [kind,suffix] of (kinds||[['Diffuse','color'],['nor_gl','normal'],['Rough','rough']])){
  const entry=meta[kind]?.[resolution]?.jpg;if(!entry)throw Error(id+' missing '+kind+' at '+resolution);
  writeFileSync(new URL(prefix+'-'+suffix+'.jpg',dir),get(entry.url));
 }
 console.log('Downloaded',id,resolution);
}
const hdr=JSON.parse(get('https://api.polyhaven.com/files/grasslands_sunset')).hdri['2k'].hdr;
writeFileSync(new URL('sunset.hdr',dir),get(hdr.url));
writeFileSync(new URL('../RGBELoader.js',dir),get('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/RGBELoader.js'));
console.log('Downloaded HDR lighting and RGBE loader');
