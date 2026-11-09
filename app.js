// Gojo Bar stock control. Author: Tewele B.
// Data lives in Firebase Firestore; the page is static and can be hosted on GitHub Pages.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, BAR_ID, ADMIN_EMAILS } from "./firebase-config.js";

const ST = { cfg: null, sales: {}, issues: {}, cash: {}, ready: { cfg: false, sales: false, issues: false, cash: false }, pending: {} };
const UI = { tab: "sales", edit: null, stockOpen: null, moneyAll: false, moneyEdit: null, givenAll: false };
let fdb = null, auth = null, user = null, unsubs = [];
const isAdmin = () => !!(user && (ADMIN_EMAILS || []).map(e => e.toLowerCase()).includes(String(user.email || "").toLowerCase()));
const ADMIN_ONLY = "Only the admin can delete or change this.";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
function today() { const t = new Date(); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); }
function addDays(iso, n) { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function fmtDate(iso, long) {
  if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", long ? { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" } : { timeZone: "UTC", day: "numeric", month: "short" });
}
function daysBetween(a, b) { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5); }
const nf = (v, dp) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: dp == null ? 0 : dp });
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function num(v) { if (v === "" || v == null) return null; const x = parseFloat(String(v).replace(/,/g, "")); return isNaN(x) ? null : x; }
const mk = iso => iso.slice(0, 7);
const clone = o => JSON.parse(JSON.stringify(o || {}));
let toastT; function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600); }
function short(n) { return String(n).replace("Draft - Single", "Draft single").replace("Draft - Jambo", "Draft jambo"); }

/* ---------- data access ---------- */
function items() { return ST.cfg && ST.cfg.items ? ST.cfg.items : []; }
function days() { const m = {}; for (const k in ST.sales) { const d = (ST.sales[k] && ST.sales[k].days) || {}; for (const x in d) m[x] = d[x]; } return m; }
function cashDays() { const m = {}; for (const k in ST.cash) { const d = (ST.cash[k] && ST.cash[k].days) || {}; for (const x in d) m[x] = d[x]; } return m; }
function issues() {
  const a = []; for (const k in ST.issues) { const it = (ST.issues[k] && ST.issues[k].items) || {}; for (const id in it) a.push(Object.assign({ id, month: k }, it[id])); }
  a.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : (x.id < y.id ? -1 : 1)); return a;
}
function priceOf(day, n) { if (day && day.p && day.p[n] != null) return +day.p[n]; const it = items().find(i => i.name === n); return it ? +it.price || 0 : 0; }
function dayValue(day) { if (!day) return 0; let v = 0; const q = day.q || {}; for (const n in q) v += (+q[n] || 0) * priceOf(day, n); return v; }

