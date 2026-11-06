import React from 'react';
import { createRoot } from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './app/styles.css';
import App from './app/App';
import { LocalSession } from './session/local';
import { createRemote, joinRemote, remoteConfigured } from './session/remote';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App createLocal={p => new LocalSession(p)} createRemote={createRemote} joinRemote={joinRemote} remoteConfigured={remoteConfigured} /></React.StrictMode>);
