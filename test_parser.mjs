import fs from 'fs';
const esFile = fs.readFileSync('c:/Web/AutoDM/node_modules/@3d-dice/dice-box-threejs/dist/dice-box-threejs.umd.js', 'utf8');

// We just need to check if 1d100+1d10@40,5 parses into two sets, or if we need 1d100+1d10@40+5, or 1d10,1d100
// Since it's hard to extract the parser, let's look at the source again.
