import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './i18n';
import './styles.css';
import './components/master.css';
import './components/pairing.css';
import './components/player.css';
import './components/public-evidence.css';
import './arcade-shell.css';
import './components/arcade-display.css';
import './components/cinematics.css';
import './components/phone-captions.css';
import './components/recovery.css';
import './attention.css';
import './party-components.css';
import './components/stage-features.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><App /></LanguageProvider></React.StrictMode>);

import './components/developer.css';
