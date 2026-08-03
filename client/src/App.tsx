import { Navigate, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home.js';
import { RoomPage } from './pages/RoomPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { AdminHome } from './pages/AdminHome.js';
import { ProjectionPage } from './pages/ProjectionPage.js';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/r/:code" element={<RoomPage />} />
      <Route path="/p/:code" element={<ProjectionPage />} />
      <Route path="/admin" element={<AdminHome />} />
      <Route path="/admin/:code" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
