const tg = window.Telegram.WebApp;
tg.expand();

// This app only works when opened from inside Telegram — initData is
// cryptographically signed by Telegram and re-verified on the backend
// with the bot token. Without it, no request will be accepted, so a
// downloaded/cloned copy of this page has no way to actually do anything.
const INIT_DATA = tg.initData || "";

// Backend (Render) base URL — set in config.js, so redeploying the backend
// only requires editing one small file, not this one.
const API = window.APP_CONFIG?.API_BASE || "";

if (!INIT_DATA) {
  document.getElementById("app").innerHTML =
    "<p style='text-align:center;margin-top:40px'>⚠️ Bu ilova faqat Telegram ichida ishlaydi.</p>";
  throw new Error("Not running inside Telegram WebApp");
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": INIT_DATA,
  };
}

const TYPE_META = {
  command:          { icon: "🔵", label: "Buyruq",   accent: "#3B82F6" },
  text_match:       { icon: "🟣", label: "Matn",     accent: "#8B5CF6" },
  button:           { icon: "🟢", label: "Tugma",    accent: "#10B981" },
  media:            { icon: "🟠", label: "Media",    accent: "#F59E0B" },
  admin_only:       { icon: "🌸", label: "Shart",    accent: "#F43F5E" },
  sticker:          { icon: "🧊", label: "Stiker",   accent: "#06B6D4" },
  poll:             { icon: "📊", label: "So'rov",   accent: "#EAB308" },
  random_reply:     { icon: "🎲", label: "Tasodif",  accent: "#EC4899" },
  forward_to_admin: { icon: "📨", label: "Adminga",  accent: "#6366F1" },
  ai_reply:         { icon: "🧠", label: "AI",       accent: "#14B8A6" },
  invoice:          { icon: "💳", label: "Invoice",  accent: "#F97316" },
  referral:         { icon: "🔗", label: "Referral", accent: "#22C55E" },
  broadcast:        { icon: "📢", label: "Ommaviy",  accent: "#0EA5E9" },
};

const COLOR_MAP = { red: "danger", blue: "primary", green: "success" };
const COLOR_DOT = { danger: "🔴", primary: "🔵", success: "🟢" };
const HAS_TRIGGER = new Set(["command", "text_match", "media", "admin_only", "sticker", "poll", "random_reply", "forward_to_admin", "ai_reply", "invoice", "referral", "broadcast"]);
const OPTIONAL_TRIGGER_TYPES = new Set(["media", "sticker", "poll", "random_reply", "invoice"]);
const HAS_REPLY_TEXT = new Set(["command", "text_match", "button", "admin_only", "media", "forward_to_admin", "referral", "broadcast"]);
const HAS_BUTTONS = new Set(["command", "text_match", "button", "admin_only", "media", "sticker", "poll", "random_reply", "invoice"]);

let state = { bot_id: null, token: "", blocks: [], forceJoin: { enabled: false, channel: "", text: "" }, storageChatId: "" };
let currentTab = "constructor";
let myBotsCache = [];

let blockCounter = 0;
let openButtonForm = null; // idx of the card whose "+ Tugma" form is open

const blocksListEl = document.getElementById("blocks-list");
const emptyStateEl = document.getElementById("empty-state");
const countBadgeEl = document.getElementById("block-count");
const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function newBlock(type, opts = {}) {
  blockCounter += 1;
  const id = opts.id || ("b" + blockCounter);
  const base = { id, type, buttons: [], delay_seconds: 0, _linkedFrom: opts.linkedFrom || null };

  if (HAS_TRIGGER.has(type)) base.trigger = type === "command" ? "/start" : "";
  if (HAS_REPLY_TEXT.has(type)) base.reply_text = opts.reply_text || "";
  if (type === "admin_only") base.fallback_text = "⛔️ Bu buyruq faqat adminlar uchun.";
  if (type === "media") { base.media_kind = opts.media_kind || "photo"; base.media_url = opts.media_url || ""; }
  if (type === "sticker") base.sticker_file_id = "";
  if (type === "poll") { base.poll_question = ""; base.poll_options = ["", ""]; }
  if (type === "random_reply") base.replies = ["", ""];
  if (type === "forward_to_admin") base.reply_text = "✅ Xabaringiz adminga yuborildi!";
  if (type === "ai_reply") {
    base.system_prompt = "";
    base.groq_api_key = "";
    base.thinking_text = "🤔 O'ylayapman...";
  }
  if (type === "invoice") {
    base.invoice_title = "";
    base.invoice_description = "";
    base.price = 50;
    base.reply_text = "✅ To'lov qabul qilindi, rahmat!";
  }
  if (type === "referral") {
    base.reply_text = "Salom! Do'stlaringizni taklif qiling:\n{referral_link}\n\nTaklif qilganlaringiz: {referral_count} kishi";
  }
  if (type === "broadcast") {
    base.reply_text = "✅ Xabar {count} kishiga yuborildi.";
  }

  return base;
}

