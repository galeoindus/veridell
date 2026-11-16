(function(){
  function read(){ try { return JSON.parse(localStorage.getItem("amigo2_settings")||"{}") || {}; } catch(e){ return {}; } }
  function paint(t){
    document.body.classList.toggle("dark", t === "dark");
    var b = document.getElementById("btnTheme");
    if (b){
      var moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A8.6 8.6 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z"/></svg>';
      var sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>';
      b.innerHTML = t === "dark" ? sun : moon;
      b.title = t === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
  }
  paint(read().theme === "dark" ? "dark" : "light");
  document.addEventListener("click", function(e){
    if (!e.target || !e.target.closest || !e.target.closest("#btnTheme")) return;
    var nx = document.body.classList.contains("dark") ? "light" : "dark";
    var st = read(); st.theme = nx;
    try { localStorage.setItem("amigo2_settings", JSON.stringify(st)); } catch(err){}
    paint(nx);
    try {
      var bl = document.getElementById("brandLogo");
      if (bl) bl.src = pickMark(CHAKRA_URI, CHAKRA_URI_D);
      if (typeof sideListRender === "function") sideListRender();
      if (typeof renderAll === "function") renderAll();
    } catch(err){}
  });
})();

/* The "Open settings" button used an inline onclick, which the site's
 * Content-Security-Policy blocks (script-src 'self'). One delegated listener
 * does the same job without weakening the policy. */
document.addEventListener('click', (event) => {
  const trigger = event.target && event.target.closest && event.target.closest('[data-open-settings]');
  if (!trigger) return;
  event.preventDefault();
  const btn = document.getElementById('btnSet');
  if (btn) btn.click();
});
