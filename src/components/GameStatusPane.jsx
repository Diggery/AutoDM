export default function GameStatusPane() {
  return (
    <div className="glass-panel" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '24px' }}>
      <h2 style={{ marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
        Game Status
      </h2>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          Select a character and use the chat to begin. The game status will update here as you play.
        </p>
        <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--primary)', marginBottom: '8px' }}>Current Location</h3>
          <p style={{ fontSize: '14px' }}>Unknown</p>
        </div>
        <div style={{ padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
          <h3 style={{ fontSize: '14px', color: 'var(--success)', marginBottom: '8px' }}>Active Quests</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>None</p>
        </div>
      </div>
    </div>
  );
}
