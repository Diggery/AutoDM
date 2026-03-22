import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import DiceBox from '@3d-dice/dice-box-threejs';
import './DiceRoller.css';

const DiceRoller = forwardRef((props, ref) => {
  const containerRef = useRef(null);
  const diceBoxRef = useRef(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!containerRef.current || isInitialized.current) return;
    isInitialized.current = true;

    console.log("[DiceRoller] Initializing 3D DiceBox...");

    const diceBox = new DiceBox("#dice-box-portal-container", {
      id: "dice-canvas",
      assetPath: "/",
      theme_colorset: "white",
      theme_surface: "green-felt",
      theme_material: "plastic",
      baseScale: 200,
      strength: 1,
      shadows: false,
      light_intensity: 1.0,
      onRollComplete: (results) => {
        if (props.onRollComplete) {
          props.onRollComplete(results);
        }
        // Auto-hide dice after 5 seconds
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.style.opacity = "0";
            containerRef.current.style.pointerEvents = "none";
          }
        }, 5000);
      }
    });

    diceBox.initialize().then(() => {
      console.log("DiceBox initialized");
      diceBoxRef.current = diceBox;
    }).catch(err => {
      console.error("DiceBox init failed:", err);
      isInitialized.current = false;
    });

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
      isInitialized.current = false;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    roll: (notation, results = null) => {
      console.log("[DiceRoller] roll requested for:", notation, "fixed results:", results);
      if (diceBoxRef.current) {
        if (containerRef.current) {
          containerRef.current.style.opacity = "1";
          containerRef.current.style.pointerEvents = "auto";
          console.log("[DiceRoller] Target container made visible. Triggering 3D engine...");
        } else {
          console.warn("[DiceRoller] Warning: containerRef is null, cannot make visible!");
        }
        
        let rollOp;
        let rollNotation = notation;
        if (results && Array.isArray(results) && results.length > 0) {
           if (rollNotation.includes('+') && results.length > 1) {
             console.log("[DiceRoller] 🎲 TRACE: Triggering manual fixed-result roll injection:", rollNotation, results);
             
             // Inject results manually to bypass the physics engine's parser bug with multi-type deterministic rolls
             const box = diceBoxRef.current;
             box.notationVectors = box.startClickThrow(rollNotation);
             if (box.notationVectors) {
               box.notationVectors.result = results;
               rollOp = new Promise((resolve) => {
                 box.rollDice(() => {
                   const res = box.getDiceResults();
                   box.onRollComplete(res);
                   const ev = new CustomEvent("rollComplete", { detail: res });
                   document.dispatchEvent(ev);
                   resolve(res);
                 });
               });
             } else {
               rollOp = diceBoxRef.current.roll(rollNotation);
             }
           } else {
             rollNotation = `${rollNotation}@${results.join(',')}`;
             console.log("[DiceRoller] 🎲 TRACE: Triggering single fixed-result roll:", rollNotation);
             rollOp = diceBoxRef.current.roll(rollNotation);
           }
        } else {
           console.log("[DiceRoller] 🎲 TRACE: Triggering random roll:", notation);
           rollOp = diceBoxRef.current.roll(notation);
        }

        return rollOp.then(res => {
          console.log("[DiceRoller] Physics engine completed roll:", res);
          return res;
        }).catch(err => {
           console.error("[DiceRoller] Physics engine crashed:", err);
           return null;
        });
      } else {
        console.error("[DiceRoller] Critical: diceBoxRef.current is empty! The 3D engine failed to initialize.");
      }
      return null;
    }
  }));

  return createPortal(
    <div 
      id="dice-box-portal-container" 
      ref={containerRef} 
      className="dice-roller-overlay"
    ></div>,
    document.body
  );
});

export default DiceRoller;
