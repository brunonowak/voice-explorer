function Header({ user, onLogout }) {
  return (
    <header className="header">
      <h1>🎤 Voice Explorer</h1>
      <div className="header-right">
        {user && <span className="user-info">{user.display_name}</span>}
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}

export default Header;
