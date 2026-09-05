// Applique le thème mémorisé avant le premier rendu pour éviter un scintillement.
// Même logique que phi.tmktools.com (clé « pi-theme », préférence système par défaut).
(function () {
  try {
    var saved = localStorage.getItem('pi-theme');
    var theme = saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f6f4ee' : '#0b0f14');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
