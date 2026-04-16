import { NavLink } from 'react-router-dom'

/**
 * Small persistent nav so exhibitors can jump between upload, wall, and QR.
 */
export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Site">
      <NavLink to="/" className="site-nav-link" end>
        Upload
      </NavLink>
      <NavLink to="/wall" className="site-nav-link">
        Wall
      </NavLink>
      <NavLink to="/qr" className="site-nav-link">
        QR
      </NavLink>
    </nav>
  )
}
