const shapes = {
  plug: '<path d="M8 3v4m8-4v4M6 7h12v3a6 6 0 0 1-12 0V7Zm6 9v5"/>',
  book: '<path d="M3 4h6c1.5 0 2.5.5 3 1.5C12.5 4.5 13.5 4 15 4h6v14h-6c-1.5 0-2.5.5-3 1.5-.5-1-1.5-1.5-3-1.5H3V4Zm9 2v13"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m0-10h13"/>',
  send: '<path d="m21 3-7 18-3.5-7.5L3 10l18-7ZM10.5 13.5 21 3"/>',
  login: '<path d="M12 4h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7M3 12h11m-5-5 5 5-5 5"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5m-4 5a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.1-2.5 4m0 3h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9h.01"/>',
  sliders: '<path d="M4 7h4m4 0h8M4 17h9m4 0h3"/><circle cx="10" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-15.7 8 4.4"/>',
  school: '<path d="m2 9 10-5 10 5-10 5L2 9Zm4 3v4c4 3 8 3 12 0v-4m3-2v6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  sparkles: '<path d="m11 3 1.9 5.2L18 10l-5.1 1.8L11 17l-1.9-5.2L4 10l5.1-1.8L11 3Zm7 10 .9 2.5 2.6.9-2.6.9L18 20l-.9-2.7-2.6-.9 2.6-.9L18 13Z"/>',
  play: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 5 4-5 4V8Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5m-18 4 9 5 9-5"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.4"/><path d="m3 17 4-4 3 2 5-6 6 7"/>',
  article: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7m-7 4h7m-7 4H13"/>',
  message: '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10m-10 4h6"/>',
  frame: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  shield: '<path d="m12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6l8-3Z"/><path d="m8.5 11.8 2.3 2.3 4.9-5"/>',
  link: '<path d="m10 14 4-4m-5 6-1.2 1.2a3.8 3.8 0 1 1-5.3-5.4L6 8.3a3.8 3.8 0 0 1 5.3 0m1.4 7.4a3.8 3.8 0 0 0 5.3 0l3.5-3.5a3.8 3.8 0 0 0-5.3-5.4L15 8"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
}

export function showIcon(element, name) {
  element.dataset.icon = name
  element.setAttribute('aria-hidden', 'true')
  element.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + shapes[name] + '</svg>'
}

export function mountIcons() {
  document.querySelectorAll('i[data-icon]').forEach(element => showIcon(element, element.dataset.icon))
}
