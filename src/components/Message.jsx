import ReactMarkdown from 'react-markdown';
import './Message.css';

export default function Message({ message, isOwnMessage, isDiceRolling }) {
  if (message.type === 'Hidden') return null;

  const { text, displayName, photoURL, isAi, characterName } = message;

  return (
    <div className={`message-wrapper ${isOwnMessage ? 'own-message' : ''} msg-wrapper-${(message.type || 'OutOfCharacter').toLowerCase()}`}>
      {!isOwnMessage && message.type !== 'Details' && (
        <div className={`msg-avatar ${isAi ? 'ai-avatar' : ''}`}>
          {photoURL ? (
            <img src={photoURL} alt="avatar" />
          ) : (
            <span>{isAi ? '⚡' : (displayName ? displayName[0].toUpperCase() : 'U')}</span>
          )}
        </div>
      )}
      
      <div className="message-content">
        {(characterName || !isOwnMessage) && message.type !== 'Details' && (
          <div className="msg-sender">
            <span className="name">
              {isAi ? 'AI Agent' : (characterName || displayName || 'Unknown')}
            </span>
            {isAi && <span className="ai-badge">AI</span>}
          </div>
        )}
        <div className={`msg-bubble ${isAi ? 'ai-bubble' : ''} msg-type-${(message.type || 'OutOfCharacter').toLowerCase()}`}>
          {isDiceRolling ? (
             message.type === 'Details' ? null : (
               <div className="dice-rolling-placeholder" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                  <span className="dice-icon">🎲</span> Rolling dice...
               </div>
             )
          ) : (
            <ReactMarkdown>{text}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
