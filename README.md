# OctopadelApp

Cuadrantes de pádel americano para 8, 12 o 16 jugadores, con resultados **en tiempo real**: quien tenga el enlace del torneo ve los resultados al instante y puede apuntarlos. Pensada para el móvil.

- Cada partido se juega a **3 juegos** (3-0 o 2-1; la suma no puede pasar de 3). Cada jugador suma los juegos de su pareja.
- Botón «Exportar PDF para las pistas»: una hoja por pista con sus partidos y cuadros para anotar, más una hoja «¿En qué pista juego?».
- Quien crea el torneo es el organizador (solo él puede borrar resultados o el torneo). El resto puede ver y apuntar resultados.
- Los torneos con más de 30 días se borran solos.

## Estructura
- `public/`: la app (HTML, sin compilar).
- `server.js`: servidor sin framework: estáticos + API + actualizaciones en directo (SSE).
- `store.js`: datos en **Postgres** si existe `DATABASE_URL`; si no, en memoria (solo para pruebas locales).

## Probar en local
```
npm install
npm start        # http://localhost:3000  (datos en memoria, se pierden al parar)
```

## Desplegar en Railway
1. Sube esta carpeta a un repositorio de GitHub (o usa `railway up` con la CLI).
2. En railway.com: **New Project → Deploy from GitHub repo**.
3. En el mismo proyecto: **New → Database → Add PostgreSQL**.
4. En el servicio de la app → **Variables** → **New Variable** → *Add Reference* → `DATABASE_URL` del servicio Postgres.
5. **Settings → Networking → Generate Domain**.

Las tablas se crean solas al arrancar. Si ves en los logs `(datos: postgres)`, todo está bien; si pone `(datos: memory)` falta enlazar `DATABASE_URL`.

## API (por si hace falta)
`POST /api/t` · `GET /api/t/:id` · `PUT /api/t/:id/results/:ronda_pista` · `GET /api/t/:id/events` (SSE) · `DELETE /api/t/:id[/results]` (cabecera `x-owner`).
