// Dry, compacted road centre and loose aggregate shoulder. These are calibrated
// simulation surfaces, not claims of measured G90 tyre/soil coefficients.
export const RALLY_PACKED=Object.freeze({type:'gravel',friction:.72,rollingResistance:.036,looseness:.30,isKerbRumble:false});
export const RALLY_LOOSE=Object.freeze({type:'gravel',friction:.56,rollingResistance:.075,looseness:.85,isKerbRumble:false});
export function rallyMaterial(edge,blend,variation=0){
 const mix=(a,b,t)=>a+(b-a)*t;
 return {type:'gravel',friction:mix(.88,mix(RALLY_PACKED.friction,RALLY_LOOSE.friction,edge)+variation,blend),rollingResistance:mix(.022,mix(RALLY_PACKED.rollingResistance,RALLY_LOOSE.rollingResistance,edge),blend),looseness:blend*mix(RALLY_PACKED.looseness,RALLY_LOOSE.looseness,edge),isKerbRumble:false};
}
