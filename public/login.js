(function(){
  "use strict";
  var errorEl = document.getElementById("loginError");
  function showError(msg){ errorEl.textContent = msg; errorEl.hidden = false; }

  var params = new URLSearchParams(window.location.search);
  if (params.get("error") === "domain") showError("That account isn't allowed. Sign in with your Qlub Google account.");
  else if (params.get("error")) showError("Sign-in didn't complete. Please try again.");

  fetch("/auth/options", { credentials: "same-origin" })
    .then(function(r){ return r.json(); })
    .then(function(opts){
      if (opts.google) document.getElementById("googleBtn").hidden = false;
      if (opts.dev) document.getElementById("devBtn").hidden = false;
      if (opts.domain) document.getElementById("loginNote").textContent = "For Qlub employees only. Use your @" + opts.domain + " account.";
      if (!opts.google && !opts.dev) showError("Sign-in isn't configured yet. Ask the app owner.");
    })
    .catch(function(){ showError("Couldn't reach the server. Try reloading."); });

  document.getElementById("devBtn").addEventListener("click", function(){
    fetch("/auth/dev-login", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
      .then(function(r){
        if (!r.ok) throw new Error();
        window.location.href = "/";
      })
      .catch(function(){ showError("Dev login failed."); });
  });
})();