/* ---------- calculations ---------- */
function stock() {
  const D = days(), I = issues(), sold = {}, given = {};
  for (const d in D) { const q = D[d].q || {}; for (const n in q) sold[n] = (sold[n] || 0) + (+q[n] || 0); }
  for (const e of I) given[e.item] = (given[e.item] || 0) + (+e.qty || 0);
  const rows = items().map(it => ({ it, open: +it.opening || 0, given: given[it.name] || 0, sold: sold[it.name] || 0, soldBase: (sold[it.name] || 0) / (+it.upb || 1) }));
  const g = {}; for (const r of rows) { const k = r.it.group || r.it.name; g[k] = g[k] || { t: 0, s: 0 }; g[k].t += r.open + r.given; g[k].s += r.soldBase; }
  for (const r of rows) {
    const gg = g[r.it.group || r.it.name]; r.bal = Math.round((gg.t - gg.s) * 100) / 100; r.balSU = r.bal * (+r.it.upb || 1); r.reorder = +r.it.reorder || 0;
    r.status = r.bal < 0 ? "check" : r.bal === 0 ? "out" : r.bal <= r.reorder ? "low" : "ok";
  }
  return rows;
}
function draft() {
  const its = items(), si = its.find(i => i.name === "Draft - Single"), ji = its.find(i => i.name === "Draft - Jambo"); if (!si) return null;
  const spb = +si.upb || 120, perJ = ji ? spb / (+ji.upb || 60) : 2;
  const OP = Math.round(((+si.opening || 0) + (ji ? (+ji.opening || 0) : 0)) * spb * 100) / 100;
  const D = days(), keys = Object.keys(D).sort(), start = (ST.cfg && ST.cfg.start) || keys[0] || today();
  let end = today(); if (keys.length && keys[keys.length - 1] > end) end = keys[keys.length - 1];
  const series = []; let cum = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) { const q = (D[d] && D[d].q) || {}; const s = (+q["Draft - Single"] || 0) + (+q["Draft - Jambo"] || 0) * perJ; const prev = cum; cum += s; series.push({ d, s, prev, cum }); }
  const T = cum, gl = []; let gTot = 0;
  for (const e of issues().filter(e => e.item === "Draft - Single")) { const q = +e.qty || 0; gTot += q; for (let i = 0; i < Math.floor(q); i++) gl.push(e.d); }
  gl.sort();
  const givenCount = 1 + gTot, touched = T <= OP ? 1 : 1 + Math.ceil((T - OP) / spb - 1e-9), n = Math.max(Math.round(givenCount), touched);
  const fin = c => c < OP ? 0 : 1 + Math.floor((c - OP) / spb + 1e-9);
  const list = [];
  for (let k = 1; k <= n; k++) {
    const S = k === 1 ? 0 : OP + (k - 2) * spb, E = OP + (k - 1) * spb, givenOn = k === 1 ? "open" : (gl[k - 2] || null);
    let finishedOn = null; if (T >= E) { const x = series.find(r => r.cum >= E); finishedOn = x ? x.d : null; }
    const sold = Math.max(0, Math.min(T, E) - S), left = E - S - sold;
    let status; if (T >= E) status = givenOn ? "finished" : "check"; else if (T > S) status = givenOn ? "selling" : "check"; else status = "full";
    list.push({ k, givenOn, finishedOn, sold, left, cap: E - S, status });
  }
  const events = {}; for (const r of series) { const a = fin(r.prev), b = fin(r.cum); if (b > a) { events[r.d] = []; for (let j = a + 1; j <= b; j++) events[r.d].push(j); } }
  const cur = list.find(b => b.status === "selling") || list.find(b => b.status === "full") || null;
  return { spb, perJ, OP, T, list, events, cur, finished: list.filter(b => b.status === "finished").length, givenCount, problems: list.filter(b => b.status === "check").length };
}
function cashBook() {
  const C = cashDays(), D = days(), o = (ST.cfg && ST.cfg.cashOpen) || { date: (ST.cfg && ST.cfg.start) || today(), balance: 0 };
  const keys = Object.keys(C).concat(Object.keys(D)).sort(); let end = today(); if (keys.length && keys[keys.length - 1] > end) end = keys[keys.length - 1];
  const stock = {}; // deliveries marked "paid from bar money" reduce the balance automatically
  for (const e of issues()) if (e.pay && +e.cost) { const s = stock[e.d] = stock[e.d] || { amt: 0, list: [] }; s.amt += +e.cost; s.list.push(`${e.item === "Draft - Single" ? "Draft" : e.item} ${nf(e.qty, 2)} (${nf(e.cost)})`); }
  for (const d in stock) if (d > end) end = d;
  const rows = []; let bal = +o.balance || 0; rows.push({ d: o.date, sales: 0, other: 0, paid: 0, bal, remark: "Opening balance", open: true });
  for (let d = addDays(o.date, 1); d <= end; d = addDays(d, 1)) {
    const c = C[d] || {}, s = dayValue(D[d]), oth = +c.other || 0, manual = +c.paid || 0, st = stock[d] || { amt: 0, list: [] }, paid = manual + st.amt; bal += s + oth - paid;
    rows.push({ d, sales: s, other: oth, paid, manual, stockPaid: st.amt, stockList: st.list.join(", "), bal, remark: c.remark || "", otherNote: c.otherNote || "", has: !!(C[d] || D[d] || stock[d]) });
  }
  return rows;
}

/* ---------- writes (saved on the phone first, sent to the cloud when online) ---------- */
function ref(path) { return doc(fdb, "bars", BAR_ID, ...path.split("/")); }
function write(path, data) {
  return setDoc(ref(path), clone(data)).catch(e => {
    if (e && e.code === "permission-denied") toast(ADMIN_ONLY);
    else toast("Not saved: " + (e && e.message ? e.message : "unknown error"));
  });
}

/* ---------- views ---------- */
function statusPill(s) {
  return {
    ok: '<span class="pill ok">OK</span>', low: '<span class="pill low">Re-order</span>', out: '<span class="pill bad">Out of stock</span>',
    check: '<span class="pill bad">Check</span>', finished: '<span class="pill plain">Finished</span>', selling: '<span class="pill honey">Selling now</span>',
    full: '<span class="pill ok">Full, not opened</span>'
  }[s] || "";
}
function loadEdit(date) { const day = days()[date] || null; UI.edit = { date, q: Object.assign({}, (day && day.q) || {}), cbe: day && day.cbe != null ? day.cbe : "", cash: day && day.cash != null ? day.cash : "", dirty: false, day }; }
function editPrice(n) { return priceOf(UI.edit.day, n); }
function editTotals() {
  const e = UI.edit; let v = 0; for (const n in e.q) v += (num(e.q[n]) || 0) * editPrice(n);
  const cbe = num(e.cbe), cash = num(e.cash); return { v, rec: (cbe || 0) + (cash || 0), diff: cash == null ? null : (cbe || 0) + cash - v };
}

