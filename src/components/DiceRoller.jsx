import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import DiceBox from '@3d-dice/dice-box-threejs';
import './DiceRoller.css';

const DiceRoller = forwardRef((props, ref) => {
  const containerRef = useRef(null);
  const diceBoxRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize DiceBox
    const diceBox = new DiceBox("#dice-box-container", {
      id: "dice-canvas",
      assetPath: "/",
      theme_colorset: "white",
      theme_surface: "green-felt",
      baseScale: 100,
      strength: 1,
      onRollComplete: (results) => {
        if (props.onRollComplete) {
          props.onRollComplete(results);
        }
        // Hide the container after a short delay
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.classList.remove('active');
          }
        }, 2000);
      }
    });

    diceBox.initialize().then(() => {
      diceBoxRef.current = diceBox;
    }).catch(err => {
      console.error("DiceBox initialization failed:", err);
    });

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    roll: (notation) => {
      if (diceBoxRef.current) {
        containerRef.current.classList.add('active');
        return diceBoxRef.current.roll(notation);
      }
      return null;
    }
  }));

  return (
    <div id="dice-box-container" ref={containerRef} className="dice-roller-overlay"></div>
  );
});

export default DiceRoller;
