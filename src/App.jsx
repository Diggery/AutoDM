import { useState, useEffect, useRef } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import Auth from './components/Auth';
import Chat from './components/Chat';
import DiceRoller from './components/DiceRoller';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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
          <Chat 
            user={user} 
            onSignOut={() => signOut(auth)} 
            diceRollerRef={diceRollerRef}
          />
        ) : (
          <Auth />
        )}
      </div>
      <DiceRoller ref={diceRollerRef} onRollComplete={(results) => console.log("Roll results:", results)} />
    </>
  );
}

export default App;