function fieldRow(idx, field, value, placeholder, extraAttrs = "") {
  return `<input data-idx="${idx}" data-field="${field}" value="${value ?? ""}" placeholder="${placeholder}" ${extraAttrs}>`;
}

// ---- Button chips + "+ Tugma" builder ----

function buttonChipsHtml(idx, block) {
  const flat = (block.buttons || []).flat();
  const chips = flat.map((btn, bIdx) => {
    const target = btn.url ? `🔗 havola` : `→ ${btn.goto}`;
    const dot = COLOR_DOT[btn.color] || "";
    return `<span class="btn-chip">${dot} ${btn.text} <small>${target}</small>
      <button data-idx="${idx}" data-btn-idx="${bIdx}" data-action="delete-button">✕</button></span>`;
  }).join("");
  return `<div class="btn-chips">${chips}</div>`;
}

function buttonFormHtml(idx) {
  return `
    <div class="btn-form" data-idx="${idx}">
      <label>Tugma nomi</label>
      <input data-form-field="text" placeholder="Masalan: Menyu">

      <label>Rangi <span style="font-weight:400;opacity:.7">(haqiqiy Telegram tugma rangi)</span></label>
      <div class="color-row">
        <button class="color-swatch" data-color="red">🔴</button>
        <button class="color-swatch" data-color="blue">🔵</button>
        <button class="color-swatch" data-color="green">🟢</button>
        <button class="color-swatch selected" data-color="none">⚪️ Yo'q</button>
      </div>

      <label>Bosilganda nima chiqsin?</label>
      <div class="action-row">
        <button class="action-btn selected" data-action-type="message">💬 Xabar</button>
        <button class="action-btn" data-action-type="link">🔗 Havola</button>
        <button class="action-btn" data-action-type="media">🖼 Media</button>
        <button class="action-btn" data-action-type="newmenu">🧱 Yangi tugmalar</button>
      </div>

      <div class="action-fields" data-action-fields="message">
        <label>Xabar matni</label>
        <textarea data-form-field="reply_text" rows="2" placeholder="Bosilganda chiqadigan matn"></textarea>
      </div>
      <div class="action-fields" data-action-fields="link" style="display:none">
        <label>Havola (URL)</label>
        <input data-form-field="url" placeholder="https://...">
      </div>
      <div class="action-fields" data-action-fields="media" style="display:none">
        <label>Media turi</label>
        <select data-form-field="media_kind">
          <option value="photo">🖼 Rasm</option>
          <option value="video">🎬 Video</option>
          <option value="document">📄 Fayl</option>
        </select>
        <label>Media URL</label>
        <input data-form-field="media_url" placeholder="https://example.com/rasm.jpg">
      </div>

      <div class="row">
        <button class="btn-form-confirm" data-idx="${idx}">✅ Qo'shish</button>
        <button class="btn-form-cancel" data-idx="${idx}">Bekor qilish</button>
      </div>
    </div>
  `;
}

