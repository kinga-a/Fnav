(function () {
  const theme = localStorage.getItem('cloudnav_theme_preference');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1c2128');
  } else {
    document.documentElement.classList.remove('dark');
  }
})();