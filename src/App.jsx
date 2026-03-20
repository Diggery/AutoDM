import { useState, useEffect, useRef } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import Auth from './components/Auth';
import Chat from './components/Chat';
import CharacterPane from './components/CharacterPane';
import DiceRoller from './components/DiceRoller';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCharacter, setActiveCharacter] = useState(null);
  const diceRollerRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="app-container" style={{ color: 'var(--text-secondary)' }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <div className="app-container">
        {user ? (
          <div className="main-layout" style={{ display: 'flex', width: '100%', height: '100%' }}>
            <CharacterPane 
              user={user} 
              onSelectCharacter={setActiveCharacter} 
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Chat 
                user={user} 
                activeCharacter={activeCharacter}
                onSignOut={() => signOut(auth)} 
                diceRollerRef={diceRollerRef}
              />
            </div>
          </div>
        ) : (
          <Auth />
        )}
      </div>
      <DiceRoller ref={diceRollerRef} onRollComplete={(results) => console.log("Roll results:", results)} />
    </>
  );
}

export default App;
