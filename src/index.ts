import { 
  calculateSteelJacketedBeamMomentCapacity 
} from "./strengthening/rc-beam-steel-plate-jacketing";

// Example usage
const h = calculateSteelJacketedBeamMomentCapacity(
  {
    Es: 207000, // Steel modulus of elasticity in MPa
    fc_: 18, // Concrete compressive strength in MPa
    fy: 240, // Steel yield strength in MPa
    As: 353, // Area of tension steel in mm^2
    As_: 353, // Area of compression steel in mm^2
    b: 200,
    h: 400,
    d: 360,
    d_: 40,
  },
  {
    topSteelWidth: 200, // Width of top steel plate in mm
    topSteelThickness: 6, // Thickness of top steel plate in mm
    bottomSteelWidth: 200, // Width of bottom steel plate in mm
    bottomSteelThickness: 8, // Thickness of bottom steel plate in mm
    Es: 207000, // Steel modulus of elasticity in MPa
    fy: 240, // Steel yield strength in MPa
  },
);

console.log(h);
