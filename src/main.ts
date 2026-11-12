import './styles/tokens.css';
import './styles/app.css';
import { startApp } from './app';
import { installIcons } from './icons';
import { keepSoundsOffline } from './lib/offline';

installIcons();
startApp(document.getElementById('app')!);
keepSoundsOffline();
