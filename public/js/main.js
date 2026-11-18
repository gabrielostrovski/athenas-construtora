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
      nome: d.get("nome"),
      telefone: d.get("telefone"),
      email: d.get("email"),
      tipo: d.get("tipo"),
      msg: d.get("msg"),
      website: d.get("website"),
      consentimento: form.elements.consentimento.checked
    };

    function montarLinkWhatsApp() {
      var linhas = [
        "Olá, Athenas Construtora! Solicitei um orçamento pelo site:\n",
        "*Nome:* " + payload.nome,
        "*Telefone:* " + payload.telefone,
        payload.email ? "*E-mail:* " + payload.email : "",
        "*Tipo de obra:* " + payload.tipo,
        payload.msg ? "*Detalhes do projeto:*\n" + payload.msg : ""
      ].filter(Boolean);
      return "https://wa.me/554788090990?text=" + encodeURIComponent(linhas.join("\n"));
    }

    btn.disabled = true;
    say("Enviando pedido...", true);

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
          var waUrl = (x.j && x.j.whatsapp) || montarLinkWhatsApp();
          say("Pedido recebido! Abrindo o WhatsApp da Athenas Construtora...", true);

          // Redireciona automaticamente após 800ms
          setTimeout(function () {
            window.location.href = waUrl;
          }, 800);

          // Botão manual de garantia caso o navegador bloqueie o redirecionamento
          var a = document.createElement("a");
          a.href = waUrl;
          a.target = "_blank";
          a.rel = "noopener";
          a.className = "btn ghost";
          a.style.display = "inline-block";
          a.style.marginTop = "12px";
          a.textContent = "Continuar no WhatsApp 📲";
          note.appendChild(document.createElement("br"));
          note.appendChild(a);
        } else {
          say((x.j.erros && x.j.erros.join(" ")) || "Não foi possível enviar. Tente novamente.", false);
        }
      })
      .catch(function () {
        var waUrl = montarLinkWhatsApp();
        say("Houve uma oscilação na rede, mas você pode enviar diretamente pelo WhatsApp:", false);
        var a = document.createElement("a");
        a.href = waUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "btn";
        a.style.display = "inline-block";
        a.style.marginTop = "12px";
        a.textContent = "Enviar pelo WhatsApp 📲";
        note.appendChild(document.createElement("br"));
        note.appendChild(a);
      })
      .then(function () {
        btn.disabled = false;
      });
  });
})();
