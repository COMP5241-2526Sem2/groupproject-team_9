import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log('Main.tsx is loading...');

const rootElement = document.getElementById('root');
if (rootElement) {
  console.log('Root element found, mounting app...');
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} else {
  console.error('Failed to find the root element');
}
