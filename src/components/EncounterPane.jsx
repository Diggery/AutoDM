import React from 'react';

export default function EncounterPane({ encounterState }) {
  const { combatants = [], currentTurnId, round = 1 } = encounterState;

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
            return (
              <div 
                key={c.id} 
                style={{
                  padding: '12px',
                  background: isCurrentTurn ? 'rgba(255, 60, 60, 0.15)' : 'rgba(0,0,0,0.2)',
                  border: isCurrentTurn ? '1px solid var(--danger)' : '1px solid transparent',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'all 0.2s ease'
                }}
              >
                <div>
                  <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isCurrentTurn && <span style={{ color: 'var(--danger)', fontSize: '18px' }}>▶</span>}
                    {c.name}
                  </span>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Type: {c.type === 'pc' ? 'Player' : 'NPC'}
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>
                  Init: {c.initiative}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
