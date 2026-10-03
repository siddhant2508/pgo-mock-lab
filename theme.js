// Applies the theme before the page paints. Sepia is the default; a saved choice wins.
try{var t=localStorage.getItem("pgo-theme");if(t!=="light"&&t!=="dark"&&t!=="system")t="sepia";if(t!=="system")document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","sepia")}
