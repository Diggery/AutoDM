import './Message.css';

export default function Message({ message, isOwnMessage }) {
  const { text, displayName, photoURL, isAi } = message;

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
        {!isOwnMessage && message.type !== 'Details' && (
          <div className="msg-sender">
            <span className="name">{isAi ? 'AI Agent' : (displayName || 'Unknown')}</span>
            {isAi && <span className="ai-badge">AI</span>}
          </div>
        )}
        <div className={`msg-bubble ${isAi ? 'ai-bubble' : ''} msg-type-${(message.type || 'OutOfCharacter').toLowerCase()}`}>
          {text}
        </div>
      </div>
    </div>
  );
}
