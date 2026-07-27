<div align="center">

# PollBot

### Encuestas en las que tu servidor realmente votará.

PollBot renderiza cada encuesta como una imagen nítida que se actualiza en vivo, no como un muro de texto en un embed. Selección múltiple, votos ponderados, resultados privados, votación restringida por roles, cierre automático programado y un panel web completo. Un solo comando y ya estás en vivo.

[**Añadir a Discord**](https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=534992383040&scope=applications.commands%20bot) ·
[**Dashboard**](https://pollbot.win) ·
[**Votar en Top.gg**](https://top.gg/bot/911731627498041374) ·
[**Soporte**](https://discord.gg/MYRqdNFQfk)

</div>

---

![Poll Example](https://i.imgur.com/hkZatLO.png)

*`/poll title: ¿Qué función te gustó más? items: Función 1, Función 2, Función 3 max_votes: 2` — esa es toda la configuración. La imagen se redibuja a medida que llegan los votos.*

## Todo lo que las encuestas integradas de Discord no pueden hacer

- **Resultados renderizados en imagen.** Las encuestas se dibujan como imágenes pulidas y se redibujan en vivo con cada voto; nada de embeds de texto plano.
- **Selección múltiple real.** Hasta 25 opciones con mínimos/máximos de selecciones por votante; "elige exactamente 3" está a un solo parámetro de distancia.
- **Votación ponderada.** Dale a los @Boosters 3 votos y a los @Members 1. Las ponderaciones se aplican en todas partes, incluidas las exportaciones.
- **Privado hasta el cierre.** Oculta el conteo actual para que nadie siga la corriente; los resultados se revelan cuando la encuesta cierra.
- **Cierre automático programado.** Establece una duración desde 1 hora hasta 7 días y la encuesta se cierra sola, puntualmente, incluso tras reinicios.
- **Hilos y discusión.** Adjunta automáticamente un hilo a cualquier encuesta para que el debate permanezca junto al voto.
- **Control delegado.** Un rol dedicado de "Poll Manager" permite que miembros de confianza gestionen encuestas sin necesidad de permisos de administrador.
- **Habla tu idioma.** Idioma por servidor mediante `/config locale`; inglés y español disponibles hoy.

## Gestiona todo desde el navegador

El panel en [pollbot.win](https://pollbot.win) ofrece un hogar para los administradores del servidor y los votantes:

- Resultados en vivo y listas completas de votantes.
- Crear, editar, duplicar, cerrar y reabrir encuestas de forma remota.
- Exportación a CSV de cualquier encuesta con un solo clic.
- "Mis Votos": tu historial de votaciones en todos los servidores.
- Analíticas de voto: tendencias de actividad, horas pico y principales votantes por servidor (premium — se desbloquea votando por el bot en Top.gg).

## En vivo en menos de diez segundos

1. **Crear** — `/poll title: Noche de cine items: Dune, Terror, Superhéroes` y listo.
2. **Votar** — los miembros eligen del menú debajo de la encuesta; la imagen se redibuja con cada voto.
3. **Cerrar y exportar** — cierra manualmente o por programación, revela los resultados finales y exporta el desglose completo a CSV.

![Stats Example](https://i.imgur.com/ncnJ1VT.png)

*`/stats` — salud y uso del bot, también renderizado como una imagen.*

---

## Comandos

| Comando | Descripción |
|---------|-------------|
| `/poll` | Crear una encuesta (ver opciones abajo) |
| `/view` | Resultados detallados y desglose de votantes (premium: desbloqueado votando en Top.gg) |
| `/export-poll` | Exportar los votos de una encuesta como CSV |
| `/close`, `/reopen` | Cerrar o reabrir una encuesta mediante el ID del mensaje |
| `/config` | Ajustes del servidor: `poll-buttons`, `locale`, `weights (set/remove/view/clear)` |
| `/stats` | Imagen de estadísticas del bot |
| `/pollmanager` | Gestionar el rol de Poll Manager |

Comandos de menú contextual (clic derecho): "View Data" y "Export Results" en cualquier mensaje de encuesta.

### Opciones de `/poll`

| Opción | Tipo | Requerido | Predeterminado | Descripción |
|--------|------|----------|---------|-------------|
| `title` | String | Sí | - | Título de la encuesta (máx. 256 caracteres) |
| `items` | String | Sí | - | Opciones separadas por comas, máx. 25 (ej. "Sí, No, Tal vez") |
| `description` | String | No | - | Contexto adicional; las menciones de usuario/rol se renderizan en la imagen |
| `max_votes` | Integer | No | 1 | Selecciones máximas por usuario |
| `min_votes` | Integer | No | 1 | Selecciones mínimas por usuario |
| `public` | Boolean | No | true | Si es falso, los conteos permanecen ocultos hasta que la encuesta cierre |
| `thread` | Boolean | No | false | Crear automáticamente un hilo de discusión |
| `allowed_role` | Role | No | - | Restringir la votación a un solo rol |
| `close_button` | Boolean | No | true | Añadir un botón de Cerrar Encuesta (sujeto a `/config poll-buttons`) |
| `allow_exports` | Boolean | No | true | Permitir que los miembros exporten los resultados de esta encuesta |
| `duration` | Choice | No | - | Cierre automático tras 1h, 6h, 12h, 24h, 48h, o 7 días |

## Primeros pasos (Auto-hospedaje)

Construido con TypeScript, discord.js y Playwright; los datos residen en Supabase (Postgres) y las encuestas son renderizadas por un servicio de renderizado de Chromium headless.

### Prerrequisitos

- Node.js 20 o superior (CI corre en 22)
- Un proyecto de Supabase (o un stack de Supabase local para desarrollo)
- Una aplicación de Discord con un token de bot

### Configuración

1. Instala las dependencias (el paso de postinstalación descarga la build de Chromium utilizada para el renderizado y compila el backend):

   ```bash
   npm install
   cd dashboard && npm install && cd ..
   ```

2. Configura el entorno:

   ```bash
   cp .env.example .env            # backend — ver comentarios en el archivo
   cp dashboard/.env.example dashboard/.env   # variables de tiempo de construcción del dashboard
   ```

   Variables importantes del backend: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_KEY` (clave service_role — mantener secreta), y para el login del dashboard `DISCORD_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT_URI`, `DISCORD_ADMIN_IDS`. Integraciones opcionales: Top.gg (`TOPGG_TOKEN`, `TOPGG_WEBHOOK_AUTH`) y tokens de túnel de cloudflared.

3. Configura la base de datos: ejecuta `schema.sql` en el editor SQL de Supabase en un proyecto nuevo. En una base de datos existente, aplica los archivos numerados en `supabase/migrations/` que no hayas ejecutado aún, en orden.

4. Registra los slash commands:

   ```bash
   npm run deploy
   ```

   Con `DEV_ONLY_MODE=true` y `DEV_GUILD_ID` configurado, los comandos se registran solo en tu servidor de prueba (instantáneo y seguro para iterar); de lo contrario, se registran globalmente.

5. Ejecutar:

   ```bash
   npm run dev      # desarrollo (ts-node)

   npm run build    # producción
   npm start
   ```

   El dashboard es servido por el propio bot desde `dashboard/dist`, así que constrúyelo una vez (`cd dashboard && npm run build`) o usa el servidor de desarrollo de Vite para hot reload (`cd dashboard && npm run dev`).

## Desarrollo

```bash
npm run typecheck   # tsc --noEmit (backend)
npm test            # vitest unit tests
npm run lint        # ESLint (advisory)
npm run build       # compilar + copiar locales en dist/
cd dashboard && npx tsc -b --noEmit && npm run build   # dashboard gates
```

El CI ejecuta el typecheck y tests del backend, además del typecheck y build del dashboard en cada pull request.

Prueba siempre contra un bot de desarrollo y un servidor de prueba (`DEV_ONLY_MODE=true`), nunca contra producción.

### Cambios en la base de datos

`schema.sql` es el esquema canónico. Cada cambio se envía como un nuevo archivo numerado en `supabase/migrations/` y se refleja en `schema.sql`; las migraciones se aplican manualmente en el editor SQL de Supabase (este proyecto no utiliza el historial de migraciones de la CLI de Supabase). Las funciones RPC que lean `users` o `votes` deben ejecutar `REVOKE ALL ... FROM PUBLIC` y otorgar permisos solo a los roles que los necesiten; la clave anónima del dashboard solo debe alcanzar resultados agregados.

## Despliegue

La instancia de producción se ejecuta como un servicio de systemd en Linux. Un despliegue consiste en:

```bash
git pull
npm ci && npm run build
cd dashboard && npm ci && npm run build && cd ..
npm run deploy      # solo cuando los slash commands cambien
# reiniciar el servicio
```

Establece `NODE_ENV=production` para que la cookie de sesión esté marcada como Secure. El dashboard y el webhook de Top.gg están expuestos a través de túneles de cloudflared configurados por las variables `*_CLOUDFLARED_TOKEN`.

## Licencia

MIT
