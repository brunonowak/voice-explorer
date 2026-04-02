function Header({ user, onLogout, isAdmin, platform }) {
  return (
    <header className="header">
      <h1><a href={import.meta.env.BASE_URL} style={{ color: 'inherit', textDecoration: 'none' }}>🎤 Coach Playlist Generator</a></h1>
      <div className="header-right">
        {isAdmin && <span className="admin-badge">🔐 Admin</span>}
        {platform && <span className="platform-badge">{platform === 'youtube' ? '▶️ YouTube' : '🟢 Spotify'}</span>}
        {user && <span className="user-info">{user.display_name}</span>}
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}

export default Header;