function viewSales() {
  if (!UI.edit) loadEdit(today());
  const e = UI.edit, dr = draft(), ev = dr && dr.events[e.date];
  let h = `<div class="datebar"><button class="iconbtn" data-act="prevday" aria-label="Previous day">‹</button>
    <input type="date" id="saledate" value="${e.date}" aria-label="Date"><button class="iconbtn" data-act="nextday" aria-label="Next day">›</button></div>`;
  if (ev) h += `<div class="banner honey"><b>Bermil ${ev.join(" and ")} finished on this day.</b> The barman should get the next bermil.</div>`;
  if (dr && dr.cur && e.date === today()) h += `<div class="banner info">Bermil in use: <b>No. ${dr.cur.k}</b>, ${nf(dr.cur.left)} singles left.</div>`;
  h += `<h2>${fmtDate(e.date, true)}</h2><div class="panel">`;
  for (const it of items()) {
    const v = e.q[it.name] == null ? "" : e.q[it.name];
    h += `<div class="row"><div class="grow"><div class="name">${esc(short(it.name))}</div><div class="sub">${esc(it.su)}, ${nf(editPrice(it.name))} Birr</div></div>
      <div class="step"><button data-act="minus" data-n="${esc(it.name)}" aria-label="Less ${esc(it.name)}">−</button>
      <input inputmode="decimal" data-q="${esc(it.name)}" value="${esc(v)}" aria-label="${esc(it.name)} sold">
      <button data-act="plus" data-n="${esc(it.name)}" aria-label="More ${esc(it.name)}">+</button></div></div>`;
  }
  h += `</div><h3>Money received</h3><div class="panel form"><div class="two">
      <label>CBE / TeleBirr (Birr)<input inputmode="decimal" data-m="cbe" value="${esc(e.cbe)}"></label>
      <label>Cash in hand (Birr)<input inputmode="decimal" data-m="cash" value="${esc(e.cash)}"></label></div></div>
    <div class="panel totals" id="saletotals"></div>
    <div class="savebar"><button class="btn" data-act="saveday" id="savebtn">Save day</button></div>`;
  return h;
}
function paintTotals() {
  const el = $("#saletotals"); if (!el || !UI.edit) return; const t = editTotals();
  el.innerHTML = `<div class="row"><div class="grow">Sales value</div><div class="num">${nf(t.v)} Birr</div></div>
   <div class="row"><div class="grow">Received</div><div class="num">${nf(t.rec)} Birr</div></div>
   <div class="row"><div class="grow">Difference${t.diff == null ? '<div class="sub">Type cash in hand to see it</div>' : ""}</div>
   <div class="num ${t.diff == null ? "" : t.diff < 0 ? "diff-neg" : "diff-pos"}">${t.diff == null ? "" : nf(t.diff) + " Birr"}</div></div>`;
  const b = $("#savebtn"); if (b) b.textContent = UI.edit.dirty ? "Save day" : "Saved";
}

function viewStock() {
  const rows = stock().filter(r => r.it.name !== "Draft - Jambo");
  const bad = rows.filter(r => r.status === "check" || r.status === "out").length, low = rows.filter(r => r.status === "low").length;
  let h = `<h2>What the barman must have</h2>`;
  if (bad || low) h += `<div class="banner ${bad ? "bad" : "honey"}">${bad ? bad + " item(s) need checking or are out of stock. " : ""}${low ? low + " item(s) to re-order." : ""}</div>`;
  h += `<div class="panel">`;
  for (const r of rows) {
    const it = r.it, isD = it.name === "Draft - Single", open = UI.stockOpen === it.name;
    const unit = isD ? "bermil" : String(it.base).toLowerCase(), main = `${nf(r.bal, 2)} ${esc(unit)}`;
    const extra = (+it.upb !== 1 && !isD) ? `<div class="sub">${nf(r.balSU)} ${esc(String(it.su).toLowerCase())}</div>` : (isD ? `<div class="sub">${nf(r.bal * (+it.upb || 120))} singles</div>` : "");
    h += `<div class="row" data-act="openstock" data-n="${esc(it.name)}" style="cursor:pointer"><div class="grow"><div class="name">${isD ? "Draft" : esc(it.name)}</div>
      <div class="sub">Given ${nf(r.open + r.given, 2)}, sold ${nf(r.soldBase, 2)}</div></div><div class="num">${main}${extra}</div>${statusPill(r.status)}</div>`;
    if (open) h += `<div class="form" style="border-top:1px solid var(--line)">
        <label>Counted now (${esc(unit)})<input inputmode="decimal" id="countin" data-bal="${r.bal}" data-unitval="${(+it.upb || 1) * (+it.price || 0)}"></label>
        <div id="countres" class="sub">Count the stock and type the number.</div>
        <button class="btn secondary" data-act="savecount" data-n="${esc(it.name)}">Save count as correction</button>
        <div class="sub">This adds a correction in Given, so the balance starts again from your count.</div></div>`;
  }
  return h + `</div><p class="sub">Tap an item to type a physical count. Check means more was sold than given: look for a missing delivery.</p>`;
}

function viewDraft() {
  const d = draft(); if (!d) return `<div class="empty">No draft items set up.</div>`;
  const c = d.cur, pct = c ? Math.max(0, Math.min(100, c.left / c.cap * 100)) : 0;
  let h = `<h2>Draft</h2><div class="panel"><div class="kegwrap"><div class="keg" aria-hidden="true"><div class="fill" style="height:${pct}%"></div></div>
    <div class="kegtext">${c ? `<div class="sub">Bermil in use</div><div class="mid">No. ${c.k}${c.givenOn && c.givenOn !== "open" ? ", given " + fmtDate(c.givenOn) : ""}</div>
      <div class="big">${nf(c.left)}</div><div class="sub">singles left in it (of ${nf(c.cap)})</div>`
      : `<div class="mid">All bermils finished</div><div class="sub">Give the next bermil and add it in Given.</div>`}</div></div>
    <div class="row"><div class="grow">Bermils given</div><div class="num">${nf(d.givenCount, 2)}</div></div>
    <div class="row"><div class="grow">Bermils finished</div><div class="num">${d.finished}</div></div>
    <div class="row"><div class="grow">Sold so far, in singles</div><div class="num">${nf(d.T)}</div></div></div>`;
  if (d.problems) h += `<div class="banner bad">${d.problems} bermil(s) were sold but are not in Given. Add the missing bermil.</div>`;
  h += `<p class="sub">1 bermil = ${nf(d.spb)} singles. 1 jambo = ${nf(d.perJ, 2)} singles. Bermil 1 was already open when records started.</p><h3>Bermil by bermil</h3><div class="panel">`;
  for (const b of d.list.slice().reverse()) {
    const g = b.givenOn === "open" ? "Open before records" : b.givenOn ? "Given " + fmtDate(b.givenOn) : "Not in Given";
    const f = b.finishedOn ? `, finished ${fmtDate(b.finishedOn)}` + (b.givenOn && b.givenOn !== "open" ? ` (${daysBetween(b.givenOn, b.finishedOn) + 1} days)` : "") : b.status === "selling" ? `, ${nf(b.left)} singles left` : "";
    h += `<div class="row"><div class="grow"><div class="name">Bermil ${b.k}</div><div class="sub">${g}${f}</div></div>${statusPill(b.status)}</div>`;
  }
  return h + `</div>`;
}

