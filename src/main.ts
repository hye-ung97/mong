import './styles/tokens.css';
import './styles/app.css';
import { startApp } from './app';
import { installIcons } from './icons';

installIcons();
startApp(document.getElementById('app')!);
