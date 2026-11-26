// Panel de administración: solicitudes, licencias y subida de ubicaciones.
(function () {
  const CFG = window.GEO_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = s => s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const hoy = () => new Date().toISOString().slice(0, 10);

  function aviso(txt, error) {
    const a = $('aviso'); a.textContent = txt || ''; a.hidden = !txt; a.classList.toggle('error', !!error);
  }
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) { aviso('Falta configurar config.js con los datos del proyecto de Supabase.', true); return; }

  const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'geo-admin' },
  });

  const ERRORES = {
    no_admin: 'Este usuario no es administrador.',
    sin_sesion: 'La sesión ha caducado. Vuelve a entrar.',
    ya_existe: 'Ya existe un usuario con ese email.',
    ya_resuelta: 'Esa solicitud ya estaba resuelta.',
    email: 'El email no es válido.',
  };

  async function llamar(body, binario) {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('sin_sesion');
    const r = await fetch(CFG.supabaseUrl + '/functions/v1/admin', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + data.session.access_token, apikey: CFG.supabaseAnonKey,
        'Content-Type': binario ? 'application/octet-stream' : 'application/json',
      },
      body: binario ? body : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  const fallo = e => aviso(ERRORES[e.message] || 'Error: ' + e.message, true);

  // ---------- sesión ----------
  $('f-login').addEventListener('submit', async e => {
    e.preventDefault();
    aviso('Entrando…');
    const { error } = await sb.auth.signInWithPassword({ email: $('l-email').value.trim(), password: $('l-clave').value });
    if (error) return aviso('Email o contraseña incorrectos.', true);
    $('l-clave').value = '';
    iniciar();
  });
  $('b-salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $('b-recargar').onclick = () => cargar().catch(fallo);

  async function iniciar() {
    try {
      const yo = await llamar({ accion: 'yo' });
      $('login').hidden = true; $('panel').hidden = false; aviso('');
      $('quien').textContent = yo.email;
      await cargar();
    } catch (e) {
      if (e.message === 'no_admin') await sb.auth.signOut();
      $('login').hidden = false; $('panel').hidden = true;
      if (e.message !== 'sin_sesion') fallo(e); else aviso('');
    }
  }

  // ---------- listado ----------
  async function cargar() {
    const d = await llamar({ accion: 'listar' });
    const pend = d.solicitudes.filter(s => s.estado === 'pendiente');
    $('n-pend').textContent = pend.length;
    $('pendientes').innerHTML = pend.length ? pend.map(s => `
      <div class="soli" data-id="${s.id}">
        <span class="nom">${esc(s.nombre || 'Sin nombre')}</span>
        <span class="dato">${esc(s.email)}</span>
        <span class="dato"><a href="tel:${esc(s.telefono.replace(/[^\d+]/g, ''))}">${esc(s.telefono)}</a></span>
        ${s.mensaje ? `<span class="msg">«${esc(s.mensaje)}»</span>` : ''}
        <span class="fecha">${fecha(s.creada_en)}</span>
        <div class="acc">
          <label>Caduca <input type="date" class="cad" min="${hoy()}"></label>
          <button class="btn prim" data-a="aprobar">Aprobar</button>
          <button class="btn peligro" data-a="rechazar">Rechazar</button>
        </div>
      </div>`).join('') : '<p class="vacio">No hay solicitudes pendientes.</p>';
    $('resueltas').innerHTML = d.solicitudes.filter(s => s.estado !== 'pendiente').map(s =>
      `<tr><td>${fecha(s.creada_en)}</td><td>${esc(s.nombre || '—')}</td><td>${esc(s.email)}</td><td>${esc(s.telefono)}</td><td><span class="pill ${s.estado === 'aprobada' ? 'ok' : 'no'}">${esc(s.estado)}</span></td></tr>`).join('');

    $('n-lic').textContent = d.licencias.length;
    $('licencias').innerHTML = d.licencias.length ? d.licencias.map(l => {
      const caducada = l.caduca && l.caduca < hoy();
      const estado = !l.activa ? '<span class="pill no">Desactivada</span>' : caducada ? '<span class="pill no">Caducada</span>' : '<span class="pill ok">Activa</span>';
      const disp = l.device_id
        ? `Vinculada ${fecha(l.vinculada_en)}<span class="sub">${esc(resumenUA(l.device_info))}</span>`
        : '<span class="pill neutro">Sin vincular</span>';
      return `<tr data-uid="${l.user_id}">
        <td><strong>${esc(l.nombre || '—')}</strong><span class="sub">${esc(l.email)}</span><span class="sub">${esc(l.telefono || '')}</span></td>
        <td>${estado}</td>
        <td>${disp}</td>
        <td>${fecha(l.ultimo_acceso)}</td>
        <td><input type="date" class="cad" value="${l.caduca || ''}" aria-label="Fecha de caducidad"></td>
        <td class="acc">
          ${l.device_id ? '<button class="btn" data-a="liberar" title="Para cuando el usuario cambia de móvil">Liberar dispositivo</button>' : ''}
          <button class="btn" data-a="activar">${l.activa ? 'Desactivar' : 'Activar'}</button>
          <button class="btn" data-a="nueva_clave">Nueva clave</button>
          <button class="btn peligro" data-a="eliminar">Eliminar</button>
        </td></tr>`;
    }).join('') : '<tr><td colspan="6" class="vacio">Todavía no hay licencias.</td></tr>';
    $('licencias').dataset.json = JSON.stringify(d.licencias.map(l => [l.user_id, l.activa, l.email]));

    $('datos-fecha').textContent = d.datos ? 'Ubicaciones publicadas por última vez: ' + fecha(d.datos) : 'Todavía no se han publicado ubicaciones: la app no funcionará hasta que lo hagas.';
  }

  function resumenUA(ua) {
    if (!ua) return '';
    const so = /Android [\d.]+/.exec(ua)?.[0] || (/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : '');
    const nav = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
    return [so, nav].filter(Boolean).join(' · ') || ua.slice(0, 60);
  }

  // ---------- clave recién generada ----------
  function mostrarClave(r, titulo) {
    const tel = (r.telefono || '').replace(/\D/g, '');
    const telInt = tel.length === 9 ? '34' + tel : tel;
    const appUrl = location.origin + location.pathname.replace(/admin\/.*$/, '');
    const msg = `Tu acceso a CCTT Granada:\nEmail: ${r.email}\nClave: ${r.clave}\n\nAbre ${appUrl} e inicia sesión. La clave queda vinculada al primer dispositivo en el que entres.`;
    const caja = $('clave-nueva');
    caja.innerHTML = `
      <strong>${esc(titulo)}</strong>
      <span>${esc(r.email)}</span>
      <span class="clave" id="clave-txt">${esc(r.clave)}</span>
      <span class="vacio">Esta clave solo se muestra ahora. Envíasela al usuario.</span>
      <div class="acc">
        <button class="btn prim" id="c-copiar" type="button">Copiar mensaje</button>
        ${telInt ? `<a class="btn" href="https://wa.me/${telInt}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}
        <a class="btn" href="https://t.me/share/url?url=${encodeURIComponent(appUrl)}&text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Enviar por Telegram</a>
        <button class="btn" id="c-cerrar" type="button">Cerrar</button>
      </div>`;
    caja.hidden = false; caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('c-cerrar').onclick = () => { caja.hidden = true; caja.innerHTML = ''; };
    $('c-copiar').onclick = () => navigator.clipboard.writeText(msg).then(() => aviso('Mensaje copiado.'), () => aviso('No se pudo copiar: selecciona la clave a mano.', true));
  }

  // ---------- acciones ----------
  $('pendientes').addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const card = b.closest('.soli'), id = +card.dataset.id;
    b.disabled = true;
    try {
      if (b.dataset.a === 'aprobar') {
        const r = await llamar({ accion: 'aprobar', solicitud_id: id, caduca: card.querySelector('.cad').value || null });
        mostrarClave(r, 'Solicitud aprobada');
      } else {
        if (!confirm('¿Rechazar esta solicitud?')) { b.disabled = false; return; }
        await llamar({ accion: 'rechazar', solicitud_id: id });
      }
      await cargar();
    } catch (err) { fallo(err); b.disabled = false; }
  });

  $('licencias').addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const uid = b.closest('tr').dataset.uid;
    const lic = JSON.parse($('licencias').dataset.json).find(x => x[0] === uid) || [];
    const a = b.dataset.a;
    const preguntas = {
      liberar: '¿Liberar el dispositivo? El usuario podrá entrar desde un dispositivo nuevo, y el anterior dejará de funcionar.',
      nueva_clave: '¿Generar una clave nueva? La actual dejará de servir para iniciar sesión.',
      eliminar: `¿Eliminar a ${lic[2]}? Se borra su usuario y su licencia, y no se puede deshacer.`,
    };
    if (preguntas[a] && !confirm(preguntas[a])) return;
    b.disabled = true;
    try {
      if (a === 'activar') await llamar({ accion: 'activar', user_id: uid, activa: !lic[1] });
      else if (a === 'nueva_clave') { const r = await llamar({ accion: 'nueva_clave', user_id: uid }); mostrarClave({ ...r, email: lic[2] }, 'Clave nueva'); }
      else await llamar({ accion: a, user_id: uid });
      await cargar();
    } catch (err) { fallo(err); b.disabled = false; }
  });

  $('licencias').addEventListener('change', async e => {
    if (!e.target.classList.contains('cad')) return;
    const uid = e.target.closest('tr').dataset.uid;
    try { await llamar({ accion: 'caducidad', user_id: uid, caduca: e.target.value || null }); aviso('Caducidad guardada.'); await cargar(); }
    catch (err) { fallo(err); }
  });

  $('f-alta').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await llamar({ accion: 'crear', email: $('m-email').value, nombre: $('m-nombre').value, telefono: $('m-tel').value, caduca: $('m-caduca').value || null });
      mostrarClave({ ...r, telefono: $('m-tel').value }, 'Usuario creado');
      e.target.reset(); await cargar();
    } catch (err) { fallo(err); }
  });

  // ---------- ubicaciones ----------
  const NOMBRES = { endesa: 'CT Endesa', ext: 'CT externos', ddmm: 'Maniobra', apoyo: 'Apoyos MT' };
  let preparado = null;
  $('f-datos').addEventListener('submit', async e => {
    e.preventDefault();
    const files = [...$('d-kmz').files];
    $('b-publicar').hidden = true; $('d-capas').innerHTML = ''; preparado = null;
    $('b-leer').disabled = true; aviso('Leyendo archivos…');
    try {
      const capas = {};
      for (const f of files) {
        let texto;
        if (/\.kml$/i.test(f.name)) texto = await f.text();
        else {
          const zip = await JSZip.loadAsync(f);
          const kml = Object.values(zip.files).find(z => /\.kml$/i.test(z.name));
          if (!kml) throw new Error(f.name + ' no contiene ningún KML');
          texto = await kml.async('string');
        }
        Object.assign(capas, KMZ.leerKml(texto));
      }
      const faltan = Object.keys(NOMBRES).filter(k => !capas[k]);
      $('d-capas').innerHTML = Object.keys(NOMBRES).map(k => capas[k]
        ? `<span class="pill ok">${NOMBRES[k]}: ${String(capas[k].length).replace(/\B(?=(\d{3})+$)/g, '.')}</span>`
        : `<span class="pill no">${NOMBRES[k]}: no encontrada</span>`).join('');
      if (!Object.keys(capas).length) throw new Error('No se ha encontrado ninguna capa conocida en esos archivos');
      preparado = KMZ.aDatos(capas);
      $('b-publicar').hidden = false;
      aviso(faltan.length ? 'Atención: si publicas así, la app se quedará sin ' + faltan.map(k => NOMBRES[k]).join(', ') + '. Sube todos los KMZ a la vez.' : 'Archivos leídos. Revisa los números y publica.', !!faltan.length);
    } catch (err) { aviso('No se pudieron leer los archivos: ' + err.message, true); }
    $('b-leer').disabled = false;
  });

  $('b-publicar').addEventListener('click', async e => {
    if (!preparado) return;
    e.target.disabled = true; aviso('Comprimiendo y subiendo…');
    try {
      const gz = await new Response(new Blob([JSON.stringify(preparado)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      const r = await llamar(gz, true);
      aviso('Ubicaciones publicadas (' + Math.round(r.bytes / 1024) + ' KB). Los usuarios las recibirán la próxima vez que abran la app.');
      $('b-publicar').hidden = true; preparado = null;
      await cargar();
    } catch (err) { fallo(err); }
    e.target.disabled = false;
  });

  // ---------- inicio ----------
  sb.auth.getSession().then(({ data }) => data.session ? iniciar() : ($('login').hidden = false));
})();