function renderBlocks() {
  blocksListEl.innerHTML = "";
  countBadgeEl.textContent = state.blocks.length;
  emptyStateEl.classList.toggle("visible", state.blocks.length === 0);

  state.blocks.forEach((block, idx) => {
    const meta = TYPE_META[block.type];
    const card = document.createElement("div");
    card.className = "block-card";
    card.style.setProperty("--accent", meta.accent);

    let fields = "";

    if (HAS_TRIGGER.has(block.type)) {
      const label = OPTIONAL_TRIGGER_TYPES.has(block.type)
        ? `Trigger <span style="font-weight:400;opacity:.7">(ixtiyoriy — bo'sh bo'lsa, faqat tugma orqali ochiladi)</span>`
        : "Trigger";
      fields += `<label>${label}</label>${fieldRow(idx, "trigger", block.trigger, block.type === "command" ? "/start" : "Masalan: /rasm yoki bo'sh qoldiring")}`;
    }

    if (block.type === "media") {
      fields += `
        <label>Media turi</label>
        <select data-idx="${idx}" data-field="media_kind">
          <option value="photo" ${block.media_kind === "photo" ? "selected" : ""}>🖼 Rasm</option>
          <option value="video" ${block.media_kind === "video" ? "selected" : ""}>🎬 Video</option>
          <option value="document" ${block.media_kind === "document" ? "selected" : ""}>📄 Fayl</option>
        </select>
        <label>Media URL</label>
        ${fieldRow(idx, "media_url", block.media_url, "https://example.com/rasm.jpg")}
      `;
    }

    if (block.type === "sticker") {
      fields += `<label>Stiker file_id</label>${fieldRow(idx, "sticker_file_id", block.sticker_file_id, "CAACAgI...")}`;
    }

    if (block.type === "poll") {
      fields += `
        <label>Savol</label>
        ${fieldRow(idx, "poll_question", block.poll_question, "Qaysi tilni yoqtirasiz?")}
        <label>Variantlar <span style="font-weight:400;opacity:.7">(vergul bilan, kamida 2 ta)</span></label>
        ${fieldRow(idx, "poll_options_raw", (block.poll_options || []).join(", "), "Python, JS, PHP")}
      `;
    }

    if (block.type === "random_reply") {
      fields += `
        <label>Javoblar <span style="font-weight:400;opacity:.7">(har biri "|" bilan ajratilgan, kamida 2 ta)</span></label>
        <textarea data-idx="${idx}" data-field="replies_raw" rows="2" placeholder="Javob 1 | Javob 2 | Javob 3">${(block.replies || []).join(" | ")}</textarea>
      `;
    }

    if (block.type === "ai_reply") {
      fields += `
        <label>Groq API kaliti <span style="font-weight:400;opacity:.7">(console.groq.com dan bepul olinadi)</span></label>
        ${fieldRow(idx, "groq_api_key", block.groq_api_key, "gsk_...")}
        <label>AI xulq-atvori (system prompt)</label>
        <textarea data-idx="${idx}" data-field="system_prompt" rows="3" placeholder="Masalan: Siz do'stona, qisqa javob beruvchi yordamchisiz.">${block.system_prompt || ""}</textarea>
        <label>"Fikrlayapman..." matni <span style="font-weight:400;opacity:.7">(katta task uzoq davom etganda ko'rinadi)</span></label>
        ${fieldRow(idx, "thinking_text", block.thinking_text, "🤔 O'ylayapman...")}
      `;
    }

    if (block.type === "invoice") {
      fields += `
        <label>Mahsulot nomi</label>
        ${fieldRow(idx, "invoice_title", block.invoice_title, "Masalan: Premium")}
        <label>Tavsif</label>
        ${fieldRow(idx, "invoice_description", block.invoice_description, "Masalan: 1 oylik obuna")}
        <label>Narxi (⭐️ Stars)</label>
        <input data-idx="${idx}" data-field="price" type="number" min="1" value="${block.price || 50}">
        <label>To'lovdan keyingi javob</label>
        <textarea data-idx="${idx}" data-field="reply_text" rows="2" placeholder="✅ To'lov qabul qilindi, rahmat!">${block.reply_text || ""}</textarea>
      `;
    }

    if (block.type === "referral") {
      fields += `<p class="hint-block">💡 <code>{referral_link}</code> va <code>{referral_count}</code> ni javob matnida ishlatishingiz mumkin.</p>`;
    }

    if (block.type === "broadcast") {
      fields += `<p class="hint-block">💡 Faqat adminlar ishlata oladi. <code>{count}</code> — nechta kishiga yuborilganini bildiradi.</p>`;
    }

    if (HAS_REPLY_TEXT.has(block.type)) {
      const label = block.type === "media" ? "Sarlavha (ixtiyoriy)" : block.type === "forward_to_admin" ? "Tasdiq matni" : "Javob matni";
      fields += `<label>${label}</label><textarea data-idx="${idx}" data-field="reply_text" rows="2" placeholder="Bot nima javob bersin?">${block.reply_text || ""}</textarea>`;
    }

    if (block.type === "admin_only") {
      fields += `<label>Admin bo'lmasa ko'rsatiladigan matn</label>${fieldRow(idx, "fallback_text", block.fallback_text, "⛔️ Ruxsat yo'q")}`;
    }

    fields += `
      <div class="field-row">
        <div>
          <label>Blok ID</label>
          ${fieldRow(idx, "id", block.id, "b1")}
        </div>
        <div>
          <label>Kechikish (soniya)</label>
          <input data-idx="${idx}" data-field="delay_seconds" type="number" min="0" max="30" value="${block.delay_seconds || 0}">
        </div>
      </div>
    `;

    if (HAS_BUTTONS.has(block.type)) {
      fields += `
        <label>Inline tugmalar</label>
        ${buttonChipsHtml(idx, block)}
        <button class="add-btn-toggle" data-idx="${idx}">➕ Tugma qo'shish</button>
        ${openButtonForm === idx ? buttonFormHtml(idx) : ""}
      `;
    }

    const linkBadge = block._linkedFrom ? `<span class="link-badge">🔗 ${block._linkedFrom}'dan ulangan</span>` : "";

    card.innerHTML = `
      <div class="card-top">
        <span class="card-title">${meta.icon} ${meta.label} ${linkBadge}</span>
        <button class="icon-btn" data-idx="${idx}" data-action="delete">🗑</button>
      </div>
      ${fields}
    `;
    blocksListEl.appendChild(card);
  });

  attachHandlers();
}

