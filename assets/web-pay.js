/* SSMS website payments — connectIPS + Bank QR (same two methods as the Android app).
   Shared by new-school.html, renew.html and payment-result.html.
   Talks only to Supabase edge functions; no secret ever lives in this file.
   (The Supabase URL below is public, exactly like in the other pages.) */
(function () {
  var BASE = "https://icfxffduambqlbivowzs.supabase.co/functions/v1";
  // NCHL asked for connectIPS to open in a new tab; set true to follow that. false = same tab.
  var OPEN_IN_NEW_TAB = false;

  var css = ".m{display:flex;align-items:center;justify-content:center;gap:7px}" +
    ".m img{width:22px;height:22px;border-radius:5px;object-fit:cover}" +
    ".qrcard{display:none}" +
    ".qrcard .qrimg{display:block;margin:0 auto 12px;max-width:260px;width:100%;border:1px solid #dfe3ef;border-radius:12px;background:#fff;padding:8px}" +
    ".qrcard .bank{white-space:pre-wrap;background:#f9fafe;border:1px solid #dfe3ef;border-radius:10px;padding:10px 12px;font-size:.85rem;line-height:1.55;margin-bottom:14px;word-break:break-word}" +
    ".qrcard .amt{text-align:center;font-weight:800;font-size:1.1rem;margin-bottom:12px}" +
    ".qrcard .note{font-size:.78rem;color:#6b7794;line-height:1.55;margin:0 0 14px}" +
    ".qrcard .done{display:none;text-align:center;font-weight:700;color:#166a45;background:#eafbf2;border:1px solid #bdf0d4;border-radius:10px;padding:12px;font-size:.88rem;line-height:1.55}" +
    ".qrcard button.sec{width:100%;margin-top:10px;padding:11px;border:1px solid #dfe3ef;background:#fff;border-radius:10px;font-weight:700;color:#3a4468;cursor:pointer}" +
    ".spin{width:34px;height:34px;border:4px solid #dfe3ef;border-top-color:#152a6e;border-radius:50%;margin:6px auto 14px;animation:sp 1s linear infinite}" +
    "@keyframes sp{to{transform:rotate(360deg)}}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  function rupees(n) {
    var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "रु. " + s.replace(/\d/g, function (d) { return "०१२३४५६७८९"[d]; });
  }

  async function call(path, body, timeoutMs) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, timeoutMs || 45000);
    try {
      var res = await fetch(BASE + "/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = { ok: false, error: "HTTP " + res.status }; }
      data._status = res.status;
      return data;
    } finally { clearTimeout(t); }
  }

  function prep(body) { return call("web-pay-prepare", body); }

  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) {} }

  // Opens connectIPS: initiate on the server, remember what this payment was for, then POST the
  // signed form to the gateway from the browser. `meta` is stored under the transaction id so
  // payment-result.html can show the right message when connectIPS sends the person back.
  async function startConnectIps(opts) {
    var data = await call("connectips-initiate", {
      school_id: opts.schoolId,
      school_code: opts.schoolCode,
      amount: opts.amount,
      purpose: opts.purpose
    });
    if (!data.ok) return { ok: false, error: data.error || ("HTTP " + data._status) };
    var txn = data.gateway_ref;
    save("ssms_pay_" + txn, Object.assign({ ts: Date.now() }, opts.meta || {}, {
      kind: opts.purpose === "SCHOOL_GENERATION" ? "new" : "renew",
      school_code: opts.schoolCode, amount: opts.amount
    }));
    save("ssms_last_txn", txn);
    return {
      ok: true, txn: txn,
      go: function () {
        var f = document.createElement("form");
        f.method = "POST"; f.action = data.gateway_url;
        f.target = OPEN_IN_NEW_TAB ? "_blank" : "_self";
        var fields = data.form_fields || {};
        Object.keys(fields).forEach(function (k) {
          var i = document.createElement("input");
          i.type = "hidden"; i.name = k; i.value = fields[k];
          f.appendChild(i);
        });
        document.body.appendChild(f);
        f.submit();
      }
    };
  }

  // Bank QR card: shows the same QR + bank details the app shows (read from app_config on the
  // server) and a "I have paid" button. Nothing is activated here; the Super Admin approves.
  async function renderQrCard(el, o) {
    el.innerHTML = "";
    var h = document.createElement("h1"); h.textContent = "Bank QR बाट भुक्तानी"; el.appendChild(h);
    var sub = document.createElement("p"); sub.className = "sub";
    sub.textContent = "तलको QR स्क्यान गरेर वा बैंक विवरणमा रकम पठाउनुहोस्, अनि “मैले भुक्तानी गरेँ” थिच्नुहोस्।";
    el.appendChild(sub);
    var amt = document.createElement("div"); amt.className = "amt";
    amt.textContent = rupees(o.amount) + (o.amountNote ? " — " + o.amountNote : "");
    el.appendChild(amt);

    var info = await prep({ action: "payment_info" });
    if (!info.ok) {
      var e = document.createElement("div"); e.className = "status err";
      e.textContent = "भुक्तानी विवरण लोड हुन सकेन: " + (info.error || "");
      el.appendChild(e);
      return;
    }
    if (info.qr_base64) {
      var img = document.createElement("img"); img.className = "qrimg"; img.alt = "Payment QR";
      var q = info.qr_base64.trim();
      img.src = q.indexOf("data:") === 0 ? q : "data:image/png;base64," + q;
      el.appendChild(img);
    }
    if (info.bank_details) {
      var b = document.createElement("div"); b.className = "bank"; b.textContent = info.bank_details;
      el.appendChild(b);
    }
    if (!info.qr_base64 && !info.bank_details) {
      var n = document.createElement("div"); n.className = "status err";
      n.textContent = "अहिले QR / बैंक विवरण उपलब्ध छैन। कृपया connectIPS प्रयोग गर्नुहोस्।";
      el.appendChild(n); return;
    }
    var lab = document.createElement("label"); lab.textContent = "Transaction / Reference नम्बर (ऐच्छिक)"; el.appendChild(lab);
    var ref = document.createElement("input"); ref.placeholder = "बैंक रसिदमा देखिने नम्बर"; ref.maxLength = 60; el.appendChild(ref);
    var note = document.createElement("p"); note.className = "note";
    note.textContent = "भुक्तानी बैंकबाट आफैँ प्रमाणित हुँदैन — हाम्रो टोलीले बैंक विवरणसँग मिलाएर स्वीकृत गरेपछि मात्र सदस्यता सक्रिय हुन्छ।";
    el.appendChild(note);
    var status = document.createElement("div"); status.className = "status"; el.appendChild(status);
    var btn = document.createElement("button"); btn.className = "pay"; btn.textContent = "मैले भुक्तानी गरेँ"; el.appendChild(btn);
    var done = document.createElement("div"); done.className = "done"; el.appendChild(done);
    btn.onclick = async function () {
      btn.disabled = true; status.className = "status"; status.textContent = "पठाउँदै...";
      var r;
      try { r = await o.onSubmit(ref.value.trim()); } catch (err) { r = { ok: false, error: String(err) }; }
      if (r && r.ok) {
        status.textContent = ""; btn.style.display = "none"; ref.style.display = "none"; lab.style.display = "none";
        done.style.display = "block";
        done.textContent = "✅ तपाईंको भुक्तानी दाबी प्राप्त भयो। बैंक विवरणसँग मिलाएपछि सदस्यता सक्रिय हुनेछ।";
        if (o.onDone) o.onDone();
      } else {
        var m = (r && r.error) || "त्रुटि भयो";
        status.className = "status err"; status.textContent = "त्रुटि: " + m; btn.disabled = false;
      }
    };
    if (o.onBack) {
      var back = document.createElement("button"); back.className = "sec"; back.textContent = "← फर्कनुहोस्";
      back.onclick = o.onBack; el.appendChild(back);
    }
  }

  window.SSMSPay = {
    BASE: BASE, call: call, prep: prep, rupees: rupees,
    save: save, load: load, drop: drop,
    startConnectIps: startConnectIps, renderQrCard: renderQrCard
  };
})();
