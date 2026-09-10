import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
const dir=new URL('./dist/assets/terrain/',import.meta.url);mkdirSync(dir,{recursive:true});
// High mode intentionally spends bandwidth on the surfaces closest to the car.
// 4K albedo + already-cached 1K normal/roughness gives visible runoff detail
// without a live quality switch decoding six large textures at once.
const get=url=>execFileSync('curl',['-fLsS','--retry','2','--max-time','60',url],{maxBuffer:100*1024*1024});
for(const [id,prefix,resolution,kinds] of [
  ['asphalt_02','asphalt','2k'],
  ['leafy_grass','grass','2k'],
  ['rock_boulder_cracked','rock','2k'],
  ['sandy_gravel_02','sand-1k','1k'],
  ['dirt_aerial_02','dirt-1k','1k'],
  ['sandy_gravel_02','sand','4k',[['Diffuse','color']]],
  ['dirt_aerial_02','dirt','4k',[['Diffuse','color']]],
  ['clean_asphalt','road-scan','2k'],
  ['gravel_road','rally-scan','2k'],
]){
 const meta=JSON.parse(get('https://api.polyhaven.com/files/'+id));
 for(const [kind,suffix] of (kinds||[['Diffuse','color'],['nor_gl','normal'],['Rough','rough']])){
  const entry=meta[kind]?.[resolution]?.jpg;if(!entry)throw Error(id+' missing '+kind+' at '+resolution);
  writeFileSync(new URL(prefix+'-'+suffix+'.jpg',dir),get(entry.url));
 }
 console.log('Downloaded',id,resolution,prefix);
}
const hdr=JSON.parse(get('https://api.polyhaven.com/files/grasslands_sunset')).hdri['2k'].hdr;
writeFileSync(new URL('sunset.hdr',dir),get(hdr.url));
writeFileSync(new URL('../RGBELoader.js',dir),get('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/RGBELoader.js'));
console.log('Downloaded HDR lighting and RGBE loader');
const daylight=JSON.parse(get('https://api.polyhaven.com/files/kloofendal_48d_partly_cloudy')).hdri['1k'].hdr;
writeFileSync(new URL('daylight.hdr',dir),get(daylight.url));
