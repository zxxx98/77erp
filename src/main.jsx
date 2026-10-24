import { UiProvider } from './ui/provider.jsx';
import './styles.css';
import { App } from './app/App.jsx';
import { createRoot } from 'react-dom/client';
import { PwaProvider } from './pwa/Pwa.jsx';
import { AuthGate } from './Auth.jsx';

createRoot(document.getElementById("root")).render(
  <UiProvider><PwaProvider><AuthGate>{(admin, onLogout) => <App key={admin.id} admin={admin} onLogout={onLogout} />}</AuthGate></PwaProvider></UiProvider>,
);
