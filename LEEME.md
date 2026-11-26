# CCTT Granada

Dirección de la app: **https://geocarede.github.io/** · Panel: **https://geocarede.github.io/admin/**

App web instalable para localizar centros de transformación, elementos de maniobra y apoyos de MT, y navegar hasta ellos.
El acceso es con email y clave. **Cada clave funciona en un solo dispositivo.**

## Cómo funciona

| Pieza | Dónde está | Qué hace |
|---|---|---|
| App (`index.html`, `app.js`, `acceso.js`…) | GitHub Pages | Mapa, buscador y pantalla de acceso. **No contiene ubicaciones.** |
| Panel (`admin/`) | GitHub Pages, en `/admin/` | Aprobar solicitudes, gestionar licencias, subir los KMZ |
| Base de datos y funciones (`supabase/`) | Supabase | Usuarios, licencias, solicitudes y el archivo de ubicaciones |

- Solo se publican el **código y la posición** de cada elemento. El panel lee los KMZ en tu ordenador y no sube nada más.
- **Vinculación al dispositivo:** la primera vez que alguien entra, la app crea un identificador para ese dispositivo y el servidor lo guarda. Desde otro dispositivo, esa clave se rechaza.
- **Sin cobertura:** la app sigue funcionando hasta 7 días desde la última comprobación de la licencia. Se cambia en `config.js`.

### Límites que hay que conocer

- Un navegador no puede leer un identificador real del teléfono. Si el usuario **borra los datos del navegador o reinstala la app**, el sistema lo ve como un dispositivo nuevo y lo rechaza. Para arreglarlo, pulsa **Liberar dispositivo** en el panel.
- Alguien con conocimientos técnicos podría copiar las ubicaciones una vez descargadas en su dispositivo. Se puede dificultar, pero no impedir del todo.

## Flujo de alta

1. El usuario rellena **Solicitar acceso** en la app con su nombre, email y teléfono.
2. Te llega un **aviso por Telegram** con los botones **✅ Aprobar** y **❌ Rechazar**.
3. Pulsas **Aprobar** en Telegram, o en el panel. Se genera una clave y el bot te la envía con botones para reenviársela al usuario por WhatsApp o Telegram. Las solicitudes aprobadas desde Telegram no tienen caducidad; si quieres ponerle una, hazlo después en el panel.
4. El usuario entra con su email y su clave. Ese dispositivo queda vinculado.

## Mensaje de pago y conversación por Telegram

- Al enviar la solicitud, la app ofrece **«Recibir respuesta por Telegram»**. Si el usuario lo pulsa y le da a «Iniciar», su Telegram queda conectado con el bot.
- En el aviso de cada solicitud tienes el botón **💳 Enviar mensaje de pago**. El texto lo escribes en el panel, en la sección **Mensaje de pago**, y puedes usar `{nombre}`.
  - Si el usuario conectó su Telegram, el bot se lo envía directamente.
  - Si no, el bot te prepara el mensaje con botones para mandarlo por WhatsApp o abrir su Telegram por número.
- Lo que el usuario escriba al bot (texto, fotos del justificante…) te llega a tu chat. **Si respondes con «Responder» a uno de esos mensajes, la respuesta le llega a él.**
- Al aprobar (en Telegram o en el panel), si el usuario conectó su Telegram, el bot le envía la clave directamente.
- Un bot de Telegram no puede escribir a alguien que no le haya escrito antes. Por eso hace falta que el usuario pulse el enlace.

## Panel: acciones sobre cada licencia

- **Liberar dispositivo:** para cuando el usuario cambia de móvil o borra los datos del navegador.
- **Desactivar / Activar:** corta o devuelve el acceso. Si se desactiva, en cuanto el usuario abra la app con conexión pierde el acceso y se borra la copia local.
- **Caduca:** fecha a partir de la cual deja de funcionar (para suscripciones).
- **Nueva clave**, **Eliminar**.

## Actualizar las ubicaciones

En el panel, sección **Ubicaciones**:
1. Elige **los tres KMZ a la vez**.
2. Pulsa **Leer archivos** y revisa los números.
3. Pulsa **Publicar**.

Los usuarios reciben los datos nuevos la próxima vez que abren la app.

## Puesta en marcha (una sola vez)

1. **Supabase:** crear el proyecto, aplicar `supabase/migrations/0001_licencias.sql` y desplegar las funciones `datos`, `admin` y `solicitud`.
2. **`config.js`:** poner la URL del proyecto y la *anon key* (Settings → API).
3. **Administrador:** en Supabase, *Authentication → Users → Add user* (con email y contraseña). Después ejecuta en el *SQL Editor*:
   `insert into public.admins (user_id) select id from auth.users where email = 'TU_EMAIL';`
4. **Desactivar el registro libre:** *Authentication → Sign In / Providers → Allow new users to sign up* → desactivado. Las altas solo se hacen desde el panel.
5. **Telegram:**
   1. Habla con **@BotFather**, crea un bot (`/newbot`) y copia el token.
   2. Escribe cualquier cosa a tu bot.
   3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia `chat.id`.
   4. En Supabase, *Edge Functions → Secrets*, crea `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y, si quieres, `ADMIN_URL` (la dirección del panel).
   5. Para activar los botones, abre una vez `https://<proyecto>.supabase.co/functions/v1/telegram?accion=configurar`. **Si cambias el token del bot, vuelve a abrir esa dirección.**
6. **(Opcional)** Crea el secreto `ORIGENES_PERMITIDOS` con `https://geocarede.github.io` para que solo tu app pueda llamar a las funciones.
7. Entra en el panel y **publica las ubicaciones** subiendo los KMZ.

## Instalar la app en el móvil

- **Android (Chrome):** pulsa ⋮ y luego «Instalar aplicación».
- **iPhone (Safari):** pulsa Compartir y luego «Añadir a pantalla de inicio».
