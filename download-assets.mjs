import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
const dir=new URL('./dist/assets/terrain/',import.meta.url);mkdirSync(dir,{recursive:true});
const get=url=>execFileSync('curl',['-fLsS','--retry','2','--max-time','60',url],{maxBuffer:20*1024*1024});
for(const [id,prefix] of [['asphalt_02','asphalt'],['leafy_grass','grass'],['rock_boulder_cracked','rock']]){
 const meta=JSON.parse(get('https://api.polyhaven.com/files/'+id));
 for(const [kind,suffix] of [['Diffuse','color'],['nor_gl','normal'],['Rough','rough']]){
  const entry=meta[kind]?.['1k']?.jpg;if(!entry)throw Error(id+' missing '+kind);
  writeFileSync(new URL(prefix+'-'+suffix+'.jpg',dir),get(entry.url));
 }
 console.log('Downloaded',id);
}
const hdr=JSON.parse(get('https://api.polyhaven.com/files/grasslands_sunset')).hdri['1k'].hdr;
writeFileSync(new URL('sunset.hdr',dir),get(hdr.url));
writeFileSync(new URL('../RGBELoader.js',dir),get('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/RGBELoader.js'));
console.log('Downloaded HDR lighting and RGBE loader');