function attachHandlers() {
  blocksListEl.querySelectorAll("[data-field]").forEach(el => {
    el.addEventListener("input", onFieldChange);
    el.addEventListener("change", onFieldChange);
  });
  blocksListEl.querySelectorAll("[data-action='delete']").forEach(el => {
    el.addEventListener("click", () => {
      state.blocks.splice(+el.dataset.idx, 1);
      renderBlocks();
    });
  });
  blocksListEl.querySelectorAll("[data-action='delete-button']").forEach(el => {
    el.addEventListener("click", () => {
      const idx = +el.dataset.idx, bIdx = +el.dataset.btnIdx;
      const flat = state.blocks[idx].buttons.flat();
      flat.splice(bIdx, 1);
      state.blocks[idx].buttons = flat.map(b => [b]);
      renderBlocks();
    });
  });
  blocksListEl.querySelectorAll(".add-btn-toggle").forEach(el => {
    el.addEventListener("click", () => {
      openButtonForm = openButtonForm === +el.dataset.idx ? null : +el.dataset.idx;
      renderBlocks();
    });
  });
  blocksListEl.querySelectorAll(".btn-form-cancel").forEach(el => {
    el.addEventListener("click", () => { openButtonForm = null; renderBlocks(); });
  });
  blocksListEl.querySelectorAll(".btn-form").forEach(setupButtonForm);
}