function viewGiven() {
  const t = today(), all = issues(), I = all.slice().reverse(), lastD = all.filter(e => e.item === "Draft - Single" && e.cost).pop();
  let h = `<h2>Stock given to the barman</h2>
   <button class="btn" data-act="quickkeg" style="margin-bottom:12px">Add 1 bermil of draft today${lastD ? " (" + nf(lastD.cost) + " Birr)" : ""}</button>
   <div class="panel form"><label>Date<input type="date" id="g_d" value="${t}"></label>
    <label>Item<select id="g_item">${items().filter(i => i.name !== "Draft - Jambo").map(i => `<option value="${esc(i.name)}">${esc(i.name === "Draft - Single" ? "Draft (bermil)" : i.name)}</option>`).join("")}</select></label>
    <div class="two"><label>Quantity (<span id="g_unit">${esc(items()[0] ? items()[0].base : "")}</span>)<input inputmode="decimal" id="g_q"></label>
    <label>Cost paid (Birr)<input inputmode="decimal" id="g_c"></label></div>
    <label>Note<input id="g_n" placeholder="Optional"></label>
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="g_pay" checked style="width:auto"> Paid from bar money (the cost is taken off the Money balance)</label>
    <button class="btn" data-act="addgiven">Add</button></div><h3>History</h3><div class="panel">`;
  if (!I.length) h += `<div class="empty">Nothing given yet. Add the first delivery above.</div>`;
  let last = "";
  for (const e of I.slice(0, UI.givenAll ? I.length : 40)) {
    if (e.d !== last) { h += `<div class="row" style="background:var(--tint)"><b>${fmtDate(e.d, true)}</b></div>`; last = e.d; }
    const it = items().find(i => i.name === e.item), unit = it ? (it.name === "Draft - Single" ? "bermil" : String(it.base).toLowerCase()) : "";
    h += `<div class="row"><div class="grow"><div class="name">${esc(e.item === "Draft - Single" ? "Draft" : e.item)}</div>${e.note ? `<div class="sub">${esc(e.note)}</div>` : ""}</div>
      <div class="num">${nf(e.qty, 2)} ${esc(unit)}${e.cost ? `<div class="sub">${nf(e.cost)} Birr${e.pay ? ", from money" : ""}</div>` : ""}</div>
      ${isAdmin() ? `<button class="iconbtn" data-act="delgiven" data-id="${e.id}" data-m="${e.month}" aria-label="Delete">Delete</button>` : ""}</div>`;
  }
  h += `</div>`; if (!UI.givenAll && I.length > 40) h += `<button class="linkish" data-act="givenall">Show all ${I.length}</button>`;
  return h;
}

