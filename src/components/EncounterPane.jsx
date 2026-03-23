import React from 'react';
import { nextTurn } from '../services/db';

export default function EncounterPane({ encounterState, campaignId }) {
  const { combatants = [], currentTurnId, round = 1 } = encounterState;

  const handleEndTurn = async () => {
    if (campaignId) {
      await nextTurn(campaignId);
    }
  };

  return (
    <div className="glass-panel" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
        <h2 style={{ margin: 0, color: 'var(--danger)' }}>Encounter Mode</h2>
        <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Round {round}</span>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
        {combatants.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No combatants in this encounter...</p>
        ) : (
          combatants.map((c, index) => {
            const isCurrentTurn = c.id === currentTurnId;
            const isPlayer = c.type === 'pc';
            if (isCurrentTurn) {
              console.log(`[EncounterPane] DEBUG: it is ${c.name}'s turn. hasActed: ${c.hasActed}. type: ${c.type}`);
            }

            
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                <div 
                  style={{
                    flexGrow: 1,
                    backgroundColor: isCurrentTurn ? 'rgba(255, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                    border: isCurrentTurn ? '1px solid var(--danger)' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '10px 15px',
                    color: isCurrentTurn ? 'white' : 'var(--text-secondary)',
                    fontWeight: isCurrentTurn ? 'bold' : 'normal',
                    boxShadow: isCurrentTurn ? '0 0 15px rgba(255, 68, 68, 0.2)' : 'none',
                    transition: 'all 0.3s ease',
                    cursor: 'default',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ opacity: 0.5 }}>{index + 1}.</span>
                    <span>{c.name}</span>
                    {isPlayer && <span style={{ fontSize: '0.75rem', opacity: 0.6, background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>PC</span>}
                  </div>
                  <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>
                    {c.initiative}
                  </div>
                </div>
                
                {isCurrentTurn && isPlayer && c.hasActed && (
                  <button 
                    onClick={handleEndTurn}
                    style={{ 
                      background: 'var(--danger)', 
                      color: 'white', 
                      padding: '10px 15px', 
                      borderRadius: '8px',
                      border: '2px solid white',
                      fontWeight: 'bold',
                      marginLeft: '12px',
                      cursor: 'pointer',
                      minWidth: '110px',
                      flexShrink: 0,
                      zIndex: 10
                    }}
                  >
                    END TURN
                  </button>
                )}




              </div>
            );

          })
        )}
      </div>
    </div>
  );
}