function setupButtonForm(formEl) {
  const idx = +formEl.dataset.idx;
  let selectedColor = "none";
  let selectedAction = "message";

  formEl.querySelectorAll(".color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      formEl.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      sw.classList.add("selected");
      selectedColor = sw.dataset.color;
    });
  });

  formEl.querySelectorAll(".action-btn").forEach(ab => {
    ab.addEventListener("click", () => {
      formEl.querySelectorAll(".action-btn").forEach(a => a.classList.remove("selected"));
      ab.classList.add("selected");
      selectedAction = ab.dataset.actionType;
      formEl.querySelectorAll(".action-fields").forEach(af => {
        af.style.display = af.dataset.actionFields === selectedAction ? "block" : "none";
      });
    });
  });

  formEl.querySelector(".btn-form-confirm").addEventListener("click", () => {
    const get = (f) => formEl.querySelector(`[data-form-field="${f}"]`)?.value?.trim() || "";
    const name = get("text");
    if (!name) return;

    const color = COLOR_MAP[selectedColor]; // "primary" | "success" | "danger" | undefined
    const parentBlock = state.blocks[idx];
    let newBtn;

    if (selectedAction === "link") {
      const url = get("url");
      if (!url) return;
      newBtn = { text: name, url, ...(color && { color }) };
    } else if (selectedAction === "media") {
      const kind = formEl.querySelector('[data-form-field="media_kind"]').value;
      const url = get("media_url");
      if (!url) return;
      const linked = newBlock("media", { linkedFrom: parentBlock.id, media_kind: kind, media_url: url });
      state.blocks.push(linked);
      newBtn = { text: name, goto: linked.id, ...(color && { color }) };
    } else if (selectedAction === "newmenu") {
      const linked = newBlock("button", { linkedFrom: parentBlock.id });
      state.blocks.push(linked);
      newBtn = { text: name, goto: linked.id, ...(color && { color }) };
    } else {
      const replyText = get("reply_text");
      if (!replyText) return;
      const linked = newBlock("button", { linkedFrom: parentBlock.id, reply_text: replyText });
      state.blocks.push(linked);
      newBtn = { text: name, goto: linked.id, ...(color && { color }) };
    }

    parentBlock.buttons = [...(parentBlock.buttons || []), [newBtn]];
    openButtonForm = null;
    renderBlocks();
  });
}

function onFieldChange(e) {
  const idx = +e.target.dataset.idx;
  const field = e.target.dataset.field;
  const block = state.blocks[idx];

  if (field === "poll_options_raw") {
    block.poll_options = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
    return;
  }
  if (field === "replies_raw") {
    block.replies = e.target.value.split("|").map(s => s.trim()).filter(Boolean);
    return;
  }
  if (field === "delay_seconds") {
    block[field] = Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0));
    return;
  }
  if (field === "price") {
    block[field] = Math.max(1, parseInt(e.target.value, 10) || 1);
    return;
  }
  block[field] = e.target.value;
}

