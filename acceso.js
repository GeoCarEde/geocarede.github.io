// Acceso con email + clave, vinculación al dispositivo y descarga de las ubicaciones.
(function () {
  const CFG = window.GEO_CONFIG || {};
  const $ = id => document.getElementById(id);
  const pantalla = $('acceso');

  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
    mostrar('entrar');
    aviso('La app todavía no está conectada a su servidor. Falta configurar config.js.', true);
    $('f-entrar').querySelector('button[type=submit]').disabled = true;
    return;
  }
  const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'geo-sesion' },
  });

  // ---------- identificador de este dispositivo ----------
  const DKEY = 'geo-dispositivo';
  function dispositivo() {
    let id = null;
    try { id = localStorage.getItem(DKEY); } catch (e) {}
    if (!id) { id = crypto.randomUUID(); try { localStorage.setItem(DKEY, id); } catch (e) {} }
    return id;
  }

  // ---------- copia local de las ubicaciones (para usar sin cobertura) ----------
  function idb(modo, fn) {
    return new Promise((ok, ko) => {
      const r = indexedDB.open('geo-car-ede', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => ko(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('kv', modo), st = tx.objectStore('kv');
        const q = fn(st);
        tx.oncomplete = () => ok(q && q.result);
        tx.onerror = () => ko(tx.error);
      };
    });
  }
  const guardarLocal = v => idb('readwrite', st => st.put(v, 'datos')).catch(() => {});
  const leerLocal = () => idb('readonly', st => st.get('datos')).catch(() => null);
  const borrarLocal = () => idb('readwrite', st => st.delete('datos')).catch(() => {});

  async function descomprimir(buf) {
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(s).text());
  }

  const MENSAJES = {
    sin_sesion: 'Tu sesión ha caducado. Vuelve a entrar.',
    sin_licencia: 'Este usuario no tiene licencia. Solicita acceso.',
    desactivada: 'Tu licencia está desactivada. Contacta con el administrador.',
    caducada: 'Tu licencia ha caducado. Contacta con el administrador para renovarla.',
    otro_dispositivo: 'Esta clave ya está en uso en otro dispositivo. Si has cambiado de móvil, pide al administrador que libere tu clave.',
    sin_datos: 'El servidor todavía no tiene ubicaciones cargadas. Inténtalo más tarde.',
    sin_dispositivo: 'No se pudo identificar este dispositivo. Revisa que el navegador permita guardar datos del sitio.',
  };

  let arrancada = false;
  function arrancar(datos) {
    pantalla.hidden = true;
    if (!arrancada) { arrancada = true; window.startApp(datos); }
  }

  // Pide las ubicaciones al servidor; si no hay conexión usa la copia local mientras no haya caducado.
  async function cargar(session) {
    aviso('Comprobando tu licencia…');
    let res;
    try {
      res = await fetch(CFG.supabaseUrl + '/functions/v1/datos', {
        headers: { Authorization: 'Bearer ' + session.access_token, apikey: CFG.supabaseAnonKey, 'x-device-id': dispositivo() },
        cache: 'no-store',
      });
    } catch (e) {
      const local = await leerLocal();
      const limite = (CFG.diasSinConexion || 7) * 864e5;
      if (local && local.user === session.user.id && Date.now() - local.validado < limite) {
        return arrancar(await descomprimir(local.gz));
      }
      mostrar('entrar');
      return aviso('Sin conexión. Conéctate a internet para comprobar tu licencia.', true);
    }
    if (res.ok) {
      const gz = await res.arrayBuffer();
      const datos = await descomprimir(gz);
      guardarLocal({ gz, validado: Date.now(), user: session.user.id });
      return arrancar(datos);
    }
    let codigo = 'error';
    try { codigo = (await res.json()).error; } catch (e) {}
    await borrarLocal();
    await sb.auth.signOut();
    mostrar('entrar');
    aviso(MENSAJES[codigo] || 'No se pudo comprobar tu licencia (' + res.status + '). Inténtalo de nuevo.', true);
  }

  // ---------- interfaz ----------
  function mostrar(vista) {
    pantalla.hidden = false;
    ['entrar', 'solicitar', 'enviada', 'clave'].forEach(v => { $('v-' + v).hidden = v !== vista; });
    $('pestanas').hidden = vista === 'clave';
    $('t-entrar').setAttribute('aria-selected', vista === 'entrar');
    $('t-solicitar').setAttribute('aria-selected', vista !== 'entrar');
    aviso('');
  }
  function aviso(txt, error) {
    const a = $('acceso-aviso');
    a.textContent = txt; a.hidden = !txt; a.classList.toggle('error', !!error);
  }
  $('t-entrar').onclick = () => mostrar('entrar');
  $('t-solicitar').onclick = () => mostrar('solicitar');
  $('otra-solicitud').onclick = () => mostrar('entrar');

  $('f-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('button[type=submit]');
    btn.disabled = true; aviso('Entrando…');
    const { data, error } = await sb.auth.signInWithPassword({ email: $('a-email').value.trim(), password: $('a-clave').value });
    btn.disabled = false;
    if (error) return aviso(/invalid/i.test(error.message) ? 'Email o clave incorrectos.' : 'No se pudo entrar: ' + error.message, true);
    $('a-clave').value = '';
    // Primera entrada con la clave automática: ofrecer elegir una contraseña propia
    if (data.user?.user_metadata?.clave_temporal) return pedirClave(data.session, true);
    cargar(data.session);
  });

  // ---------- cambio de contraseña ----------
  let trasCambio = null; // qué hacer al terminar (o al pulsar «Más tarde»)
  function pedirClave(session, primeraVez) {
    mostrar('clave');
    $('clave-intro').textContent = primeraVez
      ? 'Elige tu propia contraseña para sustituir la clave que te enviamos.'
      : 'Escribe tu contraseña nueva.';
    $('c-luego').textContent = primeraVez ? 'Más tarde' : 'Cancelar';
    trasCambio = session ? () => cargar(session) : () => { pantalla.hidden = true; };
    setTimeout(() => $('c-nueva').focus(), 50);
  }
  window.cambiarClave = () => pedirClave(null, false);
  $('c-luego').onclick = () => { $('f-clave').reset(); trasCambio && trasCambio(); };

  $('f-clave').addEventListener('submit', async e => {
    e.preventDefault();
    const nueva = $('c-nueva').value, repite = $('c-repite').value;
    if (nueva.length < 8) return aviso('La contraseña debe tener al menos 8 caracteres.', true);
    if (nueva !== repite) return aviso('Las dos contraseñas no coinciden.', true);
    const btn = e.submitter || e.target.querySelector('button[type=submit]');
    btn.disabled = true; aviso('Guardando…');
    const { error } = await sb.auth.updateUser({ password: nueva, data: { clave_temporal: false } });
    btn.disabled = false;
    if (error) {
      const msg = /different|same/i.test(error.message) ? 'La contraseña nueva tiene que ser distinta de la actual.'
        : /weak|short|characters/i.test(error.message) ? 'Esa contraseña es demasiado débil. Prueba con una más larga.'
        : /network|fetch/i.test(error.message) ? 'Sin conexión. Inténtalo cuando tengas cobertura.'
        : 'No se pudo cambiar: ' + error.message;
      return aviso(msg, true);
    }
    $('f-clave').reset();
    const seguir = trasCambio;
    if (seguir) seguir();
    toastAcceso('Contraseña cambiada. Úsala la próxima vez que entres.');
  });

  function toastAcceso(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 3200);
  }

  $('f-solicitar').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('button[type=submit]');
    btn.disabled = true; aviso('Enviando solicitud…');
    let r;
    try {
      r = await fetch(CFG.supabaseUrl + '/functions/v1/solicitud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey },
        body: JSON.stringify({ nombre: $('s-nombre').value, email: $('s-email').value, telefono: $('s-telefono').value, mensaje: $('s-mensaje').value, web: $('s-web').value }),
      });
    } catch (err) { btn.disabled = false; return aviso('Sin conexión. Inténtalo cuando tengas cobertura.', true); }
    btn.disabled = false;
    if (r.ok) {
      let tg = null; try { tg = (await r.json()).telegram; } catch (err) {}
      e.target.reset(); mostrar('enviada');
      $('tg-enlace').hidden = !tg;
      if (tg) $('tg-boton').href = tg;
      return;
    }
    let codigo = ''; try { codigo = (await r.json()).error; } catch (err) {}
    aviso({ email: 'Revisa el email.', telefono: 'Revisa el teléfono: pon al menos 9 cifras.', demasiadas: 'Ya has enviado varias solicitudes. Espera a que te contactemos.' }[codigo]
      || 'No se pudo enviar la solicitud. Inténtalo de nuevo.', true);
  });

  // Botón «Salir» del mapa
  window.cerrarSesion = async () => {
    await borrarLocal();
    await sb.auth.signOut();
    location.reload();
  };

  // ---------- inicio ----------
  sb.auth.getSession().then(({ data }) => {
    if (data.session) cargar(data.session);
    else mostrar('entrar');
  });
})();
