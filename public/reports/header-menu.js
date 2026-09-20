// Header "menu" dropdown for the static report pages. Kept in a file rather
// than inline because the site's Content-Security-Policy forbids inline script.
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('.site-header-nav-btn');
  if (btn && btn.nextElementSibling) btn.nextElementSibling.classList.toggle('open');
});
document.addEventListener('mousedown', function (e) {
  document.querySelectorAll('.site-header-dropdown.open').forEach(function (d) {
    if (!d.parentElement.contains(e.target)) d.classList.remove('open');
  });
});
