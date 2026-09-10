// Metre-scale, dry scanned ground. Fine aggregate and broad wear have separate
// frequencies; no displacement, screen-space blur, or glossy "wet road" trick.
// Two offset/rotated samples suppress obvious repetition without a texture atlas.
export function groundMaterial(material,{metres=2,kind='soil',feather=false}={}){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGroundWorld;varying vec2 vGroundRoad;').replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 groundPosition=vec4(position,1.);\n#ifdef USE_INSTANCING\ngroundPosition=instanceMatrix*groundPosition;\n#endif\nvGroundWorld=(modelMatrix*groundPosition).xyz;vGroundRoad=uv;');
  const common=`
varying vec3 vGroundWorld;varying vec2 vGroundRoad;
float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float groundNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);}
const mat2 groundRotation=mat2(.8,.6,-.6,.8);
vec2 groundUV(){return vGroundWorld.xz/${metres.toFixed(4)};}
float groundBlend(){return .25+.5*groundNoise(vGroundWorld.xz*.17);}
vec4 groundSample(sampler2D tex){vec2 p=groundUV();return mix(texture2D(tex,p),texture2D(tex,groundRotation*p*.83+vec2(13.7,5.3)),groundBlend());}
`;
  const shade=kind==='asphalt'?`
float wear=groundNoise(vGroundWorld.xz*.055),patch=groundNoise(vGroundWorld.xz*.22);
diffuseColor.rgb*=.84+.20*wear+.035*patch;
// Slightly accumulated dust near the road edges, not continuous black rails.
float verge=smoothstep(1.08,1.49,abs(vGroundRoad.x-1.5));
diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.16,1.09,.95),verge*.34);
`:kind==='grass'?`
float growth=groundNoise(vGroundWorld.xz*.027)*.7+groundNoise(vGroundWorld.xz*.095)*.3;
float luminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
diffuseColor.rgb=mix(vec3(luminance),diffuseColor.rgb,.68)*mix(vec3(.56,.64,.39),vec3(.96,.94,.72),smoothstep(.25,.76,growth));
`:kind==='rock'?`
diffuseColor.rgb*=.65+.28*groundNoise(vGroundWorld.xz*.025);
`:`
float broad=groundNoise(vGroundWorld.xz*.055),fine=groundNoise(vGroundWorld.xz*.31);
float luminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
diffuseColor.rgb=mix(vec3(luminance),diffuseColor.rgb,.58)*(.88+.20*broad+.055*fine);
${feather?`float track=exp(-pow((abs(vGroundRoad.x)-.86)/.46,2.));
diffuseColor.rgb*=1.-track*(.035+.045*groundNoise(vGroundWorld.xz*.23));
diffuseColor.a*=1.-smoothstep(4.3,6.8,abs(vGroundRoad.x)+(groundNoise(vGroundWorld.xz*1.7)-.5)*.65);`:''}
`;
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+common).replace('#include <map_fragment>',`
#ifdef USE_MAP
diffuseColor *= groundSample(map);
#endif
${shade}
`).replace('#include <normal_fragment_maps>',`
#ifdef USE_NORMALMAP_TANGENTSPACE
vec2 p=groundUV();
vec3 na=texture2D(normalMap,p).xyz*2.-1.,nb=texture2D(normalMap,groundRotation*p*.83+vec2(13.7,5.3)).xyz*2.-1.;
nb.xy=nb.xy*groundRotation;
vec2 detail=mix(na.xy,nb.xy,groundBlend())*normalScale;
// World X/Z projection also works across curve seams and shared shoulders.
vec3 tx=normalize((viewMatrix*vec4(1.,0.,0.,0.)).xyz);
tx=normalize(tx-normal*dot(normal,tx));vec3 tz=normalize(cross(tx,normal));
normal=normalize(normal+tx*detail.x+tz*detail.y);
#endif
`).replace('#include <roughnessmap_fragment>',`
#ifdef USE_ROUGHNESSMAP
roughnessFactor*=groundSample(roughnessMap).g;
#endif
roughnessFactor=max(roughnessFactor,${kind==='asphalt'?'.82':'.9'});
`);
 };
 material.customProgramCacheKey=()=>`dry-ground-v2-${metres}-${kind}-${feather}`;material.needsUpdate=true;
 return material;
}
