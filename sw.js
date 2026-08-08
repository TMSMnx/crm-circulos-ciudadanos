const CACHE_NAME = 'crm-circulos-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './js/main.js',
  './js/circles-manager.js',
  './js/admin-manager.js',
  './js/pdf-engine.js',
  './js/api-service.js',
  './js/config.js',
  './js/utils.js',
  './js/auth.js',
  './js/events-manager.js',
  './js/ocr-engine.js',
  './img/circulos.jpg',
  './img/mc.jpeg',
  './img/default-avatar.png',
  // Librerías externas (CDN) - El SW intentará cachearlas también
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// 1. Instalación: Guardar archivos en caché
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Activación: Limpiar cachés viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
});

// 3. Interceptar peticiones: Servir desde Caché si no hay red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Si está en caché, lo devuelve. Si no, intenta internet.
      return response || fetch(event.request);
    }).catch(() => {
      // Si falla todo (sin internet y no caché), no hacemos nada (o mostrar página error)
    })
  );
});