// Tema del CRM elegido por el dueño, aplicado ANTES de pintar para que no haya
// destello al recargar. Va en un archivo aparte (no en línea) porque el panel se
// sirve con una política de contenido que solo permite scripts propios.
try {
  var t = localStorage.getItem("vex-crm-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