document.querySelectorAll(".type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.blocks.push(newBlock(btn.dataset.type));
    renderBlocks();
    blocksListEl.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

document.getElementById("token-input").addEventListener("input", (e) => {
  state.token = e.target.value.trim();
});

// ---- Force-join settings ----
const forceJoinToggle = document.getElementById("force-join-toggle");
const forceJoinFields = document.getElementById("force-join-fields");
const forceJoinChannel = document.getElementById("force-join-channel");
const forceJoinText = document.getElementById("force-join-text");

forceJoinToggle.addEventListener("change", () => {
  state.forceJoin.enabled = forceJoinToggle.checked;
  forceJoinFields.style.display = forceJoinToggle.checked ? "block" : "none";
});
forceJoinChannel.addEventListener("input", (e) => { state.forceJoin.channel = e.target.value.trim(); });
forceJoinText.addEventListener("input", (e) => { state.forceJoin.text = e.target.value.trim(); });

document.getElementById("storage-chat-id").addEventListener("input", (e) => {
  state.storageChatId = e.target.value.trim();
});

function buildSpec() {
  const cleanBlocks = state.blocks.map(({ _linkedFrom, ...b }) => b);
  const spec = { blocks: cleanBlocks, admin_ids: [tg.initDataUnsafe.user.id] };
  if (state.forceJoin.enabled && state.forceJoin.channel) {
    spec.force_join = {
      channel_username: state.forceJoin.channel,
      not_subscribed_text: state.forceJoin.text || "Botdan foydalanish uchun avval kanalga obuna bo'ling:",
    };
  }
  if (state.storageChatId) {
    const parsed = parseInt(state.storageChatId, 10);
    if (!isNaN(parsed)) spec.storage_chat_id = parsed;
  }
  return spec;
}

function resetConstructor() {
  state = { bot_id: null, token: "", blocks: [], forceJoin: { enabled: false, channel: "", text: "" }, storageChatId: "" };
  document.getElementById("token-input").value = "";
  document.getElementById("token-section").style.display = "block";
  forceJoinToggle.checked = false;
  forceJoinFields.style.display = "none";
  forceJoinChannel.value = "";
  forceJoinText.value = "";
  document.getElementById("storage-chat-id").value = "";
  document.getElementById("editing-banner").style.display = "none";
  document.getElementById("deploy-btn").textContent = "🚀 Botni ishga tushirish";
  state.blocks.push({ ...newBlock("command"), id: "b1", reply_text: "Salom! 👋" });
  renderBlocks();
}

function loadBotForEditing(bot) {
  state = {
    bot_id: bot.id,
    token: "",
    blocks: bot.spec.blocks.map(b => ({ ...b, _linkedFrom: null })),
    forceJoin: bot.spec.force_join
      ? { enabled: true, channel: bot.spec.force_join.channel_username, text: bot.spec.force_join.not_subscribed_text }
      : { enabled: false, channel: "", text: "" },
    storageChatId: bot.spec.storage_chat_id ? String(bot.spec.storage_chat_id) : "",
  };
  blockCounter = state.blocks.length;

  document.getElementById("token-section").style.display = "none";
  forceJoinToggle.checked = state.forceJoin.enabled;
  forceJoinFields.style.display = state.forceJoin.enabled ? "block" : "none";
  forceJoinChannel.value = state.forceJoin.channel;
  forceJoinText.value = state.forceJoin.text;
  document.getElementById("storage-chat-id").value = state.storageChatId;

  document.getElementById("editing-banner").style.display = "flex";
  document.getElementById("editing-bot-name").textContent = bot.username ? `@${bot.username}` : `Bot #${bot.id}`;
  document.getElementById("deploy-btn").textContent = "💾 Yangilash";

  switchTab("constructor");
  renderBlocks();
}

document.getElementById("cancel-edit-btn").addEventListener("click", resetConstructor);

document.getElementById("deploy-btn").addEventListener("click", async () => {
  if (!state.blocks.length) return setStatus("⚠️ Kamida bitta blok qo'shing.", true);

  const spec = buildSpec();

  if (state.bot_id) {
    // ---- Edit mode: update existing bot's spec ----
    setStatus("⏳ Yangilanmoqda...");
    try {
      const res = await fetch(`${API}/api/bots/${state.bot_id}/spec`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ spec }),
      });
      const data = await res.json();
      if (!res.ok) return setStatus(`❌ ${data.error}`, true);
      setStatus("✅ Bot yangilandi!");
      await refreshMyBots();
    } catch (err) {
      setStatus(`❌ Xatolik: ${err.message}`, true);
    }
    return;
  }

  // ---- Create mode ----
  if (!state.token) return setStatus("⚠️ Avval BOT_TOKEN kiriting.", true);
  setStatus("⏳ Yuborilmoqda...");
  try {
    const res = await fetch(`${API}/api/bots`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ token: state.token, spec }),
    });
    const data = await res.json();
    if (!res.ok) return setStatus(`❌ ${data.error}`, true);

    state.bot_id = data.bot_id;
    await fetch(`${API}/api/bots/${data.bot_id}/toggle`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ active: true }),
    });
    setStatus(`✅ Bot ishga tushdi! (@${data.bot_info.username})`);
    await refreshMyBots();
  } catch (err) {
    setStatus(`❌ Xatolik: ${err.message}`, true);
  }
});

// ---- Tab switcher ----
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tab-constructor").style.display = tab === "constructor" ? "block" : "none";
  document.getElementById("tab-mybots").style.display = tab === "mybots" ? "block" : "none";
  document.getElementById("tab-admin").style.display = tab === "admin" ? "block" : "none";
  document.getElementById("deploy-bar").style.display = tab === "constructor" ? "block" : "none";
  if (tab === "mybots") refreshMyBots();
  if (tab === "admin") refreshAdminStats();
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ---- My Bots panel ----
const myBotsListEl = document.getElementById("mybots-list");
const myBotsEmptyEl = document.getElementById("mybots-empty");

async function refreshMyBots() {
  try {
    const res = await fetch(`${API}/api/bots`, { headers: authHeaders() });
    const data = await res.json();
    myBotsCache = data.bots || [];
    renderMyBots();
  } catch (err) {
    myBotsListEl.innerHTML = `<p class="hint-block">❌ Ro'yxatni yuklab bo'lmadi: ${err.message}</p>`;
  }
}

