import { useState, useRef, useEffect } from 'react';

export default function ResizableLayout({ leftPanel, centerPanel, rightPanel }) {
  // We keep final widths in React state
  const [leftWidth, setLeftWidth] = useState(25); 
  const [rightWidth, setRightWidth] = useState(25);
  
  // We also keep a simple bit of state to style the active drag handle
  const [activeHandle, setActiveHandle] = useState(null); 

  const containerRef = useRef(null);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const dragState = useRef(null);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragState.current || !containerRef.current) return;
      
      // Use requestAnimationFrame for maximum smoothness synced to monitor refresh rate
      requestAnimationFrame(() => {
        if (!dragState.current || !containerRef.current) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const containerWidth = rect.width;
        const { panel, startX, startWidth } = dragState.current;
        
        if (panel === 'left') {
          const deltaX = e.clientX - startX;
          const minPercent = (480 / containerWidth) * 100;
          let newWidth = startWidth + (deltaX / containerWidth) * 100;
          if (newWidth < minPercent) newWidth = minPercent;
          if (newWidth > 100 - rightWidth - minPercent) newWidth = 100 - rightWidth - minPercent;
          
          // Modify DOM directly to bypass React render cycle! Super smooth.
          if (leftPanelRef.current) {
            leftPanelRef.current.style.width = `${newWidth}%`;
          }
          dragState.current.currentWidth = newWidth;
          
        } else if (panel === 'right') {
          const deltaX = startX - e.clientX;
          const minPercent = (480 / containerWidth) * 100;
          let newWidth = startWidth + (deltaX / containerWidth) * 100;
          if (newWidth < minPercent) newWidth = minPercent;
          if (newWidth > 100 - leftWidth - minPercent) newWidth = 100 - leftWidth - minPercent;
          
          if (rightPanelRef.current) {
            rightPanelRef.current.style.width = `${newWidth}%`;
          }
          dragState.current.currentWidth = newWidth;
        }
      });
    };
    
    const handleMouseUp = () => {
      if (!dragState.current) return;
      
      // Save the final width back into React states
      const { panel, currentWidth } = dragState.current;
      if (panel === 'left') setLeftWidth(currentWidth);
      if (panel === 'right') setRightWidth(currentWidth);
      
      dragState.current = null;
      setActiveHandle(null);
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftWidth, rightWidth]);

  const startDrag = (panel, e) => {
    e.preventDefault();
    document.body.style.userSelect = 'none';
    setActiveHandle(panel);
    dragState.current = {
      panel,
      startX: e.clientX,
      startWidth: panel === 'left' ? leftWidth : rightWidth,
      currentWidth: panel === 'left' ? leftWidth : rightWidth,
    };
  };

  return (
    <div ref={containerRef} style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={leftPanelRef} style={{ width: `${leftWidth}%`, height: '100%', minWidth: '480px', willChange: 'width' }}>
        {leftPanel}
      </div>
      
      <div 
        className="resize-handle" 
        onMouseDown={(e) => startDrag('left', e)}
        data-panel-resize-handle-state={activeHandle === 'left' ? 'drag' : ''}
      />
      
      <div style={{ flex: 1, minWidth: '480px', height: '100%' }}>
        {centerPanel}
      </div>

      <div 
        className="resize-handle" 
        onMouseDown={(e) => startDrag('right', e)}
        data-panel-resize-handle-state={activeHandle === 'right' ? 'drag' : ''}
      />
      
      <div ref={rightPanelRef} style={{ width: `${rightWidth}%`, height: '100%', minWidth: '480px', willChange: 'width' }}>
        {rightPanel}
      </div>
    </div>
  );
}