function viewMoney() {
  const rows = cashBook(), t = today(), lastRow = rows.filter(r => r.d <= t).pop() || rows[rows.length - 1];
  const bc = (ST.cfg && ST.cfg.bankCheck) || { date: t, bank: "", cash: "" }, bookAt = (rows.find(r => r.d === bc.date) || {}).bal;
  const diff = (num(bc.bank) != null && bookAt != null) ? (num(bc.bank) + (num(bc.cash) || 0) - bookAt) : null;
  let h = `<h2>Money</h2><div class="panel"><div class="kegwrap"><div class="kegtext"><div class="sub">CBE balance on the book, ${fmtDate(lastRow.d)}</div><div class="big">${nf(lastRow.bal)}</div><div class="sub">Birr</div></div></div></div>
   <h3>Add money paid out</h3><div class="panel form"><div class="two"><label>Date<input type="date" id="p_d" value="${t}"></label>
     <label>Amount (Birr)<input inputmode="decimal" id="p_a"></label></div><label>What for<input id="p_n" placeholder="For example: salary, rent, repair"></label>
     <div class="sub">Stock you buy for the bar goes in <b>Given</b> with its cost. It is taken off the money automatically, so don’t add it here too.</div>
     <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="p_in" style="width:auto"> This is money in, not sales</label>
     <button class="btn" data-act="addpay">Add</button></div>
   <h3>Bank check</h3><div class="panel form"><div class="two"><label>Date<input type="date" id="b_d" value="${esc(bc.date)}"></label>
     <label>Real CBE balance<input inputmode="decimal" id="b_b" value="${esc(bc.bank == null ? "" : bc.bank)}"></label></div>
     <label>Cash in hand<input inputmode="decimal" id="b_c" value="${esc(bc.cash == null ? "" : bc.cash)}"></label>
     <div class="row" style="padding:4px 0"><div class="grow">Book balance that day</div><div class="num">${bookAt == null ? "" : nf(bookAt)}</div></div>
     <div class="row" style="padding:4px 0"><div class="grow"><b>Difference</b></div><div class="num ${diff == null ? "" : diff < 0 ? "diff-neg" : "diff-pos"}">${diff == null ? "" : nf(diff) + " Birr"}</div></div>
     ${isAdmin() ? '<button class="btn secondary" data-act="savebank">Save check</button>' : '<div class="sub">Only the admin can save the bank check.</div>'}</div><h3>Day by day</h3><div class="panel">`;
  const list = rows.filter(r => r.has || r.open).reverse(), show = UI.moneyAll ? list : list.slice(0, 30);
  for (const r of show) {
    h += `<div class="row" data-act="editmoney" data-d="${r.d}" style="cursor:pointer"><div class="grow"><div class="name">${fmtDate(r.d, true)}</div>
      <div class="sub">${r.open ? "Opening balance" : `Sales ${nf(r.sales)}${r.other ? ", in " + nf(r.other) : ""}${r.paid ? ", paid " + nf(r.paid) : ""}`}${r.stockList ? `<br>Stock: ${esc(r.stockList)}` : ""}${r.remark && !r.open ? `<br>${esc(r.remark)}` : ""}${r.otherNote ? `<br>${esc(r.otherNote)}` : ""}</div></div><div class="num">${nf(r.bal)}</div></div>`;
    if (UI.moneyEdit === r.d && !r.open) {
      const c = cashDays()[r.d] || {};
      h += `<div class="form" style="border-top:1px solid var(--line)">${r.stockPaid ? `<div class="sub">Stock paid this day from Given: ${nf(r.stockPaid)} Birr (change it in Given).</div>` : ""}<div class="two"><label>Other paid out<input inputmode="decimal" id="e_p" value="${esc(c.paid == null ? "" : c.paid)}"></label>
       <label>Money in, not sales<input inputmode="decimal" id="e_o" value="${esc(c.other == null ? "" : c.other)}"></label></div>
       <label>What for<input id="e_r" value="${esc(c.remark || "")}"></label><label>Money in note<input id="e_on" value="${esc(c.otherNote || "")}"></label>
       <button class="btn" data-act="savemoney" data-d="${r.d}">Save</button></div>`;
    }
  }
  h += `</div>`; if (!UI.moneyAll && list.length > 30) h += `<button class="linkish" data-act="moneyall">Show all days</button>`;
  return h + `<p class="sub">Sales come in by themselves from the Sales page. Tap a day to change what was paid.</p>`;
}

function viewSetup() {
  const ad = isAdmin(), dis = ad ? "" : " disabled";
  let h = `<h2>Prices and re-order levels</h2><p class="sub">${ad ? "A new price applies to days you save from now on. Days already saved keep their old price." : "Only the admin can change prices and re-order levels."}</p><div class="panel">`;
  for (const it of items()) {
    const isD = it.name === "Draft - Single", unit = isD ? "bermil" : String(it.base).toLowerCase();
    h += `<div class="row"><div class="grow"><div class="name">${esc(short(it.name))}</div><div class="sub">Price per ${esc(String(it.su).toLowerCase())}, re-order at (${esc(unit)})</div></div>
      <input inputmode="decimal" data-price="${esc(it.name)}" value="${esc(it.price)}" style="width:80px" aria-label="Price ${esc(it.name)}"${dis}>
      ${it.name === "Draft - Jambo" ? '<span style="width:64px"></span>' : `<input inputmode="decimal" data-reorder="${esc(it.name)}" value="${esc(it.reorder)}" style="width:64px" aria-label="Re-order level ${esc(it.name)}"${dis}>`}</div>`;
  }
  h += `</div>${ad ? '<button class="btn" data-act="saveitems">Save prices</button>' : ""}
    <h3>Backup</h3><div class="panel form">
      <button class="btn secondary" data-act="exportxlsx">Export to Excel</button>
      <button class="btn secondary" data-act="exportjson">Download full backup</button>
      <div class="sub">Do a backup at the end of each month and keep the file safe.</div></div>
    <h3>Account</h3><div class="panel form"><div class="sub">Signed in as ${esc(user ? user.email : "")}${ad ? " (admin)" : ""}</div>
      <button class="btn secondary" data-act="signout">Sign out</button></div>`;
  return h;
}

function viewLogin(msg) {
  return `<div class="login"><div class="panel"><h2>Sign in</h2><div class="form" style="padding:0">
    <label>Email<input type="email" id="l_e" autocomplete="username"></label>
    <label>Password<input type="password" id="l_p" autocomplete="current-password"></label>
    <div class="err" id="l_err">${esc(msg || "")}</div>
    <button class="btn" data-act="login">Sign in</button>
    <button class="linkish" data-act="reset">Forgot password</button></div></div></div>`;
}
function viewImport() {
  return `<div class="login"><div class="panel"><h2>Load your data</h2>
    <p class="sub">The database is empty. Choose the file <b>gojo-data.json</b> to load your records from the Excel. You only do this once.</p>
    <input type="file" id="importfile" accept=".json,application/json"><div class="err" id="i_err"></div></div></div>`;
}

