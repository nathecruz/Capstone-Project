// Applies the viewer's saved theme before first paint (kept external so the CSP can forbid inline scripts).
try {
  var theme = localStorage.getItem('habitai-admin-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {
  /* storage unavailable: follow the OS setting */
}
