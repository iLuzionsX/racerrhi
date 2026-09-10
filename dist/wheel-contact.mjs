// Rigid visual tyres need a surface support correction: the physical donor
// models tyre compression, whereas the cylinder mesh cannot flatten at contact.
// This affects presentation only; never feed the result into suspension or forces.
export function wheelVisualHubY(physicalY, road, heading, radius=.369, width=.285) {
  const {x=0,y=0,z=1}=road.d||{};
  const horizontalSq=Math.max(1e-8,x*x+z*z);
  const length=Math.hypot(x*y,horizontalSq,z*y);
  const normal=road.normal||{x:-x*y/length,y:horizontalSq/length,z:-z*y/length},normalLength=Math.hypot(normal.x,normal.y,normal.z)||1;
  const nx=normal.x/normalLength,ny=normal.y/normalLength,nz=normal.z/normalLength;
  const axisDot=nx*Math.cos(heading)-nz*Math.sin(heading);
  // Exact cylinder support along the road normal, including its finite width.
  const support=radius*Math.sqrt(Math.max(0,1-axisDot*axisDot))+width*.5*Math.abs(axisDot);
  const distance=Math.abs(road.distance||0);
  const surfaceOffset=road.surfaceOffset??(Math.abs(distance-7.19)<.065?.06:distance>=7.25&&distance<=8.15?.045:distance<=7.5?.02:-.09);
  return Math.max(physicalY,road.p.y+surfaceOffset+support/Math.max(.1,ny));
}