/* ---------- render ---------- */
function allReady() { return ST.ready.cfg && ST.ready.sales && ST.ready.issues && ST.ready.cash; }
function render(force) {
  const tab = UI.tab;
  document.querySelectorAll("nav.tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
  if (!user) return;
  if (!allReady()) return;
  if (!ST.cfg) { $("#view").innerHTML = viewImport(); $("#tabs").hidden = true; return; }
  $("#tabs").hidden = false; $("#setuplink").hidden = false;
  if (ST.cfg.bar) $("#barname").textContent = ST.cfg.bar;
  if (tab === "sales" && UI.edit && UI.edit.dirty && !force) return;
  const v = { sales: viewSales, stock: viewStock, draft: viewDraft, given: viewGiven, money: viewMoney, setup: viewSetup }[tab] || viewSales;
  $("#view").innerHTML = v(); if (tab === "sales") paintTotals();
}
function route() {
  const h = location.hash.replace("#", "");
  UI.tab = ["sales", "stock", "draft", "given", "money", "setup"].includes(h) ? h : "sales";
  if (UI.tab === "sales" && (!UI.edit || !UI.edit.dirty)) UI.edit = null;
  render(true); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
function paintSync() {
  const pend = Object.values(ST.pending).some(Boolean), el = $("#sync");
  if (!navigator.onLine) { el.textContent = pend ? "Offline, will sync" : "Offline"; el.className = "pending"; }
  else { el.textContent = pend ? "Syncing…" : "Synced"; el.className = pend ? "pending" : ""; }
}
window.addEventListener("online", paintSync); window.addEventListener("offline", paintSync);

/* ---------- events ---------- */
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset.q != null && UI.edit) { UI.edit.q[t.dataset.q] = t.value; UI.edit.dirty = true; paintTotals(); }
  else if (t.dataset.m && UI.edit) { UI.edit[t.dataset.m] = t.value; UI.edit.dirty = true; paintTotals(); }
  else if (t.id === "countin") {
    const c = num(t.value), bal = +t.dataset.bal, uv = +t.dataset.unitval, r = $("#countres");
    if (c == null) { r.textContent = "Count the stock and type the number."; return; }
    const d = Math.round((c - bal) * 100) / 100;
    r.innerHTML = d === 0 ? "Matches the book. No difference." : `Difference: <b class="${d < 0 ? "diff-neg" : "diff-pos"}">${nf(d, 2)}</b> (${nf(d * uv)} Birr at selling price)`;
  }
});
document.addEventListener("change", async ev => {
  const t = ev.target;
  if (t.id === "saledate" && t.value) { if (UI.edit && UI.edit.dirty && !confirm("Leave without saving this day?")) { t.value = UI.edit.date; return; } loadEdit(t.value); render(true); }
  if (t.id === "g_item") { const it = items().find(i => i.name === t.value); $("#g_unit").textContent = it ? (it.name === "Draft - Single" ? "bermil" : it.base) : ""; }
  if (t.id === "importfile" && t.files && t.files[0]) await importData(t.files[0]);
});
document.addEventListener("keydown", ev => { if (ev.key === "Enter" && (ev.target.id === "l_p" || ev.target.id === "l_e")) doLogin(); });
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act;
  if (a === "login") { doLogin(); return; }
  if (a === "reset") { const e = $("#l_e").value.trim(); if (!e) { $("#l_err").textContent = "Type your email first."; return; } try { await sendPasswordResetEmail(auth, e); $("#l_err").textContent = "Reset email sent."; } catch (x) { $("#l_err").textContent = x.message; } return; }
  if (a === "signout") { if (confirm("Sign out?")) await signOut(auth); return; }
  if (a === "prevday" || a === "nextday") { if (UI.edit && UI.edit.dirty && !confirm("Leave without saving this day?")) return; loadEdit(addDays(UI.edit.date, a === "prevday" ? -1 : 1)); render(true); return; }
  if (a === "plus" || a === "minus") {
    const n = b.dataset.n, cur = num(UI.edit.q[n]) || 0, nv = Math.max(0, cur + (a === "plus" ? 1 : -1)); UI.edit.q[n] = nv ? String(nv) : ""; UI.edit.dirty = true;
    const inp = document.querySelector(`input[data-q="${CSS.escape(n)}"]`); if (inp) inp.value = UI.edit.q[n]; paintTotals(); return;
  }
  if (a === "saveday") { saveDay(); return; }
  if (a === "openstock") { UI.stockOpen = UI.stockOpen === b.dataset.n ? null : b.dataset.n; render(true); const i = $("#countin"); if (i) i.focus(); return; }
  if (a === "savecount") {
    const i = $("#countin"), c = num(i && i.value); if (c == null) { toast("Type the count first."); return; }
    const d = Math.round((c - (+i.dataset.bal)) * 100) / 100; if (d === 0) { toast("Count matches. Nothing to correct."); return; }
    if (!confirm(`Save a correction of ${nf(d, 2)} for ${b.dataset.n}?`)) return;
    addIssue({ d: today(), item: b.dataset.n, qty: d, note: "Count correction" }); UI.stockOpen = null; toast("Count saved"); render(true); return;
  }
  if (a === "quickkeg") { const last = issues().filter(e => e.item === "Draft - Single" && e.cost).pop(); addIssue({ d: today(), item: "Draft - Single", qty: 1, cost: last ? last.cost : undefined, pay: last ? true : undefined }); toast(last ? "1 bermil added. " + nf(last.cost) + " Birr taken off Money." : "1 bermil added"); render(true); return; }
  if (a === "addgiven") {
    const q = num($("#g_q").value); if (q == null) { toast("Type the quantity."); return; }
    const e = { d: $("#g_d").value || today(), item: $("#g_item").value, qty: q }; const c = num($("#g_c").value); if (c != null) e.cost = c; const n = $("#g_n").value.trim(); if (n) e.note = n;
    if (c && $("#g_pay").checked) e.pay = true;
    addIssue(e); toast(e.pay ? "Added. " + nf(c) + " Birr taken off Money." : "Added"); render(true); return;
  }
  if (a === "delgiven") { if (!isAdmin()) { toast(ADMIN_ONLY); return; } if (!confirm("Delete this entry?")) return; const m = b.dataset.m, d = clone(ST.issues[m]); delete d.items[b.dataset.id]; ST.issues[m] = d; write("issues/" + m, d); toast("Deleted"); render(true); return; }
  if (a === "givenall") { UI.givenAll = true; render(true); return; }
  if (a === "moneyall") { UI.moneyAll = true; render(true); return; }
  if (a === "editmoney") { UI.moneyEdit = UI.moneyEdit === b.dataset.d ? null : b.dataset.d; render(true); return; }
  if (a === "addpay") {
    const amt = num($("#p_a").value); if (amt == null) { toast("Type the amount."); return; }
    const d = $("#p_d").value || today(), note = $("#p_n").value.trim(), isIn = $("#p_in").checked, k = mk(d), dc = clone(ST.cash[k]); dc.days = dc.days || {}; const e = dc.days[d] || {};
    if (isIn) { e.other = (+e.other || 0) + amt; if (note) e.otherNote = e.otherNote ? e.otherNote + "; " + note : note; }
    else { e.paid = (+e.paid || 0) + amt; if (note) e.remark = e.remark ? e.remark + "; " + note : note; }
    dc.days[d] = e; ST.cash[k] = dc; write("cash/" + k, dc); toast("Added"); render(true); return;
  }
  if (a === "savemoney") {
    const d = b.dataset.d, k = mk(d), dc = clone(ST.cash[k]); dc.days = dc.days || {}; const e = {};
    const p = num($("#e_p").value), o = num($("#e_o").value), r = $("#e_r").value.trim(), on = $("#e_on").value.trim();
    if (p) e.paid = p; if (o) e.other = o; if (r) e.remark = r; if (on) e.otherNote = on;
    if (!Object.keys(e).length && !isAdmin()) { toast(ADMIN_ONLY); return; }
    if (Object.keys(e).length) dc.days[d] = e; else delete dc.days[d];
    ST.cash[k] = dc; UI.moneyEdit = null; write("cash/" + k, dc); toast("Saved"); render(true); return;
  }
  if (a === "savebank") { if (!isAdmin()) { toast(ADMIN_ONLY); return; } const cfg = clone(ST.cfg); cfg.bankCheck = { date: $("#b_d").value || today(), bank: num($("#b_b").value), cash: num($("#b_c").value) }; ST.cfg = cfg; write("config/main", cfg); toast("Check saved"); render(true); return; }
  if (a === "saveitems") { if (!isAdmin()) { toast(ADMIN_ONLY); return; }
    const cfg = clone(ST.cfg);
    for (const it of cfg.items) {
      const p = document.querySelector(`[data-price="${CSS.escape(it.name)}"]`), r = document.querySelector(`[data-reorder="${CSS.escape(it.name)}"]`);
      if (p && num(p.value) != null) it.price = num(p.value); if (r && num(r.value) != null) it.reorder = num(r.value);
    }
    ST.cfg = cfg; write("config/main", cfg); toast("Prices saved"); render(true); return;
  }
  if (a === "exportjson") { exportJson(); return; }
  if (a === "exportxlsx") { exportXlsx(); return; }
});
function addIssue(e) {
  const k = mk(e.d), d = clone(ST.issues[k]); d.items = d.items || {};
  const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), body = {}; for (const x in e) if (e[x] !== undefined) body[x] = e[x];
  d.items[id] = body; ST.issues[k] = d; write("issues/" + k, d);
}
function saveDay() {
  const e = UI.edit, k = mk(e.date), dc = clone(ST.sales[k]); dc.days = dc.days || {}; const q = {};
  for (const n in e.q) { const v = num(e.q[n]); if (v) q[n] = v; }
  const cbe = num(e.cbe), cash = num(e.cash), prev = dc.days[e.date];
  const p = Object.assign(Object.fromEntries(items().map(i => [i.name, +i.price || 0])), prev && prev.p ? prev.p : {});
  if (!Object.keys(q).length && cbe == null && cash == null) { if (prev && !isAdmin()) { toast(ADMIN_ONLY); return; } delete dc.days[e.date]; }
  else { const d = { q, p }; if (cbe != null) d.cbe = cbe; if (cash != null) d.cash = cash; dc.days[e.date] = d; }
  ST.sales[k] = dc; write("sales/" + k, dc);
  e.dirty = false; e.day = dc.days[e.date] || null; render(true);
  const ev = (draft().events || {})[e.date]; toast(ev ? "Saved. Bermil " + ev.join(" and ") + " finished, give the next one." : "Day saved");
}

