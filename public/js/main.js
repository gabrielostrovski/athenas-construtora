(function () {
  var form = document.getElementById("f");
  if (!form) return;
  var note = document.getElementById("note");
  var btn = form.querySelector("button[type=submit]");

  function say(text, ok) {
    note.textContent = text;
    note.setAttribute("data-state", ok ? "ok" : "erro");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = new FormData(form);
    var payload = {
      nome: d.get("nome"), telefone: d.get("telefone"), email: d.get("email"),
      tipo: d.get("tipo"), msg: d.get("msg"), website: d.get("website"),
      consentimento: form.elements.consentimento.checked
    };
    btn.disabled = true;
    say("Enviando…", true);
    fetch("/api/contato", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
      })
      .then(function (x) {
        if (x.ok) {
          form.reset();
          say(x.j.mensagem || "Pedido enviado.", true);
          if (x.j.whatsapp) {
            var a = document.createElement("a");
            a.href = x.j.whatsapp; a.target = "_blank"; a.rel = "noopener";
            a.className = "btn ghost"; a.textContent = "Falar agora pelo WhatsApp";
            note.appendChild(document.createTextNode(" "));
            note.appendChild(a);
          }
        } else {
          say((x.j.erros && x.j.erros.join(" ")) || "Não foi possível enviar. Tente novamente.", false);
        }
      })
      .catch(function () { say("Sem conexão com o servidor. Tente novamente.", false); })
      .then(function () { btn.disabled = false; });
  });
})();
