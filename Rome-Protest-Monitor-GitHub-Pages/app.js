/* Rome Protest Monitor: public-location, source-led operations view. No user tracking. */
(() => {
  'use strict';
  const DATA = window.ROME_MONITOR_DATA || { events: [], discovery: [], scan: { status: 'not_run' } };
  const events = Array.isArray(DATA.events) ? DATA.events.filter(e => e && e.id && e.date && Array.isArray(e.point) && e.point.length === 2) : [];
  const discovery = Array.isArray(DATA.discovery) ? DATA.discovery : [];
  const scan = DATA.scan || { status: 'not_run' };
  const EL = id => document.getElementById(id);
  const AREA = { south: 41.875, north: 41.953, west: 12.438, east: 12.541 };
  const ROME = 'Europe/Rome';
  const WATCH_STORAGE = 'rome_monitor_watchpoints_v1';
  const state = { view: 'overview', time: '7d', impact: 'all', query: '', showEvents: true, showWatch: true, showRoutes: true,
    watchpoints: loadWatchpoints(), map: null, layers: null, mapReady: false, selected: null };
  let toastTimer = null;

  function text(value) { return String(value == null ? '' : value); }
  function escapeHtml(value) { return text(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function validHttpsUrl(raw) {
    try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
  }
  function icon(name) { return `<svg class="icon" aria-hidden="true"><use href="#ic-${name}"></use></svg>`; }
  function romeDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: ROME, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
    const by = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${by.year}-${by.month}-${by.day}`;
  }
  function romeTime(date = new Date()) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: ROME, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date);
  }
  function formatDate(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return text(day);
    return new Intl.DateTimeFormat('en-GB', { timeZone:'UTC', day:'2-digit', month:'short', year:'numeric' }).format(new Date(`${day}T12:00:00Z`)).toUpperCase();
  }
  function formatChecked(iso) {
    if (!iso || Number.isNaN(new Date(iso).getTime())) return 'Not yet checked';
    return new Intl.DateTimeFormat('en-GB', { timeZone: ROME, dateStyle:'medium', timeStyle:'short' }).format(new Date(iso)) + ' Rome';
  }
  function timeStatus(event, now = new Date()) {
    const start = event.start ? new Date(event.start) : null;
    const end = event.end ? new Date(event.end) : null;
    if (end && !Number.isNaN(end.getTime()) && now >= end) return 'ended';
    if (start && !Number.isNaN(start.getTime()) && now < start) return 'scheduled';
    if (start && end && now >= start && now < end) return 'window';
    if (event.date < romeDay(now)) return 'ended';
    if (event.date > romeDay(now)) return 'scheduled';
    return 'unspecified';
  }
  function statusLabel(status) {
    return ({ ended:'Elapsed', scheduled:'Announced', window:'In published window', unspecified:'Time not published' })[status] || 'Announced';
  }
  function daysFromNow(n, now = new Date()) { return romeDay(new Date(now.getTime() + n * 24*60*60*1000)); }
  function isWithinTimeFilter(e, now = new Date()) {
    const s = timeStatus(e, now);
    if (state.time === 'all') return true;
    if (state.time === 'archive') return s === 'ended';
    if (s === 'ended') return false;
    if (state.time === '7d') return e.date <= daysFromNow(7, now);
    if (state.time === '24h') {
      if (e.start) return new Date(e.start).getTime() <= now.getTime() + 24*60*60*1000;
      // Event time is unknown: include when event *date* overlaps the time period.
      return e.date <= daysFromNow(1, now);
    }
    return true;
  }
  function visibleEvents() {
    const now = new Date(); const q = state.query.trim().toLowerCase();
    return events.filter(e => isWithinTimeFilter(e, now) &&
      (state.impact === 'all' || e.impact === state.impact) &&
      (!q || [e.title, e.type, e.area, e.location, e.operational_effect, (e.transit_lines || []).join(' '), (e.route_streets || []).join(' ')].join(' ').toLowerCase().includes(q)))
      .sort((a,b) => {
        const sa = timeStatus(a,now), sb = timeStatus(b,now);
        const aa = sa === 'ended' ? 1 : 0, bb = sb === 'ended' ? 1 : 0;
        if (aa !== bb) return aa - bb;
        return (a.start || a.date).localeCompare(b.start || b.date);
      });
  }
  function loadWatchpoints() {
    try {
      const data = JSON.parse(localStorage.getItem(WATCH_STORAGE) || '[]');
      return Array.isArray(data) ? data.filter(w => isValidWatchpoint(w)).slice(0, 50) : [];
    } catch { return []; }
  }
  function isValidWatchpoint(w) {
    return Boolean(w && typeof w.name === 'string' && w.name.length <= 72 && Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lng)) &&
      Number(w.lat) >= -90 && Number(w.lat) <= 90 && Number(w.lng) >= -180 && Number(w.lng) <= 180 && Number(w.radius) > 0 && Number(w.radius) <= 10);
  }
  function saveWatchpoints() {
    try { localStorage.setItem(WATCH_STORAGE, JSON.stringify(state.watchpoints)); return true; }
    catch { toast('Browser storage unavailable: location was not saved.'); return false; }
  }
  function distanceKm(a,b) {
    const R=6371, toRad=x => x * Math.PI/180;
    const dLat=toRad(Number(b[0])-Number(a[0])), dLng=toRad(Number(b[1])-Number(a[1]));
    const v = Math.sin(dLat/2)**2 + Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLng/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(v),Math.sqrt(1-v));
  }
  function fmtDistance(distance) { return distance < 1 ? `${Math.round(distance*1000)} m` : `${distance.toFixed(1)} km`; }
  function toast(message) {
    const el=EL('toast'); el.textContent=message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer=setTimeout(() => el.classList.remove('visible'), 3200);
  }

  function updateClock() {
    EL('rome-clock').textContent=romeTime();
  }
  function updateKPIs() {
    const now=new Date();
    const upcoming=events.filter(e => ['scheduled','unspecified'].includes(timeStatus(e,now)) && e.date<=daysFromNow(7,now));
    const inWindow=events.filter(e => timeStatus(e,now)==='window');
    const high=events.filter(e => (timeStatus(e,now)!=='ended') && e.impact==='high' && e.date<=daysFromNow(7,now));
    EL('kpi-upcoming').textContent=upcoming.length;
    EL('kpi-inwindow').textContent=inWindow.length;
    EL('kpi-impact').textContent=high.length;
    EL('kpi-discovery').textContent=discovery.length;
    EL('nav-discovery-count').hidden=discovery.length===0;
  }
  function sourceHeader() {
    const failed=scan.status==='error' || scan.status==='partial' || scan.status==='fixture';
    const statusEl=EL('source-strip'); statusEl.classList.toggle('error',failed);
    if (scan.status==='not_run') {
      EL('source-title').textContent='AUTOMATED SOURCE CHECK NOT YET ENABLED';
      EL('source-sub').textContent=`${events.length} reviewed notice(s); feed discovery starts after a scheduled GitHub Actions run.`;
    } else if (failed) {
      EL('source-title').textContent=scan.status==='fixture'?'TEST FIXTURE ONLY - NOT A REAL SOURCE CHECK':'SOURCE CHECK INCOMPLETE - VERIFY MANUALLY';
      EL('source-sub').textContent=`Last attempt: ${formatChecked(scan.checked_at)}. Event notices are not live-confirmed.`;
    } else {
      EL('source-title').textContent='PUBLIC FEED DISCOVERY COMPLETED';
      EL('source-sub').textContent=`Last scan: ${formatChecked(scan.checked_at)}. ${discovery.length} mentions await analyst review; no auto-verification.`;
    }
  }
  function eventCard(e) {
    const s=timeStatus(e);
    return `<button type="button" class="event-item ${state.selected===e.id?'selected':''}" data-event-id="${escapeHtml(e.id)}" aria-label="Details for ${escapeHtml(e.title)}">
      <div class="event-tag-row"><span class="impact-tag ${escapeHtml(e.impact)}">${escapeHtml(e.impact)} impact</span><span class="type-tag">${escapeHtml(e.type)}</span><span class="event-window-tag ${s}">${escapeHtml(statusLabel(s))}</span></div>
      <div class="event-title">${escapeHtml(e.title)}</div>
      <div class="event-meta"><span>${icon('calendar')}${escapeHtml(formatDate(e.date))}</span><span>${icon('clock')}${escapeHtml(e.time_label)}</span></div>
      <div class="event-meta"><span>${icon('pin')}${escapeHtml(e.area)}</span></div>
      <div class="event-text">${escapeHtml(e.operational_effect)}</div>
      <div class="event-source"><span>Official mobility notice</span>${icon('arrow')}</div>
    </button>`;
  }
  function renderFeed() {
    const filtered=visibleEvents(); EL('list-count').textContent=filtered.length;
    if (filtered.length) EL('event-list').innerHTML=filtered.map(eventCard).join('');
    else EL('event-list').innerHTML=`<div class="empty-state">${icon('calendar')}<h3>No matching published events</h3><p>The filters returned no reviewed upcoming event notices. This is not a finding that Rome is free of demonstrations.</p><button type="button" id="clear-filters">Clear filters / show all dates</button></div>`;
    document.querySelectorAll('[data-event-id]').forEach(b => b.addEventListener('click', () => openEvent(b.dataset.eventId)));
    const clear=EL('clear-filters'); if (clear) clear.addEventListener('click', () => { state.time='all';state.impact='all';state.query='';EL('time-filter').value='all';EL('impact-filter').value='all';EL('event-search').value='';renderAll(); });
  }
  function renderExposure() {
    const el=EL('exposure-content');
    if (!state.watchpoints.length) {
      el.innerHTML=`<div class="mini-empty">${icon('pin')}<div><strong>No protected locations configured</strong><p>Add a hotel, venue, office, or transit hub to check distances from announced public-event markers. Nothing is uploaded.</p></div></div>`;
      return;
    }
    const visible=events.filter(e=>timeStatus(e)!=='ended');
    if (!visible.length) {
      el.innerHTML=`<div class="mini-empty">${icon('shield')}<div><strong>No current or upcoming reviewed event markers</strong><p>${state.watchpoints.length} watchpoint(s) saved. Check source discovery and local advisories; absence of listed events is not a safety guarantee.</p></div></div>`;
      return;
    }
    const rows=state.watchpoints.map(w => {
      const near=visible.map(e=>({e,d:distanceKm([w.lat,w.lng],e.point)})).filter(x=>x.d<=Number(w.radius)).sort((a,b)=>a.d-b.d);
      const nearest=near[0];
      return `<div class="exposure-row">${icon('pin')}<strong>${escapeHtml(w.name)} <small>${escapeHtml(w.type)} / ${escapeHtml(w.radius)} km watch radius</small></strong>${nearest?`<span class="distance-pill" title="${escapeHtml(nearest.e.title)}">${fmtDistance(nearest.d)} / ${escapeHtml(nearest.e.area)}</span>`:`<small>No markers within radius</small>`}</div>`;
    });
    el.innerHTML=rows.join('') + `<div style="padding:10px 18px 15px;color:#8197a8;font-size:10px">Distance is marker-to-watchpoint only. Does not model closed roads, march footprint, or movement time.</div>`;
  }
  function renderDiscovery() {
    EL('discovery-preview').innerHTML = discovery.length ? `<div class="mini-source">${icon('search')}<div><strong>${discovery.length} public-source mentions need review</strong><p>Recent articles match demonstration keywords. Their location, schedule, and operational relevance have not been independently verified.</p></div></div>`
      : `<div class="mini-source">${icon('search')}<div><strong>${scan.status==='not_run'?'Discovery not yet activated':'No new unreviewed mentions detected'}</strong><p>${scan.status==='not_run'?'Enable the scheduled GitHub workflow to check the official RSS feed.':scan.status==='error'?'Source check failed. This is not a no-findings result.':'RSS discovery is not a comprehensive protest database. Check official sources for late announcements.'}</p></div></div>`;
    const e=EL('discovery-list');
    e.innerHTML=discovery.length ? discovery.map(d=>{
      const url=validHttpsUrl(d.url); return `<article class="discovery-entry"><div><span class="type-tag">UNREVIEWED SOURCE MENTION</span><strong style="margin-top:7px">${escapeHtml(d.title)}</strong><p>${escapeHtml((d.summary||'').slice(0,400))}</p><small>${escapeHtml(d.source||'Roma Mobilita')} / Published ${escapeHtml(d.published_at||'time unavailable')}</small></div>${url?`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open notice ${icon('external')}</a>`:''}</article>`;
    }).join('') : `<div class="empty-state">${icon('search')}<h3>No items in discovery queue</h3><p>${scan.status==='not_run'?'The automated feed has not run yet.':'This does not mean no demonstrations are planned. Scan only covers the configured public feed and keyword matches.'}</p></div>`;
    EL('discovery-source-status').innerHTML=`<div class="health-grid"><div class="health-stat"><small>Source status</small><strong>${escapeHtml(scan.status==='ok'?'CHECK COMPLETED':scan.status==='not_run'?'NOT RUN':scan.status==='fixture'?'TEST FIXTURE':'CHECK INCOMPLETE')}</strong></div><div class="health-stat"><small>Last scan</small><strong>${escapeHtml(formatChecked(scan.checked_at))}</strong></div><div class="health-stat"><small>Articles examined</small><strong>${Number(scan.articles_examined)||0}</strong></div></div><div class="health-notice">${scan.error?`<strong>Warning:</strong> ${escapeHtml(scan.error)}<br>`:''}Official RSS is scanned for possible demonstration-related posts; results are unreviewed leads, not verified threat assessments. Reviewed event records are maintained separately in <code>data/events.json</code>. Scheduled jobs do not guarantee real-time coverage.</div>`;
  }

  function renderWatchpoints() {
    EL('watchpoint-count').textContent=state.watchpoints.length;
    EL('watchpoint-chip-count').textContent=state.watchpoints.length;
    EL('watchpoint-list').innerHTML=state.watchpoints.length ? state.watchpoints.map(w=>`<div class="watchpoint-entry"><div><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(w.type)} | ${Number(w.lat).toFixed(5)}, ${Number(w.lng).toFixed(5)} | radius ${escapeHtml(w.radius)} km</small></div><button type="button" class="delete-btn" data-remove-wp="${escapeHtml(w.id)}">Remove</button></div>`).join('')
      : `<div class="empty-state">${icon('pin')}<h3>No watchpoints saved</h3><p>Use the form to set a client-side geographic exposure point.</p></div>`;
    document.querySelectorAll('[data-remove-wp]').forEach(b=>b.addEventListener('click', () => {
      state.watchpoints=state.watchpoints.filter(w=>w.id!==b.dataset.removeWp);
      saveWatchpoints();renderAll();toast('Watchpoint removed from this browser.');
    }));
  }

  function renderFallbackMarkers(visible) {
    const schematicLines=[];
    if (state.showRoutes) for (const e of visible) {
      if (!Array.isArray(e.route_schematic) || e.route_schematic.length < 2) continue;
      const points=e.route_schematic.map(p => {
        const x=1000*(Number(p[1])-AREA.west)/(AREA.east-AREA.west), y=1000*(AREA.north-Number(p[0]))/(AREA.north-AREA.south);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      schematicLines.push(`<polyline points="${points}" fill="none" stroke="#65c8eb" stroke-width="5" stroke-dasharray="10 11" opacity=".82"/>`);
    }
    EL('fallback-routes').innerHTML=`<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">${schematicLines.join('')}</svg>`;
    const markers=[];
    if (state.showEvents) for (const e of visible) {
      const x=100*(Number(e.point[1])-AREA.west)/(AREA.east-AREA.west), y=100*(AREA.north-Number(e.point[0]))/(AREA.north-AREA.south);
      markers.push(`<button class="fallback-marker ${escapeHtml(e.impact)}" data-fallback-event="${escapeHtml(e.id)}" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%" title="${escapeHtml(e.title)}" aria-label="Details: ${escapeHtml(e.title)}"></button>`);
    }
    if (state.showWatch) for (const w of state.watchpoints) {
      const x=100*(Number(w.lng)-AREA.west)/(AREA.east-AREA.west), y=100*(AREA.north-Number(w.lat))/(AREA.north-AREA.south);
      if (x>=0 && x<=100 && y>=0 && y<=100) markers.push(`<button class="fallback-marker watch" data-fallback-watch="${escapeHtml(w.id)}" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%" title="Watchpoint: ${escapeHtml(w.name)}" aria-label="Watchpoint: ${escapeHtml(w.name)}"></button>`);
    }
    EL('fallback-markers').innerHTML=markers.join('');
    document.querySelectorAll('[data-fallback-event]').forEach(b=>b.addEventListener('click',()=>openEvent(b.dataset.fallbackEvent)));
    document.querySelectorAll('[data-fallback-watch]').forEach(b=>b.addEventListener('click',()=>toast('Watchpoint coordinates are editable in the Watchpoints tab.')));
  }
  function initMap() {
    if (!window.L) return;
    try {
      const L=window.L;
      state.map=L.map('map-leaflet',{center:[41.906,12.499],zoom:12,zoomControl:false,scrollWheelZoom:false,preferCanvas:true});
      L.control.zoom({position:'topright'}).addTo(state.map);
      const tiles=L.tileLayer('https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'});
      let loaded=false;
      tiles.on('tileload',()=>{
        if (loaded) return;
        loaded=true;state.mapReady=true;
        EL('map-leaflet').classList.add('ready');EL('map-fallback').style.visibility='hidden';
        setTimeout(()=>state.map?.invalidateSize(),30);
      });
      tiles.addTo(state.map);
      state.layers=L.layerGroup().addTo(state.map);
      state.map.on('click',e=>{
        goView('watchpoints'); EL('wp-lat').value=e.latlng.lat.toFixed(6);EL('wp-lng').value=e.latlng.lng.toFixed(6);EL('wp-name').focus();toast('Map location filled in watchpoint form.');
      });
    } catch (err) { console.warn('Interactive map unavailable; schematic fallback remains.',err); }
  }
  function drawLeaflet(visible) {
    if (!state.map || !state.layers) return;
    const L=window.L;state.layers.clearLayers();
    if (state.showRoutes) for (const e of visible) if (Array.isArray(e.route_schematic) && e.route_schematic.length>1) {
      L.polyline(e.route_schematic, {color:'#62c8f0',weight:3,opacity:.82,dashArray:'5 9',interactive:false}).addTo(state.layers);
    }
    if (state.showEvents) for (const e of visible) {
      const marker=L.marker(e.point,{icon:L.divIcon({className:'',html:`<div class="map-marker ${escapeHtml(e.impact)}"></div>`,iconSize:[18,18],iconAnchor:[9,9]})});
      marker.bindTooltip(escapeHtml(e.title),{className:'custom-tooltip',direction:'top',offset:[0,-10]});
      marker.on('click',()=>openEvent(e.id));marker.addTo(state.layers);
    }
    if (state.showWatch) for (const w of state.watchpoints) {
      const marker=L.marker([w.lat,w.lng],{icon:L.divIcon({className:'',html:'<div class="map-marker watch"></div>',iconSize:[18,18],iconAnchor:[9,9]})});
      marker.bindTooltip(`Watchpoint: ${escapeHtml(w.name)} (${escapeHtml(w.radius)} km radius)`,{className:'custom-tooltip',direction:'top',offset:[0,-10]});
      marker.on('click',e=>{L.DomEvent.stopPropagation(e);toast(`Saved watchpoint: ${w.name}`);});marker.addTo(state.layers);
      L.circle([w.lat,w.lng],{radius:Number(w.radius)*1000,color:'#3ee2d0',fillColor:'#3ee2d0',fillOpacity:.03,opacity:.28,weight:1,interactive:false}).addTo(state.layers);
    }
  }
  function renderMap() { const filtered=visibleEvents();renderFallbackMarkers(filtered);drawLeaflet(filtered); }
  function renderAll() { updateKPIs();sourceHeader();renderFeed();renderExposure();renderDiscovery();renderWatchpoints();renderMap(); }
  function openEvent(id) {
    const e=events.find(v=>v.id===id);if(!e)return;state.selected=e.id;
    const s=timeStatus(e), route=e.route_streets||[], url=validHttpsUrl(e.source_url);
    const possible=state.watchpoints.map(w=>({name:w.name, d:distanceKm([w.lat,w.lng],e.point), radius:Number(w.radius)})).filter(x=>x.d<=x.radius).sort((a,b)=>a.d-b.d);
    EL('event-detail').innerHTML=`<div class="drawer-main"><div class="event-tag-row"><span class="impact-tag ${escapeHtml(e.impact)}">${escapeHtml(e.impact)} impact</span><span class="event-window-tag ${s}">${escapeHtml(statusLabel(s))}</span></div>
      <h2>${escapeHtml(e.title)}</h2><p class="drawer-lede">${escapeHtml(e.operational_effect)}</p>
      <div class="drawer-section"><h3>Published event details</h3><dl>
        <div class="drawer-kv"><dt>Event date</dt><dd>${escapeHtml(formatDate(e.date))}</dd></div>
        <div class="drawer-kv"><dt>Time</dt><dd>${escapeHtml(e.time_label)}</dd></div>
        <div class="drawer-kv"><dt>Location</dt><dd>${escapeHtml(e.location)}</dd></div>
        <div class="drawer-kv"><dt>Event type</dt><dd>${escapeHtml(e.type)}</dd></div>
        ${e.expected_attendance?`<div class="drawer-kv"><dt>Expected turnout</dt><dd>Approximately ${Number(e.expected_attendance)} (official forecast, not verified count)</dd></div>`:''}
      </dl></div>
      ${route.length?`<div class="drawer-section"><h3>Named streets / areas in notice</h3><div style="font-size:12px;line-height:1.85;color:#d3e0ea">${route.map(escapeHtml).join(' &middot; ')}</div><p style="margin-top:9px;color:#869fb2;font-size:11px">Names are transcribed from the notice. A dashed map connector is only schematic; potential closure streets are not necessarily a finalized march route.</p></div>`:''}
      ${(e.transit_lines||[]).length?`<div class="drawer-section"><h3>Published potential transit diversions</h3><div style="font-size:12px;color:#d4e6eb;line-height:1.8">Lines: ${escapeHtml(e.transit_lines.join(', '))}</div></div>`:''}
      <div class="drawer-section"><h3>Watchpoint exposure</h3><p style="color:#b1c3cc;font-size:12px;line-height:1.55">${possible.length?possible.map(x=>`${escapeHtml(x.name)}: ${fmtDistance(x.d)} to event marker (watch radius ${x.radius} km)`).join('<br>'):'No configured watchpoint is within its chosen radius of this event marker.'}</p></div>
      <div class="drawer-section"><h3>Source / analyst notes</h3><dl>
        <div class="drawer-kv"><dt>Source</dt><dd>${escapeHtml(e.source)}</dd></div><div class="drawer-kv"><dt>Published</dt><dd>${escapeHtml(e.source_published||'Not available')}</dd></div><div class="drawer-kv"><dt>Reviewed</dt><dd>${escapeHtml(e.reviewed_on||'Not recorded')}</dd></div></dl><p style="color:#92aabe;font-size:11px;line-height:1.6">${escapeHtml(e.analyst_note||'')}</p><p style="color:#92aabe;font-size:11px;line-height:1.6;margin-top:7px">${escapeHtml(e.geolocation_note||'')}</p></div>
      ${url?`<a class="drawer-action" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open original official notice ${icon('external')}</a>`:''}
      <div class="drawer-notice">Published time windows never establish current crowd presence. Confirm road closures and service status before any movement decision.</div>
    </div>`;
    EL('drawer-scrim').hidden=false;EL('event-drawer').classList.add('open');EL('event-drawer').setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';renderFeed();
    if (state.map && state.mapReady) state.map.panTo(e.point,{animate:true,duration:.4});
    EL('close-drawer').focus();
  }
  function closeEvent() {
    EL('drawer-scrim').hidden=true;EL('event-drawer').classList.remove('open');EL('event-drawer').setAttribute('aria-hidden','true');
    document.body.style.overflow='';state.selected=null;renderFeed();
  }
  function goView(name) {
    if (!['overview','discovery','watchpoints'].includes(name)) return;
    state.view=name;
    ['overview','discovery','watchpoints'].forEach(n => { EL(`${n}-view`).hidden=n!==name; });
    document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
    window.scrollTo(0,0);
    if (name==='overview' && state.map) setTimeout(()=>state.map?.invalidateSize(),130);
  }
  function exportCsv() {
    const list=visibleEvents();
    const columns=[['date','Date'],['time_label','Time (Rome)'],['title','Event'],['impact','Impact'],['area','Area'],['location','Location'],['operational_effect','Operational effect'],['transit_lines','Transit lines'],['source_url','Source URL'],['reviewed_on','Reviewed on']];
    function cell(v) {
      let s=Array.isArray(v)?v.join('; '):text(v);
      if (/^[=+@\-\t\r]/.test(s)) s="'"+s;
      return '"'+s.replaceAll('"','""')+'"';
    }
    const csv='\uFEFF'+[columns.map(x=>cell(x[1])).join(','),...list.map(e=>columns.map(([field])=>cell(e[field])).join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`rome-protest-monitor-${romeDay()}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
    toast(`Exported ${list.length} filtered notice(s).`);
  }
  function attachHandlers() {
    document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>goView(b.dataset.nav)));
    EL('source-details-link').addEventListener('click',()=>goView('discovery'));
    EL('view-discovery').addEventListener('click',()=>goView('discovery'));
    EL('rail-about').addEventListener('click',()=>{goView('discovery');toast('See source status and verification notes.');});
    EL('add-watch-btn').addEventListener('click',()=>{goView('watchpoints');EL('wp-name').focus();});
    EL('edit-watchpoints').addEventListener('click',()=>{goView('watchpoints');EL('wp-name').focus();});
    EL('export-btn').addEventListener('click',exportCsv);
    EL('show-archive').addEventListener('click',()=>{state.time='all';EL('time-filter').value='all';renderAll();EL('event-list').scrollTop=0;});
    EL('time-filter').addEventListener('change',e=>{state.time=e.target.value;renderAll();});
    EL('impact-filter').addEventListener('change',e=>{state.impact=e.target.value;renderAll();});
    EL('event-search').addEventListener('input',e=>{state.query=e.target.value;renderFeed();renderMap();});
    EL('close-drawer').addEventListener('click',closeEvent);
    EL('drawer-scrim').addEventListener('click',closeEvent);
    document.addEventListener('keydown',e=>{if(e.key==='Escape' && EL('event-drawer').classList.contains('open'))closeEvent();});
    [['layer-events','showEvents'],['layer-watchpoints','showWatch'],['layer-routes','showRoutes']].forEach(([id,property])=>EL(id).addEventListener('click',()=>{state[property]=!state[property];EL(id).classList.toggle('selected',state[property]);renderMap();}));
    EL('map-center').addEventListener('click',()=>{if(state.map && state.mapReady)state.map.setView([41.906,12.499],12);else toast('Using schematic offline map.');});
    EL('watchpoint-form').addEventListener('submit',event=>{
      event.preventDefault();const form=event.currentTarget;
      const w={id:`wp-${Date.now()}-${Math.floor(Math.random()*1e6)}`,name:form.elements.namedItem('name').value.trim(),type:form.elements.namedItem('type').value,lat:Number(form.elements.namedItem('lat').value),lng:Number(form.elements.namedItem('lng').value),radius:Number(form.elements.namedItem('radius').value)};
      if(!isValidWatchpoint(w)||!w.name){toast('Enter a valid name, latitude, longitude, and radius.');return;}
      if(state.watchpoints.length>=50){toast('Limit of 50 local watchpoints reached.');return;}
      state.watchpoints.push(w);if(!saveWatchpoints()){state.watchpoints.pop();return;}
      form.reset();renderAll();toast('Location saved in this browser only.');
    });
  }
  attachHandlers();
  updateClock();setInterval(updateClock,1000);
  initMap();renderAll();
  setInterval(()=>{updateKPIs();renderFeed();renderExposure();renderMap();},60*1000);
  // Expose strictly read-only helper for smoke tests; does not expose private watchpoint contents.
  window.romeMonitorHealth=()=>({events:events.length,discovery:discovery.length,sourceStatus:scan.status,mapReady:state.mapReady});
})();
