// Sets light/dark before the page paints (kept in a file so the security policy can block inline scripts).
// Set the theme before the page paints, so there is no light/dark flash.
(function () {
  var p = 'auto'; try { p = localStorage.getItem('gcj_theme') || 'auto'; } catch (e) {}
  document.documentElement.dataset.theme = p === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p;
})();
