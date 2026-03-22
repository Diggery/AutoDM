const fs = require('fs');
const code = fs.readFileSync('./node_modules/@3d-dice/dice-box-threejs/dist/dice-box-threejs.umd.js', 'utf8');

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><div id="test"></div>');
global.window = dom.window;
global.document = dom.window.document;
global.cancelAnimationFrame = () => {};
global.requestAnimationFrame = () => {};
global.CustomEvent = class {};

eval(code);

const DiceBox = global.window.DiceBoxThreeJS || global.window.DiceBox;
const box = new DiceBox("#test");
box.display = { containerWidth: 100, containerHeight: 100 };
box.DiceFactory = { get: (t) => ({ type: t, shape: t, inertia: 1 }) };

function test(str) {
  try {
    let v = box.getNotationVectors(str, {x:0,y:0}, 1, 1).vectors;
    console.log(`"${str}" -> types:`, v.map(v => v.type).join(', '));
  } catch(e) { console.error(`"${str}" failed:`, e.message); }
}

test("1d100@40+1d10@5");
test("1d100@40 + 1d10@5");
test("1d100@40,1d10@5");
test("1d100@40, 1d10@5");
test("1d100@40;1d10@5");
test(["1d100@40", "1d10@5"]);
