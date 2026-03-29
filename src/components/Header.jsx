function Header({ user, onLogout, isDevMode, onToggleVerifier, showVerifier }) {
  return (
    <header className="header">
      <h1><a href={import.meta.env.BASE_URL} style={{ color: 'inherit', textDecoration: 'none' }}>🎤 Voice Explorer</a></h1>
      <div className="header-right">
        {isDevMode && (
          <button
            className={`dev-btn ${showVerifier ? 'active' : ''}`}
            onClick={onToggleVerifier}
          >🔍 Verify</button>
        )}
        {user && <span className="user-info">{user.display_name}</span>}
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}

export default Header;