function renderMyBots() {
  myBotsEmptyEl.classList.toggle("visible", myBotsCache.length === 0);
  myBotsListEl.innerHTML = myBotsCache.map(bot => `
    <div class="bot-card">
      <div class="bot-info">
        <span class="bot-name">${bot.username ? "@" + bot.username : "Bot #" + bot.id}</span>
        <span class="bot-status">${bot.active ? "🟢 Faol" : "⚪️ To'xtatilgan"} · ${bot.spec.blocks.length} blok</span>
      </div>
      <div class="bot-actions">
        <label class="switch">
          <input type="checkbox" data-bot-id="${bot.id}" data-action="toggle" ${bot.active ? "checked" : ""}>
          <span class="slider"></span>
        </label>
        <button class="icon-btn" data-bot-id="${bot.id}" data-action="edit">✏️</button>
        <button class="icon-btn" data-bot-id="${bot.id}" data-action="delete-bot">🗑</button>
      </div>
    </div>
  `).join("");

  myBotsListEl.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener("change", async () => {
      const botId = el.dataset.botId;
      try {
        await fetch(`${API}/api/bots/${botId}/toggle`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ active: el.checked }),
        });
        await refreshMyBots();
      } catch (err) {
        el.checked = !el.checked;
      }
    });
  });

  myBotsListEl.querySelectorAll('[data-action="edit"]').forEach(el => {
    el.addEventListener("click", () => {
      const bot = myBotsCache.find(b => b.id === el.dataset.botId);
      if (bot) loadBotForEditing(bot);
    });
  });

  myBotsListEl.querySelectorAll('[data-action="delete-bot"]').forEach(el => {
    el.addEventListener("click", async () => {
      const botId = el.dataset.botId;
      await fetch(`${API}/api/bots/${botId}`, { method: "DELETE", headers: authHeaders() });
      await refreshMyBots();
    });
  });
}

// ---- Admin panel ----
const adminContentEl = document.getElementById("admin-content");

async function refreshAdminStats() {
  adminContentEl.innerHTML = `<p class="hint-block">⏳ Yuklanmoqda...</p>`;
  try {
    const res = await fetch(`${API}/api/admin/stats`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      adminContentEl.innerHTML = `<p class="hint-block">🔒 ${data.error || "Ruxsat yo'q"}</p>`;
      return;
    }
    renderAdminStats(data);
  } catch (err) {
    adminContentEl.innerHTML = `<p class="hint-block">❌ Yuklab bo'lmadi: ${err.message}</p>`;
  }
}

function renderAdminStats(stats) {
  const { products, bots } = stats;

  const summaryCards = `
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-value">${bots.total}</span><span class="stat-label">Jami botlar</span></div>
      <div class="stat-card"><span class="stat-value">${bots.active}</span><span class="stat-label">Faol botlar</span></div>
      <div class="stat-card"><span class="stat-value">${products.total}</span><span class="stat-label">Mahsulotlar</span></div>
      <div class="stat-card"><span class="stat-value">⭐️${products.total_stars_earned}</span><span class="stat-label">Jami tushum</span></div>
    </div>
  `;

  const topProducts = products.top.length ? `
    <h3>🏆 Eng ko'p sotilgan</h3>
    <div class="admin-list">
      ${products.top.map(p => `
        <div class="admin-row">
          <span>${p.title}</span>
          <span class="admin-row-meta">⭐️${p.price} · ${p.sales} sotildi</span>
        </div>
      `).join("")}
    </div>
  ` : "";

  const botsList = bots.list.length ? `
    <h3>🤖 Barcha botlar</h3>
    <div class="admin-list">
      ${bots.list.map(b => `
        <div class="admin-row">
          <span>${b.username ? "@" + b.username : "Bot #" + b.id} <small>(egasi: ${b.owner_id})</small></span>
          <span class="admin-row-meta">${b.active ? "🟢" : "⚪️"} ${b.block_count} blok</span>
        </div>
      `).join("")}
    </div>
  ` : `<p class="hint-block">Hali bot yaratilmagan.</p>`;

  adminContentEl.innerHTML = summaryCards + topProducts + botsList;
}

// start with one example block
state.blocks.push({ ...newBlock("command"), id: "b1", reply_text: "Salom! 👋" });
blockCounter = 1;
renderBlocks();
