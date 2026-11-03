(function () {
  "use strict";
  var root = document.documentElement;
  if (root.getAttribute("data-portal-layout") !== "aurora-network") return;
  root.classList.add("aurora-network-ready");
})();