/* ---------- backup ---------- */
function allData() { return { config: ST.cfg, sales: ST.sales, issues: ST.issues, cash: ST.cash, exported: new Date().toISOString() }; }
function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function exportJson() { download(`gojo-backup-${today()}.json`, new Blob([JSON.stringify(allData(), null, 1)], { type: "application/json" })); }
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function exportXlsx() {
  try { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); }
  catch (e) { toast("Could not load the Excel tool. Check the internet."); return; }
  const X = window.XLSX, its = items(), D = days(), wb = X.utils.book_new();
  wb.Props = { Title: "Gojo Bar records", Author: "Tewele B." };
  const sales = [["Date", ...its.map(i => i.name), "Sales value (Birr)", "CBE / TeleBirr", "Cash in hand"]];
  for (const d of Object.keys(D).sort()) { const x = D[d]; sales.push([d, ...its.map(i => (x.q || {})[i.name] || ""), dayValue(x), x.cbe ?? "", x.cash ?? ""]); }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sales), "Sales");
  const given = [["Date", "Item", "Quantity", "Cost (Birr)", "Note"]]; for (const e of issues()) given.push([e.d, e.item, e.qty, e.cost ?? "", e.note || ""]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(given), "Given");
  const st = [["Item", "Opening", "Given", "Sold (base)", "Must have (base)", "Status"]]; for (const r of stock()) st.push([r.it.name, r.open, r.given, Math.round(r.soldBase * 100) / 100, r.bal, r.status]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(st), "Stock");
  const dr = draft(), dd = [["Bermil", "Given on", "Finished on", "Sold (singles)", "Left (singles)", "Status"]];
  if (dr) for (const b of dr.list) dd.push([b.k, b.givenOn === "open" ? "Before records" : b.givenOn || "", b.finishedOn || "", b.sold, b.left, b.status]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(dd), "Draft");
  const mo = [["Date", "Sales", "Money in", "Paid out", "Balance", "Remark"]]; for (const r of cashBook()) if (r.has || r.open) mo.push([r.d, r.sales, r.other, r.paid, Math.round(r.bal), [r.remark, r.otherNote].filter(Boolean).join("; ")]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(mo), "Money");
  const out = X.write(wb, { bookType: "xlsx", type: "array" });
  download(`gojo-bar-${today()}.xlsx`, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
async function importData(file) {
  const err = $("#i_err");
  try {
    const data = JSON.parse(await file.text());
    if (!data.config || !data.config.items) { err.textContent = "This is not a Gojo Bar data file."; return; }
    if (!confirm("Load this data into the empty database?")) return;
    const b = writeBatch(fdb);
    b.set(ref("config/main"), data.config);
    for (const col of ["sales", "issues", "cash"]) for (const k in (data[col] || {})) b.set(ref(col + "/" + k), data[col][k]);
    err.textContent = "Loading…"; await b.commit(); toast("Data loaded");
  } catch (e) { err.textContent = "Could not load: " + (e.message || e); }
}

/* ---------- start ---------- */
async function doLogin() {
  const e = $("#l_e").value.trim(), p = $("#l_p").value, err = $("#l_err");
  if (!e || !p) { err.textContent = "Type your email and password."; return; }
  err.textContent = "Signing in…";
  try { await signInWithEmailAndPassword(auth, e, p); } catch (x) { err.textContent = "Wrong email or password."; }
}
function subscribe() {
  unsubs.forEach(u => u()); unsubs = [];
  ST.ready = { cfg: false, sales: false, issues: false, cash: false };
  const opts = { includeMetadataChanges: true };
  const fail = e => { $("#sync").textContent = e.code === "permission-denied" ? "No access" : "Connection problem"; if (e.code === "permission-denied") $("#view").innerHTML = `<div class="empty">This account has no access. Add its email to the Firestore rules.</div>`; };
  unsubs.push(onSnapshot(ref("config/main"), opts, s => { ST.cfg = s.exists() ? clone(s.data()) : null; ST.pending.cfg = s.metadata.hasPendingWrites; ST.ready.cfg = true; paintSync(); render(); }, fail));
  for (const col of ["sales", "issues", "cash"]) {
    unsubs.push(onSnapshot(collection(fdb, "bars", BAR_ID, col), opts, s => { const m = {}; s.docs.forEach(d => m[d.id] = clone(d.data())); ST[col] = m; ST.pending[col] = s.metadata.hasPendingWrites; ST.ready[col] = true; paintSync(); render(); }, fail));
  }
}
(function start() {
  if (!firebaseConfig || !firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith("PASTE")) {
    $("#view").innerHTML = `<div class="empty">Setup is not finished: paste your Firebase settings into <b>firebase-config.js</b>.</div>`; $("#sync").textContent = ""; return;
  }
  const app = initializeApp(firebaseConfig); auth = getAuth(app);
  try { fdb = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (e) { fdb = getFirestore(app); }
  onAuthStateChanged(auth, u => {
    user = u;
    if (!u) { unsubs.forEach(x => x()); unsubs = []; $("#tabs").hidden = true; $("#setuplink").hidden = true; $("#sync").textContent = ""; $("#view").innerHTML = viewLogin(); return; }
    $("#view").innerHTML = `<div class="empty">Loading your bar data…</div>`; $("#sync").textContent = "Loading…"; subscribe(); route();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
})();
