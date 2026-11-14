# OctopadelApp

Cuadrantes de pádel americano para 8, 12 o 16 jugadores, con resultados **en tiempo real**: quien tenga el enlace del torneo ve los resultados al instante y puede apuntarlos. Pensada para el móvil.

- Cada partido se juega a **3 juegos** (3-0 o 2-1; la suma no puede pasar de 3). Cada jugador suma los juegos de su pareja.
- Botón «Exportar PDF para las pistas»: una hoja por pista con sus partidos y cuadros para anotar, más una hoja «¿En qué pista juego?».
- **Acceso:** solo el organizador (login) puede crear torneos, apuntar resultados y borrar. El enlace de un torneo es de **solo lectura**: quien lo abre ve todo en directo pero no puede editar.
- Usuario y contraseña por defecto en `server.js` (`regue` / `Dar3ga`). Para cambiarlos sin tocar el código, crea en Railway las variables `ADMIN_USER` y `ADMIN_PASS` (y sustituye los valores por defecto del código). Tras 8 intentos fallidos el acceso se bloquea 10 minutos.
- **Histórico:** los torneos se guardan para siempre (solo los borradores sin cuadrante de más de 7 días se limpian solos). La pantalla de inicio muestra la lista con fecha, lugar y campeón; cualquiera puede consultarla. Flujo del organizador: Nuevo torneo (nombre, fecha, lugar) → jugadores y cuadrante → apuntar resultados → Finalizar (queda el podio; se puede reabrir).
- **Torneos anteriores:** se crean igual, con su fecha real; se genera el cuadrante, se cargan los resultados y se finaliza.

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
`GET /api/t` (histórico) · `POST /api/t` (nuevo) · `PUT /api/t/:id/setup|info` · `POST /api/t/:id/finish|reopen` · `GET /api/t/:id` · `PUT /api/t/:id/results/:ronda_pista` · `GET /api/t/:id/events` (SSE) · `DELETE /api/t/:id[/results]` (cabecera `Authorization: Bearer <token>`; las escrituras exigen el login del organizador: `POST /api/login`).
