import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import DiceBox from '@3d-dice/dice-box-threejs';
import './DiceRoller.css';

const DiceRoller = forwardRef((props, ref) => {
  const containerRef = useRef(null);
  const diceBoxRef = useRef(null);
  const isInitialized = useRef(false);
  const hideTimerRef = useRef(null);


  useEffect(() => {
    if (!containerRef.current || isInitialized.current) return;
    isInitialized.current = true;

    console.log("[DiceRoller] Initializing 3D DiceBox...");

    const diceBox = new DiceBox("#dice-box-portal-container", {
      id: "dice-canvas",
      assetPath: "/",
      theme_colorset: "white",
      theme_material: "plastic",
      baseScale: 200,
      strength: 1,
      shadows: false,
      light_intensity: 1.0,
      onRollComplete: (results) => {
        console.log("[DiceRoller] 🎲 Engine roll complete.");
        if (props.onRollComplete) props.onRollComplete(results);
        document.dispatchEvent(new CustomEvent('diceAnimationFinished_INTERNAL', { detail: results }));
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
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      isInitialized.current = false;
    };
  }, []);

  const hideDice = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (containerRef.current) {
        console.log("[DiceRoller] 🪄 Starting fade out sequence...");
        containerRef.current.style.opacity = "0.001";

        setTimeout(() => {
          if (containerRef.current) {
            console.log("[DiceRoller] 🪄 Stage 2: Hiding stage completely.");
            containerRef.current.style.setProperty('display', 'none', 'important');
            containerRef.current.style.setProperty('visibility', 'hidden', 'important');
            containerRef.current.style.zIndex = "-1000";
          }
          try {
            if (diceBoxRef.current && typeof diceBoxRef.current.clear === 'function') {
              diceBoxRef.current.clear(); // Reverted: no await
            }
          } catch (e) {
            console.warn("DiceBox clear failed:", e);
          }
        }, 500);
      }
    }, 3500);
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      if (containerRef.current) {
        containerRef.current.style.setProperty('display', 'none', 'important');
        containerRef.current.style.setProperty('visibility', 'hidden', 'important');
        containerRef.current.style.zIndex = "-1000";
      }
      if (diceBoxRef.current && typeof diceBoxRef.current.clear === 'function') {
        diceBoxRef.current.clear();
      }
    },
    roll: async (notation, results = null) => {
      console.log("[DiceRoller] roll requested for:", notation, "fixed results:", results);

      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      if (diceBoxRef.current) {
        if (containerRef.current) {
          containerRef.current.style.display = "block";
          containerRef.current.style.visibility = "visible";
          containerRef.current.style.opacity = "1";
          containerRef.current.style.zIndex = "1000";
          containerRef.current.style.pointerEvents = "none";
          console.log("[DiceRoller] Stage ready.");
        }

        // REVERTED: Remove await clear() which might be hanging
        try {
          if (diceBoxRef.current && typeof diceBoxRef.current.clear === 'function') {
            diceBoxRef.current.clear();
          }
        } catch (e) {
          console.warn("[DiceRoller] Pre-roll clear failed:", e);
        }



        let rollNotation = notation;

        // Setup internal event listener BEFORE triggering the roll
        const completionPromise = new Promise((resolve) => {
          let timeoutId;
          const handler = (e) => {
            clearTimeout(timeoutId);
            document.removeEventListener('diceAnimationFinished_INTERNAL', handler);
            console.log("[DiceRoller] 🎯 Internal event caught. Resolving.");
            resolve(e.detail);
          };
          document.addEventListener('diceAnimationFinished_INTERNAL', handler);

          // 6s Safety timeout (increased for reliability)
          timeoutId = setTimeout(() => {
            document.removeEventListener('diceAnimationFinished_INTERNAL', handler);
            console.log("[DiceRoller] ⚠️ Safety timeout hit. Forcing resolve.");
            resolve(null);
          }, 6000);
        });

        if (results && Array.isArray(results) && results.length > 0) {
          if (rollNotation.includes('+') && results.length > 1) {
            console.log("[DiceRoller] 🎲 TRACE: Triggering manual fixed-result roll injection for multi-die:", rollNotation, results);
            const box = diceBoxRef.current;
            box.notationVectors = box.startClickThrow(rollNotation);
            if (box.notationVectors) {
              box.notationVectors.result = results;
              box.rollDice();
            } else {
              diceBoxRef.current.roll(rollNotation);
            }
          } else {
            rollNotation = `${rollNotation}@${results.join(',')}`;
            console.log("[DiceRoller] 🎲 TRACE: Triggering single fixed-result roll:", rollNotation);
            diceBoxRef.current.roll(rollNotation);
          }
        } else {

          console.log("[DiceRoller] 🎲 TRACE: Triggering random roll:", notation);
          diceBoxRef.current.roll(notation);
        }


        const finalResult = await completionPromise;
        console.log("[DiceRoller] 🎯 Roll cycle complete. Triggering hide in 3.5s.");
        hideDice();
        return finalResult;


      } else {
        console.error("[DiceRoller] Critical: diceBoxRef.current is empty!");
      }
      return Promise.resolve(null);
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
