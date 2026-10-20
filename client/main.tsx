import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
