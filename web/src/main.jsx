import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { isNative } from './native.js'
createRoot(document.getElementById('root')).render(<App />)
// the installed app already has its files on the phone; the service worker is only for the website
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) navigator.serviceWorker.register('./sw.js').catch(() => {})
