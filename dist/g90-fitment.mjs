// The source asset's rear tyres are 363–366 mm wide. The pinned G90 uses
// 285/40ZR20 front / 295/35ZR21 rear; do not move its physical suspension hubs.
export function g90WheelFitment(id,min,max){
 const width=id.startsWith('F')?.285:.295;
 const size=max.map((v,i)=>v-min[i]),centre=max.map((v,i)=>(v+min[i])/2);
 if(size.some(v=>!Number.isFinite(v)||v<=0))throw Error('Invalid G90 wheel bounds');
 const radial=.738/Math.max(size[1],size[2]),scale=[width/size[0],radial,radial];
 return {scale,offset:centre.map((v,i)=>-v*scale[i]),width};
}
