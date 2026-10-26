(() => {
  "use strict";

  const STORAGE_KEY = "trpgRecordArchive_v1";
  // Cloudflare Worker URL. Replace this placeholder after deploying share-worker/.
  const SHARE_API_BASE = "https://lbt-record-share.roro-crate.workers.dev";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const today = () => new Date().toISOString().slice(0, 10);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const number = value => Math.max(0, Number(value) || 0);
  const emptyCharacter = (name = "新しいキャラクター") => ({
    id: uid(), name, createdAt: new Date().toISOString(),
    resources: { lp: 0, fragment: 0 },
    items: [], syncs: [], analyses: [], identities: [], passives: [], egos: [], spirits: [],
    scenarioLogs: [], adjustments: []
  });
  const defaultState = () => {
    const character = emptyCharacter("新しいキャラクター");
    return { version: 1, activeCharacterId: character.id, characters: [character] };
  };

  let state = loadState();
  let activeView = "overview";
  let toastTimer;
  let dialogSubmit = null;
  const sortOptions = { egos: "rank", identities: "added", passives: "added" };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.characters) || !parsed.characters.length) return defaultState();
      parsed.version = parsed.version || 1;
      parsed.characters.forEach(normalizeCharacter);
      if (!parsed.characters.some(c => c.id === parsed.activeCharacterId)) parsed.activeCharacterId = parsed.characters[0].id;
      return parsed;
    } catch (e) {
      console.warn("保存データを読み込めませんでした", e);
      return defaultState();
    }
  }
  function normalizeCharacter(c) {
    c.id ||= uid(); c.name ||= "名称未設定";
    c.resources ||= { lp: 0, fragment: 0 };
    c.resources.lp = Number(c.resources.lp) || 0; c.resources.fragment = Number(c.resources.fragment) || 0;
    ["items","syncs","analyses","identities","passives","egos","spirits","scenarioLogs","adjustments"].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
    c.syncs.forEach(s => {
      s.rank ||= "0"; s.ct = number(s.ct); s.uses = number(s.uses); s.affiliation ||= ""; s.assignedBy ||= ""; delete s.performance; delete s.maxPerformance;
      s.resistances ||= ""; s.slashResistance ??= ""; s.pierceResistance ??= ""; s.bluntResistance ??= "";
      s.passive1 ||= ""; s.passive2 ||= ""; s.passive1Name ??= s.passive1; s.passive1Condition ||= ""; s.passive1ConstantEffect ||= ""; s.passive1Effect ||= "";
      s.passive2Name ??= s.passive2; s.passive2Condition ||= ""; s.passive2ConstantEffect ||= ""; s.passive2Effect ||= "";
      s.showPassive1Constant ??= !!s.passive1ConstantEffect; s.showPassive2Constant ??= !!s.passive2ConstantEffect; s.hp ??= ""; s.san ??= ""; s.speed ||= ""; s.bullets ??= "";
      s.tactics ||= [];
      let roots=s.tactics.filter(t => !(t.parentId || "")).length;
      while(roots<5){s.tactics.push({id:uid(),name:`戦術${roots}`,parentId:"",effect:""});roots++;}
      s.tactics.forEach(t => { t.id ||= uid(); t.name ||= "戦術"; t.parentId ||= ""; t.effect ||= ""; });
      // 分岐は1段階のみ。旧データに深い階層があれば、親の通常戦術へ付け替える。
      const tacticMap = new Map(s.tactics.map(t => [t.id, t]));
      s.tactics.forEach(t => { if (t.parentId && tacticMap.get(t.parentId)?.parentId) t.parentId = tacticMap.get(t.parentId).parentId; });
      s.uniques ||= []; s.uniques=s.uniques.map(u => typeof u === "string" ? {name:u,effect:""} : {name:u.name||"",effect:u.effect||""});
    });
    c.analyses.forEach(a => {
      a.carries = number(a.carries); a.uses = number(a.uses); a.resources ||= ""; a.rank ||= "ZAYIN"; a.assignedBy ||= ""; delete a.performance; delete a.maxPerformance;
      a.passiveName ||= ""; a.condition ||= ""; a.constantEffect ||= ""; a.effect ||= ""; a.corrosionEffect ||= ""; a.awakeningEffect ||= ""; a.note ||= "";
      a.uniques ||= a.unique ? [{name:"",effect:a.unique}] : []; a.uniques=a.uniques.map(u => typeof u === "string" ? {name:u,effect:""} : {name:u.name||"",effect:u.effect||""});
    });
    c.identities.forEach(i => { i.category ||= "通常"; i.name ||= ""; i.bodyEnhancements ||= []; });
    c.passives.forEach(x => { x.category ||= "通常"; });
    c.egos.forEach(x => { x.rank ||= "ZAYIN"; });
  }
  function save() {
    const openRecords = captureOpenRecords();
    state.version = 1;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { alert("保存に失敗しました。ブラウザの保存容量を確認してください。"); }
    renderAll();
    restoreOpenRecords(openRecords);
  }
  function captureOpenRecords(){ return [...document.querySelectorAll("details.record-accordion[open]")].map(el=>el.dataset.recordId).filter(Boolean); }
  function restoreOpenRecords(ids=[]){ const set=new Set(ids); document.querySelectorAll("details.record-accordion[data-record-id]").forEach(el=>{el.open=set.has(el.dataset.recordId);}); }
  function active() { return state.characters.find(c => c.id === state.activeCharacterId) || state.characters[0]; }
  function toast(message) {
    const el = $("#toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function syncMaxReady(s) { return number(s.uses) >= 3; }
  function analysisMaxReady(a) { return number(a.carries) >= 3 && number(a.uses) >= 1; }
  function rankCT(rank) { const base=String(rank||"0").replace(/^MAX-/,""); return ({ "0": 1, "00": 2, "000": 3 })[base] || 1; }

  const titles = {
    overview: ["WELCOME BACK","受付"], scenarios: ["SCENARIO LOG","シナリオ記録"],
    assets: ["RESOURCES & ITEMS","資産・アイテム"], sync: ["SYNCHRONIZED IDENTITY","同期人格"],
    analysis: ["ANALYSIS E.G.O","解析E.G.O"], identities: ["IDENTITY ARCHIVE","人格"],
    passives: ["SUPPORT PASSIVES","サポートパッシブ"], egos: ["E.G.O RANKS","E.G.O"],
    spirits: ["SPIRIT RECORDS","精神"], data: ["TRANSFER / BACKUP","データ管理"]
  };

  function renderAll() {
    const c = active();
    $("#characterSelect").innerHTML = state.characters.map(ch => `<option value="${escapeHTML(ch.id)}" ${ch.id === c.id ? "selected" : ""}>${escapeHTML(ch.name)}</option>`).join("");
    $("#activeCharacterLabel").textContent = c.name;
    $("#summaryLP").textContent = c.resources.lp;
    $("#summaryFragment").textContent = c.resources.fragment;
    $$(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === activeView));
    const [eyebrow, title] = titles[activeView] || titles.overview;
    $("#viewEyebrow").textContent = eyebrow; $("#viewTitle").textContent = title;
    const renderers = { overview: renderOverview, scenarios: renderScenarios, assets: renderAssets, sync: renderSync, analysis: renderAnalyses, identities: () => renderSimpleCollection("identities","人格"), passives: () => renderSimpleCollection("passives","サポートパッシブ"), egos: () => renderSimpleCollection("egos","E.G.O"), spirits: renderSpirits, data: renderData };
    $("#viewContent").innerHTML = (renderers[activeView] || renderOverview)();
    bindViewActions();
  }

  function sectionHead(title, desc, button = "") {
    return `<div class="section-head"><div><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ""}</div>${button}</div>`;
  }
  function panel(title, body, extra = "") {
    return `<section class="panel ${extra}"><h3>${title}</h3>${body}</section>`;
  }
  function emptyState(title, desc, button = "") {
    return `<div class="empty"><strong>${title}</strong>${desc ? `<div>${desc}</div>` : ""}${button ? `<div style="margin-top:12px">${button}</div>` : ""}</div>`;
  }
  function renderOverview() {
    const c = active();
    const recent = [...c.scenarioLogs].sort((a,b) => (b.date || "").localeCompare(a.date || "")).slice(0,4);
    const readySyncs = c.syncs.filter(syncMaxReady);
    const readyAnalyses = c.analyses.filter(analysisMaxReady);
    return `
      <div class="grid">
        <section class="panel">
          <div class="panel-title"><div><p class="eyebrow">CURRENT RECORD</p><h3>${escapeHTML(c.name)}</h3></div><span class="pill gold">ACTIVE</span></div>
          <div class="statline"><span class="pill gold">LP：${c.resources.lp}</span><span class="pill blue">欠片：${c.resources.fragment}</span></div>
          <hr class="rule">
          <div class="action-row"><button class="button button-primary" data-action="quick-adjust">資産を調整</button><button class="button" data-action="rename-character">キャラクター名を変更</button></div>
        </section>
        <section class="panel">
          <p class="eyebrow">MAX CONDITIONS</p><h3>MAX条件の達成状況</h3>
          <div class="statline"><span class="pill ${readySyncs.length ? "gold" : ""}">同期：${readySyncs.length}件</span><span class="pill ${readyAnalyses.length ? "gold" : ""}">同期解析：${readyAnalyses.length}件</span></div>
          <p class="muted small">同期は累計3回使用、同期解析は持ち込み3回＋使用1回で条件達成。</p>
          <div class="action-row"><button class="button button-quiet" data-goto="sync">同期を確認 →</button><button class="button button-quiet" data-goto="analysis">同期解析を確認 →</button></div>
        </section>
      </div>
      ${sectionHead("最近のシナリオ記録","直近の通過履歴",`<button class="button button-small" data-goto="scenarios">すべて表示 →</button>`)}
      ${recent.length ? `<div class="card-list">${recent.map(log => `<article class="record-card"><div class="card-top"><h3>${escapeHTML(log.name)}</h3><span class="pill">${escapeHTML(log.date || "日付なし")}</span></div><p class="muted small">${escapeHTML(log.note || "備考なし")}</p><div class="statline"><span class="pill gold">LP ${signed(log.lp || 0)}</span><span class="pill blue">欠片 ${signed(log.fragment || 0)}</span></div></article>`).join("")}</div>` : emptyState("記録はまだありません","シナリオ通過後に報酬・消費を記録できます.",`<button class="button button-primary" data-goto="scenarios">シナリオを記録</button>`)}
      ${sectionHead("管理メニュー","左側のメニューから各情報を編集できます。")}
      <div class="grid grid-3">
        ${overviewTile("資産・アイテム","LP、欠片、所持品を管理","assets")}
        ${overviewTile("人格・E.G.O","人格情報を管理","identities")}
        ${overviewTile("精神管理","所持している精神の名称を管理","spirits")}
      </div>`;
  }
  function overviewTile(title, desc, view) { return `<button class="panel" style="text-align:left;color:inherit" data-goto="${view}"><h3>${title} ↗</h3><p class="muted small">${desc}</p></button>`; }
  function signed(n) { const v = Number(n) || 0; return `${v > 0 ? "+" : ""}${v}`; }

  function renderScenarios() {
    const c = active();
    const logs = [...c.scenarioLogs].sort((a,b) => (b.date || "").localeCompare(a.date || ""));
    return `${sectionHead("シナリオ通過報酬ログ","報酬・消費を入力するとLPと欠片の残高に反映されます。",`<button class="button button-primary" data-action="add-scenario">＋ 通過記録を追加</button>`)}
      <div class="notice">報酬・消費欄は差引後の増減値で記録します。過去の記録を編集・削除しても、現在の残高は自動再計算されません。必要に応じて資産調整を行ってください。</div>
      <div style="height:14px"></div>
      ${logs.length ? `<div class="table-wrap"><table><thead><tr><th>通過日</th><th>シナリオ名</th><th>LP増減</th><th>欠片増減</th><th>アイテム・備考</th><th>操作</th></tr></thead><tbody>${logs.map(log => `<tr><td>${escapeHTML(log.date || "—")}</td><td>${escapeHTML(log.name)}</td><td>${signed(log.lp || 0)}</td><td>${signed(log.fragment || 0)}</td><td>${escapeHTML([log.items,log.note].filter(Boolean).join(" / ") || "—")}</td><td><div class="action-row"><button class="button button-small" data-action="edit-scenario" data-id="${log.id}">編集</button><button class="button button-small" data-action="delete-scenario" data-id="${log.id}">削除</button></div></td></tr>`).join("")}</tbody></table></div>` : emptyState("シナリオ記録がありません","通過報酬や消費を記録してください。")}`;
  }

  function renderAssets() {
    const c = active();
    return `<div class="grid">
      <section class="panel"><p class="eyebrow">RESOURCES</p><h3>数値資産</h3>
        <div class="form-row"><div class="field"><label for="lpInput">LP</label><input id="lpInput" type="number" value="${c.resources.lp}"></div><div class="field"><label for="fragmentInput">欠片</label><input id="fragmentInput" type="number" value="${c.resources.fragment}"></div></div>
        <div class="action-row"><button class="button button-primary" data-action="save-resources">残高を保存</button><button class="button" data-action="adjust-resources">増減を記録</button></div>
      </section>
      <section class="panel"><p class="eyebrow">ITEM STORAGE</p><h3>アイテム管理</h3><p class="muted small">同じアイテムは個数をまとめて管理します。</p><button class="button button-primary" data-action="add-item">＋ アイテムを追加</button></section>
    </div>
    ${sectionHead("所持アイテム","個数・説明・入手元を管理",`<button class="button button-small" data-action="add-item">＋ 追加</button>`)}
    ${c.items.length ? `<div class="table-wrap"><table><thead><tr><th>アイテム名</th><th>個数</th><th>説明</th><th>入手元</th><th>操作</th></tr></thead><tbody>${c.items.map(i => `<tr><td>${escapeHTML(i.name)}</td><td>${i.count}</td><td>${escapeHTML(i.description || "—")}</td><td>${escapeHTML(i.source || "—")}</td><td><div class="action-row"><button class="button button-small" data-action="use-item" data-id="${i.id}">1個使用</button><button class="button button-small" data-action="edit-item" data-id="${i.id}">編集</button><button class="button button-small" data-action="delete-item" data-id="${i.id}">削除</button></div></td></tr>`).join("")}</tbody></table></div>` : emptyState("アイテムはありません","アイテムを追加するとここに表示されます。")}`;
  }

  function renderSync() {
    const c = active();
    return `${sectionHead("同期人格一覧","項目を開くと詳細が表示されます。CT・使用回数・戦術分岐・固有を管理します。",`<button class="button button-primary" data-action="add-sync">＋ 同期人格を登録</button>`)}
      <div class="notice">ランク0 / 00 / 000の初期CTはそれぞれ1 / 2 / 3。CTが0になると再使用できます。累計3回使用でMAX作成条件達成。</div><div style="height:14px"></div>
      ${c.syncs.length ? `<div class="card-list">${c.syncs.map(s => {
        const ready=syncMaxReady(s), ct=number(s.ct), tactics=s.tactics||[], isMax=!!s.isMax || String(s.rank||"").startsWith("MAX-");
        const passive=(n)=>`<section class="subpanel passive-panel"><h4>人格パッシブ${n}</h4><p class="small"><strong>名称：</strong>${escapeHTML(s[`passive${n}Name`]||s[`passive${n}`]||"—")}</p><p class="small"><strong>条件：</strong>${escapeHTML(s[`passive${n}Condition`]||"—")}</p>${s[`showPassive${n}Constant`]&&s[`passive${n}ConstantEffect`]?`<p class="small"><strong>常時効果：</strong>${escapeHTML(s[`passive${n}ConstantEffect`]).replace(/\n/g,"<br>")}</p>`:""}<p class="small"><strong>効果：</strong>${escapeHTML(s[`passive${n}Effect`]||"—").replace(/\n/g,"<br>")}</p></section>`;
        return `<details class="record-card record-accordion ${ready?"max-ready":""}" data-record-id="${escapeHTML(s.id)}"><summary class="record-summary"><div class="card-top"><div><p class="eyebrow">SYNCHRONIZED IDENTITY · ${escapeHTML(s.rank)}${isMax?" · MAX":""}</p><h3>${escapeHTML(s.name||"名称未設定")}</h3></div><span class="pill ${ct===0?"green":"red"}">${ct===0?"使用可能":`CT ${ct}`}</span></div></summary><div class="accordion-body">
          <p class="small"><strong>所属：</strong>${escapeHTML(s.affiliation||"—")}　<strong>同期担当者：</strong>${escapeHTML(s.assignedBy||"—")}</p>
          <div class="statline"><span class="pill">HP ${escapeHTML(s.hp||"—")}</span><span class="pill">SAN ${escapeHTML(s.san||"—")}</span><span class="pill">速度 ${escapeHTML(s.speed||"—")}</span>${String(s.bullets||"").trim()?`<span class="pill">弾丸 ${escapeHTML(s.bullets)}</span>`:""}<span class="pill">累計使用：${s.uses||0} / 3</span></div>
          <p class="small"><strong>耐性：</strong>斬撃 ${escapeHTML(s.slashResistance||"—")} ／ 貫通 ${escapeHTML(s.pierceResistance||"—")} ／ 打撃 ${escapeHTML(s.bluntResistance||"—")}</p>
          <div class="passive-grid">${passive(1)}${s.showPassive2?passive(2):""}</div>
          <div class="progress"><span style="width:${Math.min(100,number(s.uses)/3*100)}%"></span></div>${ready?`<div class="max-banner">★ MAX作成条件達成 ★</div>`:""}
          <hr class="rule"><h4>戦術</h4>${renderTactics(s,tactics)}
          ${(s.uniques||[]).some(x=>x.name||x.effect)?`<hr class="rule"><h4>固有</h4>${(s.uniques||[]).map((x,i)=>(x.name||x.effect)?`<section class="subpanel"><div class="card-top"><strong>${escapeHTML(x.name||`固有 ${i+1}`)}</strong><div class="action-row"><button class="button button-small" data-action="edit-sync-unique" data-id="${s.id}" data-unique-index="${i}">編集</button><button class="button button-small" data-action="delete-sync-unique" data-id="${s.id}" data-unique-index="${i}">削除</button></div></div><p class="small">${escapeHTML(x.effect||"").replace(/\n/g,"<br>")}</p></section>`:"").join("")}`:""}
          <div class="action-row"><button class="button button-primary button-small" data-action="use-sync" data-id="${s.id}" ${ct>0?"disabled":""}>同期を使用</button><button class="button button-small" data-action="sync-scenario-pass">シナリオ通過</button><button class="button button-small" data-action="add-unique" data-id="${s.id}">＋ 固有追加</button><button class="button button-small" data-action="toggle-passive2" data-id="${s.id}">${s.showPassive2?"人格パッシブ2を削除":"人格パッシブ2を追加"}</button><button class="button button-small" data-action="edit-sync" data-id="${s.id}">編集</button>${ready&&!isMax?`<button class="button button-primary button-small" data-action="create-max-sync" data-id="${s.id}">MAXを作成</button>`:""}<button class="button button-small" data-action="share-sync" data-id="${s.id}">共有リンク</button><button class="button button-small" data-action="delete-sync" data-id="${s.id}">削除</button></div>
        </div></details>`;
      }).join("")}</div>`:emptyState("同期人格が登録されていません","指定の基本情報・パッシブ・戦術・固有を登録できます。",`<button class="button button-primary" data-action="add-sync">同期人格を登録</button>`)} `;
  }
  function renderTactics(s, tactics) {
    if(!tactics.length) return `<p class="muted small">戦術は未登録です。</p>`;
    const roots=tactics.filter(t=>!(t.parentId||""));
    const branchesFor=parent=>tactics.filter(t=>(t.parentId||"")===parent.id);
    const renderTactic=(t, isBranch=false)=>`<div class="tactic-item ${isBranch?"tactic-branch":""}"><div class="card-top"><strong>${escapeHTML(t.name||"戦術")}</strong><div class="action-row">${!isBranch?`<button class="button button-small" data-action="branch-tactic" data-id="${s.id}" data-tactic-id="${t.id}">分岐追加</button>`:""}<button class="button button-small" data-action="edit-tactic" data-id="${s.id}" data-tactic-id="${t.id}">編集</button><button class="button button-small" data-action="delete-tactic" data-id="${s.id}" data-tactic-id="${t.id}">削除</button></div></div><p class="small">${escapeHTML(t.effect||"効果未記入").replace(/\n/g,"<br>")}</p></div>`;
    const cards=[];
    roots.forEach(root=>{cards.push(renderTactic(root));branchesFor(root).forEach(branch=>cards.push(renderTactic(branch,true)));});
    return `<div class="tactics-grid">${cards.join("")}<div class="tactic-add-tile"><button class="button button-small" data-action="add-tactic" data-id="${s.id}">＋ 戦術追加</button></div></div>`;
  }

  function renderAnalyses() {
    const c=active();
    return `${sectionHead("解析E.G.O一覧","項目を開くと詳細が表示されます。持ち込み3回＋使用1回でMAX作成条件達成。",`<button class="button button-primary" data-action="add-analysis">＋ 解析E.G.Oを登録</button>`)}
      <div class="notice">持ち込み3回と使用1回の両方を満たすとMAX作成条件達成です。共有リンクは解析E.G.Oの記録内容をプレビューします。</div><div style="height:14px"></div>
      ${c.analyses.length?`<div class="card-list">${c.analyses.map(a=>{const ready=analysisMaxReady(a), isMax=!!a.isMax;return `<details class="record-card record-accordion ${ready?"max-ready":""}" data-record-id="${escapeHTML(a.id)}"><summary class="record-summary"><div class="card-top"><div><p class="eyebrow">ANALYSIS E.G.O · ${escapeHTML(a.rank||"ZAYIN")}${isMax?" · MAX":""}</p><h3>${escapeHTML(a.name||"名称未設定")}</h3></div><span class="pill ${ready?"gold":""}">${isMax?"MAXデータ":ready?"MAX作成条件達成":"条件未達"}</span></div></summary><div class="accordion-body">
        <p class="small"><strong>ランク：</strong>${escapeHTML(a.rank||"ZAYIN")}　<strong>担当者：</strong>${escapeHTML(a.assignedBy||"—")}</p>${a.requiredResources?`<p class="small"><strong>必要資源：</strong>${escapeHTML(a.requiredResources).replace(/\n/g,"<br>")}</p>`:""}
        <div class="subpanel"><h4>E.G.Oパッシブ</h4><p class="small"><strong>名称：</strong>${escapeHTML(a.passiveName||"—")}</p><p class="small"><strong>発動条件：</strong>${escapeHTML(a.condition||"—").replace(/\n/g,"<br>")}</p>${a.showConstantEffect&&a.constantEffect?`<p class="small"><strong>常時効果：</strong>${escapeHTML(a.constantEffect).replace(/\n/g,"<br>")}</p>`:""}<p class="small"><strong>効果：</strong>${escapeHTML(a.effect||"—").replace(/\n/g,"<br>")}</p></div>
        <div class="analysis-effects-grid"><section class="subpanel"><h4>覚醒</h4><p class="small">${escapeHTML(a.awakeningEffect||"未記入").replace(/\n/g,"<br>")}</p></section><section class="subpanel"><h4>浸食</h4><p class="small">${escapeHTML(a.corrosionEffect||"未記入").replace(/\n/g,"<br>")}</p></section></div>
        ${(a.uniques||[]).some(x=>x.name||x.effect)?`<h4>固有</h4>${a.uniques.map((x,i)=>(x.name||x.effect)?`<section class="subpanel"><div class="card-top"><strong>${escapeHTML(x.name||`固有 ${i+1}`)}</strong><div class="action-row"><button class="button button-small" data-action="edit-analysis-unique" data-id="${a.id}" data-unique-index="${i}">編集</button><button class="button button-small" data-action="delete-analysis-unique" data-id="${a.id}" data-unique-index="${i}">削除</button></div></div><p class="small">${escapeHTML(x.effect||"").replace(/\n/g,"<br>")}</p></section>`:"").join("")}`:""}
        ${a.note?`<p class="small"><strong>メモ：</strong>${escapeHTML(a.note).replace(/\n/g,"<br>")}</p>`:""}
        <div class="statline"><span class="pill ${number(a.carries)>=3?"green":""}">持ち込み ${a.carries||0} / 3</span><span class="pill ${number(a.uses)>=1?"green":""}">使用 ${a.uses||0} / 1</span></div><div class="progress"><span style="width:${Math.min(100,number(a.carries)/3*50+Math.min(1,number(a.uses))*50)}%"></span></div>${ready?`<div class="max-banner">★ MAX作成条件達成 ★</div>`:""}
        <div class="action-row"><button class="button button-small" data-action="carry-analysis" data-id="${a.id}">今回持ち込む +1</button><button class="button button-primary button-small" data-action="use-analysis" data-id="${a.id}">使用 +1</button><button class="button button-small" data-action="edit-analysis" data-id="${a.id}">編集</button><button class="button button-small" data-action="add-analysis-unique" data-id="${a.id}">＋ 固有追加</button>${ready&&!isMax?`<button class="button button-primary button-small" data-action="create-max-analysis" data-id="${a.id}">MAXを作成</button>`:""}<button class="button button-small" data-action="share-analysis" data-id="${a.id}">共有リンク</button><button class="button button-small" data-action="delete-analysis" data-id="${a.id}">削除</button></div>
      </div></details>`}).join("")}</div>`:emptyState("解析E.G.Oが登録されていません","名称・ランク・パッシブ・覚醒・浸食などを登録できます。",`<button class="button button-primary" data-action="add-analysis">解析E.G.Oを登録</button>`)} `;
  }

  function renderSimpleCollection(key, label) {
    const c = active();
    let list = [...c[key]];
    const rankOrder = ["ZAYIN","TETH","HE","WAW","ALEPH"];
    const sortControl = key === "egos"
      ? `<label class="sort-control">並び順<select data-sort="egos"><option value="rank" ${sortOptions.egos==="rank"?"selected":""}>ランク順</option><option value="added" ${sortOptions.egos==="added"?"selected":""}>追加順</option></select></label>`
      : key === "identities"
      ? `<label class="sort-control">並び順<select data-sort="identities"><option value="added" ${sortOptions.identities==="added"?"selected":""}>追加順</option><option value="通常" ${sortOptions.identities==="通常"?"selected":""}>通常順</option><option value="特異" ${sortOptions.identities==="特異"?"selected":""}>特異順</option><option value="同期" ${sortOptions.identities==="同期"?"selected":""}>同期順</option></select></label>`
      : key === "passives"
      ? `<label class="sort-control">並び順<select data-sort="passives"><option value="added" ${sortOptions.passives==="added"?"selected":""}>追加順</option><option value="normal" ${sortOptions.passives==="normal"?"selected":""}>通常</option><option value="death" ${sortOptions.passives==="death"?"selected":""}>死亡時</option></select></label>` : "";
    if (key === "egos" && sortOptions.egos === "rank") list.sort((a,b)=>rankOrder.indexOf(a.rank||"ZAYIN")-rankOrder.indexOf(b.rank||"ZAYIN"));
    if (key === "identities" && ["通常","特異","同期"].includes(sortOptions.identities)) {
      const preferred = sortOptions.identities;
      const order = [preferred, ...["通常","特異","同期"].filter(x => x !== preferred)];
      list.sort((a,b) => order.indexOf(a.category || "通常") - order.indexOf(b.category || "通常"));
    }
    if (key === "passives" && ["normal","death"].includes(sortOptions.passives)) { const first = sortOptions.passives === "normal" ? "通常" : "死亡時"; list.sort((a,b)=>(a.category===first?0:1)-(b.category===first?0:1)); }
    const heading = key === "identities" ? "分類・名称・身体強化のみを管理します。" : key === "egos" ? "E.G.O名とランクを管理します。" : "「通常」「死亡時」の分類で管理します。";
    return `${sectionHead(`${label}一覧`,heading,`<div class="section-tools">${sortControl}<button class="button button-primary" data-action="add-collection" data-key="${key}">＋ ${label}を追加</button></div>`)}
      ${list.length ? `<div class="card-list">${list.map(item => {
        if(key === "identities") {
          const enhancements=(item.bodyEnhancements||[]).filter(x=>String(x).trim());
          return `<article class="record-card"><div class="card-top"><h3>${escapeHTML(item.name||"名称未設定")}</h3><span class="pill">${escapeHTML(item.category||"通常")}</span></div>${enhancements.length?`<div class="body-enhancements"><h4>身体強化</h4>${enhancements.map((b,i)=>`<p class="small"><strong>${i+1}.</strong> ${escapeHTML(b)}</p>`).join("")}</div>`:""}<div class="action-row"><button class="button button-small" data-action="edit-collection" data-key="${key}" data-id="${item.id}">編集</button><button class="button button-small" data-action="delete-collection" data-key="${key}" data-id="${item.id}">削除</button></div></article>`;
        }
        if(key === "egos") return `<article class="record-card"><div class="card-top"><h3>${escapeHTML(item.name||"名称未設定")}</h3><span class="pill ego-rank rank-${escapeHTML(item.rank||"ZAYIN")}">${escapeHTML(item.rank||"ZAYIN")}</span></div><div class="action-row"><button class="button button-small" data-action="edit-collection" data-key="${key}" data-id="${item.id}">編集</button><button class="button button-small" data-action="delete-collection" data-key="${key}" data-id="${item.id}">削除</button></div></article>`;
        return `<article class="record-card"><div class="card-top"><h3>${escapeHTML(item.name||"名称未設定")}</h3><span class="pill ${item.category==="死亡時"?"red":"green"}">${escapeHTML(item.category||"通常")}</span></div><div class="action-row"><button class="button button-small" data-action="edit-collection" data-key="${key}" data-id="${item.id}">編集</button><button class="button button-small" data-action="delete-collection" data-key="${key}" data-id="${item.id}">削除</button></div></article>`;
      }).join("")}</div>` : emptyState(`${label}が登録されていません`,`${label}を追加してください。`)}`;
  }

  function renderSpirits() {
    const c = active();
    return `${sectionHead("所持している精神","精神の名称のみを管理します。",`<button class="button button-primary" data-action="add-spirit">＋ 精神を追加</button>`)}
      ${c.spirits.length ? `<div class="card-list">${c.spirits.map(s => `<article class="record-card"><div class="card-top"><h3>${escapeHTML(s.name)}</h3><span class="pill">所持</span></div><div class="action-row"><button class="button button-small" data-action="edit-spirit" data-id="${s.id}">編集</button><button class="button button-small" data-action="delete-spirit" data-id="${s.id}">削除</button></div></article>`).join("")}</div>` : emptyState("精神は登録されていません","所持している精神の名称を登録してください。")}`;
  }

  function renderData() {
    return `${sectionHead("データ移行・バックアップ","データはこのブラウザのローカルストレージに保存されます。")}
      <div class="grid">
        <section class="panel"><p class="eyebrow">PASSWORD OF RETURN</p><h3>復元コードを生成</h3><p class="muted small">選択中のキャラクター、または登録済みの全キャラクターをコード化します。生成したコードを別端末で読み込めます。</p>
          <div class="field"><label for="exportScope">対象範囲</label><select id="exportScope"><option value="active">選択中のキャラクター1人</option><option value="all">全キャラクター</option></select></div>
          <button class="button button-primary" data-action="generate-code">復元コードを生成</button><div class="field" style="margin-top:13px"><label for="exportCode">生成されたコード</label><textarea id="exportCode" class="code-box" placeholder="ここに復元コードが表示されます"></textarea></div><button class="button" data-action="copy-code">コードをコピー</button>
        </section>
        <section class="panel"><p class="eyebrow">RESTORE RECORD</p><h3>復元コードを読み込む</h3><p class="muted small">読み込み前にコードを検証します。現在のデータへの追加、または全置換を選べます。</p>
          <div class="field"><label for="importCode">復元コード</label><textarea id="importCode" class="code-box" placeholder="別端末で生成したコードを貼り付け"></textarea></div>
          <div class="field"><label for="importMode">読み込み方法</label><select id="importMode"><option value="replace">現在のデータを置き換える</option><option value="merge">キャラクターを追加する</option></select></div>
          <button class="button button-primary" data-action="import-code">コードを検証して読み込む</button>
        </section>
        <section class="panel"><p class="eyebrow">JSON BACKUP</p><h3>JSONファイル</h3><p class="muted small">長いデータのバックアップにはJSON形式が便利です。</p><div class="action-row"><button class="button button-primary" data-action="export-json">JSONを書き出す</button><label class="button" for="jsonImportFile">JSONを読み込む</label><input id="jsonImportFile" type="file" accept=".json,application/json" hidden></div></section>
        <section class="panel"><p class="eyebrow">LOCAL DATA</p><h3>この端末のデータ</h3><p class="muted small">登録キャラクター数：${state.characters.length}</p><div class="notice danger-note">初期化すると、このブラウザに保存されたデータが消去されます。実行前にバックアップしてください。</div><div style="margin-top:12px"><button class="button button-danger" data-action="reset-data">全データを初期化</button></div></section>
      </div>`;
  }

  function bindViewActions() {
    $$("[data-goto]").forEach(el => el.addEventListener("click", () => navigate(el.dataset.goto)));
    $$(`[data-action]`).forEach(el => el.addEventListener("click", () => handleAction(el.dataset.action, el.dataset)));
    $$(`[data-sort]`).forEach(el => el.addEventListener("change", () => { sortOptions[el.dataset.sort] = el.value; renderAll(); }));
    const file = $("#jsonImportFile");
    if (file) file.addEventListener("change", handleJSONFile);
  }
  function navigate(view) { activeView = view; renderAll(); window.scrollTo({top:0,behavior:"smooth"}); }
  function findById(list, id) { return list.find(x => x.id === id); }

  function handleAction(action, data = {}) {
    const c = active();
    switch(action) {
      case "quick-adjust": openResourceAdjust(); break;
      case "rename-character": openForm("キャラクター名を変更", [{name:"name",label:"キャラクター名",value:c.name,required:true}], values => { c.name = (values.name||"").trim() || "名称未設定"; save(); toast("キャラクター名を変更しました"); }); break;
      case "add-scenario": openScenarioForm(); break;
      case "edit-scenario": openScenarioForm(findById(c.scenarioLogs,data.id)); break;
      case "delete-scenario": confirmAction("記録を削除しますか？","削除しても、記録時に反映された残高は自動で戻りません。",() => { c.scenarioLogs = c.scenarioLogs.filter(x=>x.id!==data.id); save(); }); break;
      case "save-resources": c.resources.lp = Number($("#lpInput").value)||0; c.resources.fragment = Number($("#fragmentInput").value)||0; save(); toast("残高を保存しました"); break;
      case "adjust-resources": openResourceAdjust(); break;
      case "add-item": openItemForm(); break;
      case "edit-item": openItemForm(findById(c.items,data.id)); break;
      case "use-item": { const item=findById(c.items,data.id); if(item && item.count>0){item.count--; c.adjustments.push({id:uid(),date:today(),type:"item",name:item.name,delta:-1,reason:"アイテム使用"}); save(); toast(`${item.name}を1個使用しました`);} else toast("所持数がありません"); break; }
      case "delete-item": confirmAction("アイテムを削除しますか？","このアイテムの登録を削除します。",()=>{c.items=c.items.filter(x=>x.id!==data.id);save();}); break;
      case "add-sync": openSyncForm(); break;
      case "edit-sync": openSyncForm(findById(c.syncs,data.id)); break;
      case "toggle-passive2": { const s=findById(c.syncs,data.id); if(s){s.showPassive2=!s.showPassive2;save();toast(s.showPassive2?"人格パッシブ2を追加しました":"人格パッシブ2を非表示にしました");} break; }
      case "use-sync": { const s=findById(c.syncs,data.id); if(s && s.ct===0){s.ct=rankCT(s.rank);s.uses=number(s.uses)+1;s.lastUsed=today();save();toast("同期を使用しました。CTを設定しました");} break; }
      case "sync-scenario-pass": confirmAction("シナリオ通過を記録しますか？","CTが1以上の同期をすべて1減少させます。",()=>{c.syncs.forEach(s=>{if(number(s.ct)>0)s.ct--;}); c.scenarioLogs.push({id:uid(),name:"シナリオ通過（CT更新）",date:today(),lp:0,fragment:0,items:"",note:"同期CTを1減少"});save();toast("同期CTを更新しました");}); break;
      case "create-max-sync": { const s=findById(c.syncs,data.id); if(s && syncMaxReady(s) && !String(s.rank||"").startsWith("MAX-")){ const copy=structuredClone(s); copy.id=uid(); copy.sourceId=s.id; copy.isMax=true; copy.rank=`MAX-${String(s.rank||"0").replace(/^MAX-/,"")}`; c.syncs.push(copy); save(); toast("元データをコピーしてMAX同期人格を作成しました"); } break; }
      case "add-tactic": openTacticForm(findById(c.syncs,data.id), null, false); break;
      case "branch-tactic": openTacticForm(findById(c.syncs,data.id), null, true, data.tacticId||""); break;
      case "edit-tactic": { const s=findById(c.syncs,data.id), t=s?.tactics?.find(x=>x.id===data.tacticId); if(s&&t) openTacticForm(s,t,false); break; }
      case "delete-tactic": { const s=findById(c.syncs,data.id); if(s){const ids=new Set([data.tacticId]);let changed=true;while(changed){changed=false;(s.tactics||[]).forEach(t=>{if(ids.has(t.parentId)&&!ids.has(t.id)){ids.add(t.id);changed=true;}});}s.tactics=s.tactics.filter(t=>!ids.has(t.id));save();} break; }
      case "add-unique": { const s=findById(c.syncs,data.id); if(s) openForm("固有を追加",[{name:"name",label:"固有名称"},{name:"effect",label:"固有効果",type:"textarea"}],v=>{s.uniques ||= [];s.uniques.push({name:v.name||"",effect:v.effect||""});save();toast("固有を追加しました");}); break; }
      case "add-analysis-unique": { const a=findById(c.analyses,data.id); if(a) openForm("解析E.G.Oの固有を追加",[{name:"name",label:"固有名称"},{name:"effect",label:"固有効果",type:"textarea"}],v=>{a.uniques ||= [];a.uniques.push({name:v.name||"",effect:v.effect||""});save();toast("固有を追加しました");}); break; }
      case "edit-sync-unique": { const s=findById(c.syncs,data.id),u=s?.uniques?.[Number(data.uniqueIndex)]; if(s&&u)openForm("固有を編集",[{name:"name",label:"固有名称",value:u.name||""},{name:"effect",label:"固有効果",type:"textarea",value:u.effect||""}],v=>{Object.assign(u,{name:v.name||"",effect:v.effect||""});save();}); break; }
      case "delete-sync-unique": { const s=findById(c.syncs,data.id); if(s){s.uniques.splice(Number(data.uniqueIndex),1);save();} break; }
      case "edit-analysis-unique": { const a=findById(c.analyses,data.id),u=a?.uniques?.[Number(data.uniqueIndex)]; if(a&&u)openForm("固有を編集",[{name:"name",label:"固有名称",value:u.name||""},{name:"effect",label:"固有効果",type:"textarea",value:u.effect||""}],v=>{Object.assign(u,{name:v.name||"",effect:v.effect||""});save();}); break; }
      case "delete-analysis-unique": { const a=findById(c.analyses,data.id); if(a){a.uniques.splice(Number(data.uniqueIndex),1);save();} break; }
      case "delete-sync": confirmAction("同期を削除しますか？","同期のCT・使用回数・性能記録を削除します。",()=>{c.syncs=c.syncs.filter(x=>x.id!==data.id);save();}); break;
      case "add-analysis": openAnalysisForm(); break;
      case "edit-analysis": openAnalysisForm(findById(c.analyses,data.id)); break;
      case "carry-analysis": { const a=findById(c.analyses,data.id); if(a){a.carries=number(a.carries)+1;a.carryHistory ||= [];a.carryHistory.push({date:today()});save();toast("持ち込み回数を加算しました");} break; }
      case "use-analysis": { const a=findById(c.analyses,data.id); if(a){a.uses=number(a.uses)+1;a.useHistory ||= [];a.useHistory.push({date:today()});save();toast("使用回数を加算しました");} break; }
      case "create-max-analysis": { const a=findById(c.analyses,data.id); if(a && analysisMaxReady(a) && !a.isMax){ const copy=structuredClone(a); copy.id=uid(); copy.sourceId=a.id; copy.isMax=true; c.analyses.push(copy); save(); toast("元データをコピーしてMAX解析E.G.Oを作成しました"); } break; }
      case "share-analysis": { const a=findById(c.analyses,data.id); if(a) generateShareLink(a); break; }
      case "share-sync": { const s=findById(c.syncs,data.id); if(s) generateSyncShareLink(s); break; }
      case "delete-analysis": confirmAction("同期解析を削除しますか？","持ち込み・使用履歴と性能記録を削除します。",()=>{c.analyses=c.analyses.filter(x=>x.id!==data.id);save();}); break;
      case "add-collection": openCollectionForm(data.key); break;
      case "add-body-enhancement": { const item=findById(c.identities,data.id); if(item) openForm("身体強化を追加",[{name:"enhancement",label:"身体強化",type:"textarea"}],v=>{item.bodyEnhancements ||= [];if((v.enhancement||"").trim())item.bodyEnhancements.push(v.enhancement);save();toast("身体強化を追加しました");}); break; }
      case "edit-collection": openCollectionForm(data.key,findById(c[data.key],data.id)); break;
      case "toggle-owned": { const item=findById(c[data.key],data.id); if(item){item.owned=!item.owned;save();} break; }
      case "delete-collection": confirmAction("登録を削除しますか？","この登録を削除します。",()=>{c[data.key]=c[data.key].filter(x=>x.id!==data.id);save();}); break;
      case "add-spirit": openSpiritForm(); break;
      case "edit-spirit": openSpiritForm(findById(c.spirits,data.id)); break;
      case "delete-spirit": confirmAction("精神を削除しますか？","この精神の登録を削除します。",()=>{c.spirits=c.spirits.filter(x=>x.id!==data.id);save();}); break;
      case "generate-code": generateRestoreCode(); break;
      case "copy-code": copyText($("#exportCode").value); break;
      case "import-code": importRestoreCode(); break;
      case "export-json": exportJSON(); break;
      case "reset-data": confirmAction("全データを初期化しますか？","このアプリの保存データを消去し、空の初期状態に戻します。この操作は取り消せません。必要なら先にバックアップしてください。",()=>{try{localStorage.removeItem(STORAGE_KEY);}catch(e){} state=defaultState();activeView="overview";renderAll();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){}toast("全データを初期化しました");}); break;
    }
  }

  function openForm(title, fields, onSave) {
    const dialog=$("#genericDialog"), form=$("#dialogFields");
    $("#dialogTitle").textContent=title;
    const renderField=f=>{
      const value=escapeHTML(f.value ?? "");
      if(f.type==="textarea") return `<div class="field"><label for="f_${f.name}">${f.label}</label><textarea id="f_${f.name}" name="${f.name}">${value}</textarea>${f.help?`<small>${f.help}</small>`:""}</div>`;
      if(f.type==="select") return `<div class="field"><label for="f_${f.name}">${f.label}</label><select id="f_${f.name}" name="${f.name}">${f.options.map(o=>`<option value="${escapeHTML(o.value)}" ${String(f.value)===String(o.value)?"selected":""}>${escapeHTML(o.label)}</option>`).join("")}</select></div>`;
      return `<div class="field"><label for="f_${f.name}">${f.label}</label><input id="f_${f.name}" name="${f.name}" type="${f.type||"text"}" value="${value}" ${f.min!==undefined?`min="${f.min}"`:""} ${f.step?`step="${f.step}"`:""}>${f.help?`<small>${f.help}</small>`:""}</div>`;
    };
    const parts=[];
    for(let i=0;i<fields.length;){
      const f=fields[i];
      if(!f.group){parts.push(renderField(f));i++;continue;}
      const group=[];while(i<fields.length&&fields[i].group===f.group)group.push(fields[i++]);
      if(f.groupType==="columns"){
        const cols={};group.forEach(x=>{(cols[x.column||"left"]||= []).push(x);});
        parts.push(`<div class="form-columns">${Object.values(cols).map(col=>`<div class="form-column">${col.map(renderField).join("")}</div>`).join("")}</div>`);
      }else parts.push(`<div class="form-row ${["sync-stats","sync-resist"].includes(f.group)?"form-row-3":""}">${group.map(renderField).join("")}</div>`);
    }
    form.innerHTML=parts.join("");
    dialogSubmit = onSave;
    dialog.showModal();
  }
  $("#dialogForm").addEventListener("submit", e => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const form=$("#dialogFields");
    const values={}; $$("[name]",form).forEach(el=>values[el.name]=el.value);
    $("#genericDialog").close();
    if(dialogSubmit) dialogSubmit(values);
  });
  function confirmAction(title,message,callback) {
    $("#confirmTitle").textContent=title; $("#confirmMessage").textContent=message;
    const d=$("#confirmDialog");
    const yes=$("#confirmYes");
    yes.onclick = e => { e.preventDefault(); d.close(); callback(); };
    d.showModal();
  }
  function openResourceAdjust() {
    openForm("資産の増減を記録",[
      {name:"lp",label:"LPの増減（増加は正、減少は負）",type:"number",value:0},
      {name:"fragment",label:"欠片の増減（増加は正、減少は負）",type:"number",value:0},
      {name:"reason",label:"理由",value:"手動調整"}
    ],v=>{const c=active();c.resources.lp+=Number(v.lp)||0;c.resources.fragment+=Number(v.fragment)||0;c.adjustments.push({id:uid(),date:today(),lp:Number(v.lp)||0,fragment:Number(v.fragment)||0,reason:v.reason});save();toast("資産を調整しました");});
  }
  function openScenarioForm(existing) {
    const item=existing||{};
    openForm(existing?"シナリオ記録を編集":"シナリオ通過を記録",[
      {name:"name",label:"シナリオ名",value:item.name||"",required:true},
      {name:"date",label:"通過日",type:"date",value:item.date||today(),required:true},
      {name:"lp",label:"LPの増減（報酬は正、消費は負）",type:"number",value:item.lp||0},
      {name:"fragment",label:"欠片の増減（獲得は正、消費は負）",type:"number",value:item.fragment||0},
      {name:"items",label:"獲得・消費アイテム",value:item.items||""},
      {name:"note",label:"備考",type:"textarea",value:item.note||""}
    ],v=>{const c=active(), log={...item,...v,id:item.id||uid(),lp:Number(v.lp)||0,fragment:Number(v.fragment)||0};if(existing){const idx=c.scenarioLogs.findIndex(x=>x.id===item.id);c.scenarioLogs[idx]=log;}else{c.resources.lp+=log.lp;c.resources.fragment+=log.fragment;c.scenarioLogs.push(log);c.syncs.forEach(s=>{if(number(s.ct)>0)s.ct--;});log.note = [log.note,"シナリオ通過により同期CTを更新"].filter(Boolean).join(" / ");}save();toast(existing?"記録を更新しました":"通過記録を保存し、資産とCTを更新しました");});
  }
  function openItemForm(existing) {
    const item=existing||{};
    openForm(existing?"アイテムを編集":"アイテムを追加",[
      {name:"name",label:"アイテム名",value:item.name||"",required:true},
      {name:"count",label:"所持数",type:"number",value:item.count??1,min:0},
      {name:"description",label:"説明",type:"textarea",value:item.description||""},
      {name:"source",label:"入手元",value:item.source||""}
    ],v=>{const c=active(),obj={...item,...v,id:item.id||uid(),count:number(v.count)};if(existing)c.items[c.items.findIndex(x=>x.id===item.id)]=obj;else c.items.push(obj);save();toast("アイテムを保存しました");});
  }
  function openSyncForm(existing) {
    const s=existing||{};
    const initialTactics=[...(s.tactics||[])];
    while(initialTactics.filter(t=>!(t.parentId||"")).length<5){const n=initialTactics.filter(t=>!(t.parentId||"")).length;initialTactics.push({id:uid(),name:`戦術${n}`,parentId:"",effect:""});}
    const rootTactics=initialTactics.filter(t=>!(t.parentId||""));
    const fields=[
      {name:"name",label:"同期人格名",value:s.name||""},
      {name:"affiliation",label:"所属",value:s.affiliation||"",group:"sync-meta"},
      {name:"rank",label:"RANK",type:"select",value:s.rank||"0",group:"sync-meta",options:["0","00","000","MAX-0","MAX-00","MAX-000"].map(x=>({value:x,label:x}))},
      {name:"assignedBy",label:"同期担当者",value:s.assignedBy||""},
      {name:"hp",label:"HP",value:s.hp||"",group:"sync-stats"},{name:"san",label:"SAN",value:s.san||"",group:"sync-stats"},{name:"speed",label:"速度",value:s.speed||"",group:"sync-stats"},{name:"bullets",label:"弾丸",value:s.bullets||"",group:"sync-stats"},
      {name:"slashResistance",label:"耐性・斬撃",value:s.slashResistance||"",group:"sync-resist"},{name:"pierceResistance",label:"耐性・貫通",value:s.pierceResistance||"",group:"sync-resist"},{name:"bluntResistance",label:"耐性・打撃",value:s.bluntResistance||"",group:"sync-resist"},
      {name:"passive1Name",label:"サポートパッシブ1・名称",value:s.passive1Name||s.passive1||"",group:"sync-passives",groupType:"columns",column:"left"},
      {name:"passive1Condition",label:"条件",type:"textarea",value:s.passive1Condition||"",group:"sync-passives",groupType:"columns",column:"left"},
      {name:"showPassive1Constant",label:"常時効果を表示",type:"select",value:String(!!s.showPassive1Constant),group:"sync-passives",groupType:"columns",column:"left",options:[{value:"false",label:"非表示"},{value:"true",label:"表示"}]},
      {name:"passive1ConstantEffect",label:"常時効果",type:"textarea",value:s.passive1ConstantEffect||"",group:"sync-passives",groupType:"columns",column:"left"},
      {name:"passive1Effect",label:"効果",type:"textarea",value:s.passive1Effect||"",group:"sync-passives",groupType:"columns",column:"left"},
      {name:"passive2Name",label:"サポートパッシブ2・名称",value:s.passive2Name||s.passive2||"",group:"sync-passives",groupType:"columns",column:"right"},
      {name:"passive2Condition",label:"条件",type:"textarea",value:s.passive2Condition||"",group:"sync-passives",groupType:"columns",column:"right"},
      {name:"showPassive2",label:"サポートパッシブ2を表示",type:"select",value:String(!!s.showPassive2),group:"sync-passives",groupType:"columns",column:"right",options:[{value:"false",label:"非表示"},{value:"true",label:"表示"}]},
      {name:"showPassive2Constant",label:"常時効果を表示",type:"select",value:String(!!s.showPassive2Constant),group:"sync-passives",groupType:"columns",column:"right",options:[{value:"false",label:"非表示"},{value:"true",label:"表示"}]},
      {name:"passive2ConstantEffect",label:"常時効果",type:"textarea",value:s.passive2ConstantEffect||"",group:"sync-passives",groupType:"columns",column:"right"},
      {name:"passive2Effect",label:"効果",type:"textarea",value:s.passive2Effect||"",group:"sync-passives",groupType:"columns",column:"right"},
      {name:"tactic0Name",label:"戦術0：名称",value:rootTactics[0]?.name||"戦術0",group:"sync-tactics",groupType:"columns",column:"left"},
      {name:"tactic0Effect",label:"効果記入欄",type:"textarea",value:rootTactics[0]?.effect||"",group:"sync-tactics",groupType:"columns",column:"left"},
      {name:"tactic2Name",label:"戦術2：名称",value:rootTactics[2]?.name||"戦術2",group:"sync-tactics",groupType:"columns",column:"left"},
      {name:"tactic2Effect",label:"効果記入欄",type:"textarea",value:rootTactics[2]?.effect||"",group:"sync-tactics",groupType:"columns",column:"left"},
      {name:"tactic4Name",label:"戦術4：名称",value:rootTactics[4]?.name||"戦術4",group:"sync-tactics",groupType:"columns",column:"left"},
      {name:"tactic4Effect",label:"効果記入欄",type:"textarea",value:rootTactics[4]?.effect||"",group:"sync-tactics",groupType:"columns",column:"left"},
      {name:"tactic1Name",label:"戦術1：名称",value:rootTactics[1]?.name||"戦術1",group:"sync-tactics",groupType:"columns",column:"right"},
      {name:"tactic1Effect",label:"効果記入欄",type:"textarea",value:rootTactics[1]?.effect||"",group:"sync-tactics",groupType:"columns",column:"right"},
      {name:"tactic3Name",label:"戦術3：名称",value:rootTactics[3]?.name||"戦術3",group:"sync-tactics",groupType:"columns",column:"right"},
      {name:"tactic3Effect",label:"効果記入欄",type:"textarea",value:rootTactics[3]?.effect||"",group:"sync-tactics",groupType:"columns",column:"right"},
      {name:"ct",label:"現在CT（0なら使用可能）",type:"number",value:s.ct??0,min:0},{name:"uses",label:"累計使用回数",type:"number",value:s.uses??0,min:0}
    ];
    openForm(existing?"同期人格を編集":"同期人格を登録",fields,v=>{
      const c=active(),obj={...s,...v,id:s.id||uid(),ct:number(v.ct),uses:number(v.uses),showPassive2:v.showPassive2==="true",showPassive1Constant:v.showPassive1Constant==="true",showPassive2Constant:v.showPassive2Constant==="true",uniques:s.uniques||[],tactics:initialTactics};
      delete obj.performance; delete obj.maxPerformance;
      [0,1,2,3,4].forEach(n=>{const t=rootTactics[n];if(t){t.name=v[`tactic${n}Name`]||"";t.effect=v[`tactic${n}Effect`]||"";}});
      ["tactic0Name","tactic0Effect","tactic1Name","tactic1Effect","tactic2Name","tactic2Effect","tactic3Name","tactic3Effect","tactic4Name","tactic4Effect"].forEach(k=>delete obj[k]);
      if(existing)c.syncs[c.syncs.findIndex(x=>x.id===s.id)]=obj;else c.syncs.push(obj);save();toast("同期人格を保存しました");
    });
  }

  function openTacticForm(sync, existing, branch, requestedParentId="") {
    if(!sync)return;
    sync.tactics ||= [];
    while(sync.tactics.filter(t=>!(t.parentId||"")).length<5){const n=sync.tactics.filter(t=>!(t.parentId||"")).length;sync.tactics.push({id:uid(),name:`戦術${n}`,parentId:"",effect:""});}
    const roots=sync.tactics.filter(t=>!(t.parentId||""));
    const currentParent=existing?.parentId||requestedParentId||"";
    const parentRecord=roots.find(t=>t.id===currentParent);
    const siblingCount=sync.tactics.filter(t=>(t.parentId||"")===currentParent).length;
    const suggestedName=branch&&parentRecord?`${parentRecord.name||"戦術"}-${siblingCount+1}`:`戦術${roots.length}`;
    const parentOptions=branch?roots.map(t=>({value:t.id,label:t.name||"戦術"})):[{value:"",label:"通常戦術（分岐元なし）"}];
    openForm(existing?"戦術を編集":branch?"戦術分岐を追加":"戦術を追加",[
      {name:"name",label:"戦術名",value:existing?.name||suggestedName},
      {name:"parentId",label:branch?"分岐元の戦術":"分類",type:"select",value:branch?(existing?.parentId||currentParent||roots[0]?.id||""):"",options:parentOptions},
      {name:"effect",label:"効果記入欄",type:"textarea",value:existing?.effect||""}
    ],v=>{if(existing){Object.assign(existing,v);if(existing.parentId){const parent=roots.find(t=>t.id===existing.parentId);if(parent && !existing.name.startsWith(`${parent.name}-`))existing.name=`${parent.name}-${sync.tactics.filter(t=>t.parentId===parent.id).indexOf(existing)+1}`;}}else{if(!branch)v.parentId="";sync.tactics.push({id:uid(),...v});}save();toast("戦術を保存しました");});
  }

  function openAnalysisForm(existing) {
    const a=existing||{};
    openForm(existing?"解析E.G.Oを編集":"解析E.G.Oを登録",[
      {name:"name",label:"E.G.O名称",value:a.name||""},
      {name:"rank",label:"ランク",type:"select",value:a.rank||"ZAYIN",options:["ZAYIN","TETH","HE","WAW","ALEPH"].map(x=>({value:x,label:x}))},
      {name:"assignedBy",label:"担当者",value:a.assignedBy||""},
      {name:"requiredResources",label:"必要資源",type:"textarea",value:a.requiredResources||""},
      {name:"passiveName",label:"E.G.Oパッシブ名",value:a.passiveName||""},
      {name:"condition",label:"発動条件",type:"textarea",value:a.condition||""},
      {name:"showConstantEffect",label:"常時効果を表示",type:"select",value:String(!!a.showConstantEffect),options:[{value:"false",label:"非表示"},{value:"true",label:"表示"}]},
      {name:"constantEffect",label:"常時効果（任意）",type:"textarea",value:a.constantEffect||""},
      {name:"effect",label:"効果",type:"textarea",value:a.effect||""},
      {name:"awakeningEffect",label:"覚醒効果",type:"textarea",value:a.awakeningEffect||"",group:"analysis-effects",groupType:"columns",column:"left"},
      {name:"corrosionEffect",label:"浸食効果",type:"textarea",value:a.corrosionEffect||"",group:"analysis-effects",groupType:"columns",column:"right"},
      {name:"note",label:"メモ",type:"textarea",value:a.note||""},
      {name:"carries",label:"持ち込み回数",type:"number",value:a.carries??0,min:0},
      {name:"uses",label:"使用回数",type:"number",value:a.uses??0,min:0}
    ],v=>{
      const c=active(),obj={...a,...v,id:a.id||uid(),showConstantEffect:v.showConstantEffect==="true",carries:number(v.carries),uses:number(v.uses),uniques:a.uniques||[]};delete obj.uniquesText;delete obj.unique;delete obj.performance;delete obj.maxPerformance;
      if(existing)c.analyses[c.analyses.findIndex(x=>x.id===a.id)]=obj;else c.analyses.push(obj);save();toast("解析E.G.Oを保存しました");
    });
  }

  function openCollectionForm(key, existing) {
    const labels={identities:"人格",passives:"サポートパッシブ",egos:"E.G.O"},label=labels[key]||"記録",item=existing||{};
    let fields=[];
    if(key==="identities") fields=[
      {name:"category",label:"分類",type:"select",value:item.category||"通常",options:[{value:"通常",label:"通常"},{value:"特異",label:"特異"},{value:"同期",label:"同期"}]},
      {name:"name",label:"名称",value:item.name||""},
      {name:"bodyEnhancementsText",label:"身体強化記入（1項目ずつ改行）",type:"textarea",value:(item.bodyEnhancements||[]).join("\n")}
    ];
    if(key==="egos") fields=[{name:"name",label:"E.G.O名",value:item.name||""},{name:"rank",label:"ランク",type:"select",value:item.rank||"ZAYIN",options:["ZAYIN","TETH","HE","WAW","ALEPH"].map(x=>({value:x,label:x}))}];
    if(key==="passives") fields=[{name:"name",label:"名称",value:item.name||""},{name:"category",label:"分類",type:"select",value:item.category||"通常",options:[{value:"通常",label:"通常"},{value:"死亡時",label:"死亡時"}]}];
    openForm(existing?`${label}を編集`:`${label}を追加`,fields,v=>{const c=active(),obj={...item,...v,id:item.id||uid()};if(key==="identities"){obj.bodyEnhancements=String(v.bodyEnhancementsText||"").split("\n").filter(x=>x.trim());delete obj.bodyEnhancementsText;}if(existing)c[key][c[key].findIndex(x=>x.id===item.id)]=obj;else c[key].push(obj);save();toast(`${label}を保存しました`);});
  }

  function openSpiritForm(existing) {
    const item=existing||{};
    openForm(existing?"精神を編集":"精神を追加",[{name:"name",label:"精神の名称",value:item.name||""}],v=>{const c=active(),obj={...item,...v,id:item.id||uid()};delete obj.note;if(existing)c.spirits[c.spirits.findIndex(x=>x.id===item.id)]=obj;else c.spirits.push(obj);save();toast("精神を保存しました");});
  }

  function utf8ToBase64Url(str) {
    const bytes=new TextEncoder().encode(str); let binary="";
    bytes.forEach(b=>binary+=String.fromCharCode(b));
    return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  function base64UrlToUtf8(str) {
    const base=str.replace(/-/g,"+").replace(/_/g,"/");
    const padded=base+"=".repeat((4-base.length%4)%4);
    const binary=atob(padded), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function checksum(str) {
    let h=2166136261;
    for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0).toString(16).padStart(8,"0");
  }
  async function compressToBase64Url(str) {
    if(typeof CompressionStream==="undefined") throw new Error("このブラウザは共有リンクの圧縮に対応していません。最新のChromeまたはEdgeを使用してください。");
    const stream=new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream("deflate"));
    const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
    let binary="";
    for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }
  async function decompressFromBase64Url(str) {
    if(typeof DecompressionStream==="undefined") throw new Error("このブラウザは圧縮された共有リンクの展開に対応していません。最新のChromeまたはEdgeを使用してください。");
    const base=str.replace(/-/g,"+").replace(/_/g,"/");
    const padded=base+"=".repeat((4-base.length%4)%4);
    const binary=atob(padded), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  // Compact key names reduce the input size before deflate. Decoded payloads
  // are expanded back to the ordinary field names used by the preview renderer.
  const SHARE_KEY_MAP={kind:"a",version:"b",name:"c",rank:"d",assignedBy:"e",requiredResources:"f",note:"g",uniques:"h",passiveName:"i",condition:"j",constantEffect:"k",effect:"l",corrosionEffect:"m",awakeningEffect:"n",unique:"o",affiliation:"p",hp:"q",san:"r",speed:"s",bullets:"t",slashResistance:"u",pierceResistance:"v",bluntResistance:"w",passive1Name:"x",passive1Condition:"y",passive1ConstantEffect:"z",passive1Effect:"A",showPassive2:"B",passive2Name:"C",passive2Condition:"D",passive2ConstantEffect:"E",passive2Effect:"F",tactics:"G",parentId:"H",id:"I",showPassive1Constant:"J",showPassive2Constant:"K",name2:"L",constantEffect2:"M",bodyEnhancements:"N",text:"O",title:"P",category:"Q",value:"R",label:"S",type:"T",children:"U",status:"V",description:"W",icon:"X",image:"Y"};
  const SHARE_KEY_REVERSE=Object.fromEntries(Object.entries(SHARE_KEY_MAP).map(([k,v])=>[v,k]));
  function transformShareKeys(value, mapping) {
    if(Array.isArray(value)) return value.map(item=>transformShareKeys(item,mapping));
    if(value && typeof value==="object") { const out={}; for(const [key,val] of Object.entries(value)) out[mapping[key]||key]=transformShareKeys(val,mapping); return out; }
    return value;
  }
  async function makeCompressedShareCode(payload) {
    const compact=JSON.stringify(transformShareKeys(payload,SHARE_KEY_MAP));
    // 6 hex chars retain a practical corruption check while reducing URL overhead.
    return `V3.${checksum(compact).slice(0,6)}.${await compressToBase64Url(compact)}`;
  }
  async function decodeShareCode(code) {
    const parts=String(code).trim().split(".");
    if(parts.length!==3) throw new Error("コード形式が正しくありません。");
    if(parts[0]==="TRPGVIEW1") return decodeCode(code,"TRPGVIEW1");
    if(parts[0]==="TRPGVIEW2") {
      const body=await decompressFromBase64Url(parts[2]);
      if(checksum(body)!==parts[1]) throw new Error("共有データの検査に失敗しました。リンクが欠けている可能性があります。");
      return JSON.parse(body);
    }
    if(parts[0]!=="V3") throw new Error("コード形式が正しくありません。");
    const compact=await decompressFromBase64Url(parts[2]);
    if(checksum(compact).slice(0,6)!==parts[1]) throw new Error("共有データの検査に失敗しました。リンクが欠けている可能性があります。");
    return transformShareKeys(JSON.parse(compact),SHARE_KEY_REVERSE);
  }
  function makeCode(payload, prefix="TRPG1") {
    const body=JSON.stringify(payload);
    return `${prefix}.${checksum(body)}.${utf8ToBase64Url(body)}`;
  }
  function decodeCode(code, prefix="TRPG1") {
    const parts=String(code).trim().split(".");
    if(parts.length!==3 || parts[0]!==prefix) throw new Error("コード形式が正しくありません。");
    const body=base64UrlToUtf8(parts[2]);
    if(checksum(body)!==parts[1]) throw new Error("コードの検査に失敗しました。入力が欠けている可能性があります。");
    const payload=JSON.parse(body);
    return payload;
  }
  function generateRestoreCode() {
    const scope=$("#exportScope").value;
    const payload=scope==="all" ? {kind:"all",version:1,activeCharacterId:state.activeCharacterId,characters:state.characters} : {kind:"character",version:1,character:active()};
    $("#exportCode").value=makeCode(payload);
    toast("復元コードを生成しました");
  }
  function importRestoreCode() {
    try {
      const payload=decodeCode($("#importCode").value);
      if(payload.version!==1) throw new Error("このコードのバージョンには対応していません。");
      if(payload.kind==="character" && payload.character && payload.character.name) {
        const incoming=payload.character; normalizeCharacter(incoming);
        if($("#importMode").value==="replace") { state={version:1,activeCharacterId:incoming.id,characters:[incoming]}; }
        else { const clone=structuredClone(incoming); clone.id=uid(); clone.name += "（読み込み）";state.characters.push(clone);state.activeCharacterId=clone.id; }
      } else if(payload.kind==="all" && Array.isArray(payload.characters) && payload.characters.length) {
        payload.characters.forEach(normalizeCharacter);
        if($("#importMode").value==="replace") state={version:1,activeCharacterId:payload.activeCharacterId,characters:payload.characters};
        else { const imported=payload.characters.map(ch=>({...structuredClone(ch),id:uid(),name:`${ch.name}（読み込み）`}));state.characters.push(...imported);state.activeCharacterId=imported[0].id; }
      } else throw new Error("復元コードに必要なデータがありません。");
      state.characters.forEach(normalizeCharacter);
      if(!state.characters.some(ch=>ch.id===state.activeCharacterId)) state.activeCharacterId=state.characters[0].id;
      save();toast("データを復元しました");
    } catch(e) { alert(`復元できませんでした。\n${e.message}`); }
  }
  function getShareApiBase() {
    if (!SHARE_API_BASE || SHARE_API_BASE.includes("YOUR-WORKER-NAME")) {
      throw new Error("共有リンク機能の設定が未完了です。READMEのCloudflare Workers設定手順に従い、app.jsのSHARE_API_BASEを設定してください。");
    }
    return SHARE_API_BASE.replace(/\/$/, "");
  }

async function createExternalShare(payload, existing = null) {
  const base = getShareApiBase();

  const requestData = { payload };

  if (existing) {
    requestData.id = existing.id;
    requestData.editToken = existing.editToken;
  }

  const response = await fetch(`${base}/api/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestData)
  });

  const body = await response.text();
  console.log("共有API:", response.status, body);

  let result = {};
  try {
    result = JSON.parse(body);
  } catch {}

  if (!response.ok || !result.id) {
    throw new Error(
      `共有APIエラー (${response.status}): ${body}`
    );
  }

  // 新規作成時は、更新に必要な情報も返す
  if (!existing) {
    if (!result.editToken) {
      throw new Error("更新用トークンを取得できませんでした。");
    }

    return {
      id: result.id,
      editToken: result.editToken
    };
  }

  return {
    id: result.id,
    editToken: existing.editToken
  };
}

  async function fetchExternalShare(id) {
    const base = getShareApiBase();
    const response = await fetch(`${base}/api/share/${encodeURIComponent(id)}`);
    const result = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error("共有データの有効期限が切れたか、存在しません。");
    if (!response.ok || !result.payload) throw new Error(result.error || "共有データを取得できませんでした。");
    return result.payload;
  }
  
async function showExternalShareLink(title, payload, help) {
  try {
    const storageKey = `shareEdit:${payload.kind}:${payload.name}`;
    const saved = localStorage.getItem(storageKey);
    const existing = saved ? JSON.parse(saved) : null;

    const action = existing
      ? confirm(
          "この記録の共有リンクは既にあります。\n\n" +
          "「OK」：既存リンクを更新\n" +
          "「キャンセル」：新しいリンクを作成"
        )
      : false;

    const result = await createExternalShare(
      payload,
      action ? existing : null
    );

    // 新規作成・更新後のIDと編集用トークンを保存
    localStorage.setItem(storageKey, JSON.stringify(result));

    const url = new URL(window.location.href);
    url.hash = `s=${encodeURIComponent(result.id)}`;

    openForm(title, [
      {
        name: "shareUrl",
        label: "共有リンク",
        value: url.toString(),
        required: true,
        help: `${help} 同じブラウザから次回更新できます。`
      }
    ], v => copyText(v.shareUrl));

    setTimeout(() => {
      const input = $("#f_shareUrl");
      if (input) {
        input.readOnly = true;
        input.addEventListener("focus", () => input.select());
      }
    }, 0);
  } catch (e) {
    alert(`共有リンクを作成・更新できませんでした。\n${e.message}`);
  }
}

  async function generateShareLink(a) {
    const payload={kind:"analysis-preview",version:1,name:a.name,rank:a.rank||"ZAYIN",assignedBy:a.assignedBy||"",requiredResources:a.requiredResources||"",note:a.note||"",uniques:a.uniques||[],passiveName:a.passiveName||"",condition:a.condition||"",constantEffect:a.showConstantEffect?(a.constantEffect||""):"",effect:a.effect||"",corrosionEffect:a.corrosionEffect||"",awakeningEffect:a.awakeningEffect||"",unique:a.unique||""};
    await showExternalShareLink("解析E.G.Oの共有リンク", payload, "解析E.G.Oの記録内容を含みます。リンクを受け取った人は閲覧できます。");
  }
  async function generateSyncShareLink(s) {
    const payload={kind:"sync-preview",version:1,name:s.name||"名称未設定",rank:s.rank||"0",affiliation:s.affiliation||"",assignedBy:s.assignedBy||"",hp:s.hp||"",san:s.san||"",speed:s.speed||"",bullets:s.bullets||"",slashResistance:s.slashResistance||"",pierceResistance:s.pierceResistance||"",bluntResistance:s.bluntResistance||"",passive1Name:s.passive1Name||s.passive1||"",passive1Condition:s.passive1Condition||"",passive1ConstantEffect:s.showPassive1Constant?(s.passive1ConstantEffect||""):"",passive1Effect:s.passive1Effect||"",showPassive2:!!s.showPassive2,passive2Name:s.passive2Name||s.passive2||"",passive2Condition:s.passive2Condition||"",passive2ConstantEffect:s.showPassive2Constant?(s.passive2ConstantEffect||""):"",passive2Effect:s.passive2Effect||"",tactics:(s.tactics||[]).map(t=>({name:t.name||"",effect:t.effect||"",parentId:t.parentId||"",id:t.id||""})),uniques:s.uniques||[],note:s.note||""};
    await showExternalShareLink("同期人格の共有リンク", payload, "同期人格の性能情報を含みます。リンクを受け取った人は閲覧できます。");
  }
  async function renderPreviewIfNeeded() {
    const externalMatch=location.hash.match(/(?:^#|&)s=([A-Za-z0-9_-]{12})/);
    const legacyMatch=location.hash.match(/(?:^#|&)preview=([^&]+)/);
    if(!externalMatch && !legacyMatch) return false;
    try {
      const payload=externalMatch
        ? await fetchExternalShare(decodeURIComponent(externalMatch[1]))
        : await decodeShareCode(decodeURIComponent(legacyMatch[1]));
      if(payload.version!==1 || !["analysis-preview","sync-preview"].includes(payload.kind)) throw new Error("共有データの形式が正しくありません。");
      

const shareTitle = `共有：${payload.name || "名称未設定"} || LBT記録管理室`;

document.title = shareTitle;

document.querySelector('meta[property="og:title"]')
  ?.setAttribute("content", shareTitle);

document.querySelector('meta[name="twitter:title"]')
  ?.setAttribute("content", shareTitle);

document.querySelector('meta[name="description"]')
  ?.setAttribute("content", shareTitle);

document.querySelector('meta[property="og:description"]')
  ?.setAttribute("content", shareTitle);

document.querySelector('meta[name="twitter:description"]')
  ?.setAttribute("content", shareTitle);


if (payload.kind === "sync-preview") {

  const showPassive = (n) => {
    const name = payload[`passive${n}Name`],
      condition = payload[`passive${n}Condition`],
      constant = payload[`passive${n}ConstantEffect`],
      effect = payload[`passive${n}Effect`];

    if (n === 2 && !payload.showPassive2) return "";
    if (![name, condition, constant, effect].some(x => String(x || "").trim())) return "";

    return `<section class="subpanel"><h3>人格パッシブ${n}：${escapeHTML(name || "名称未登録")}</h3><p><strong>条件：</strong>${escapeHTML(condition || "—").replace(/\n/g, "<br>")}</p>${constant ? `<p><strong>常時効果：</strong>${escapeHTML(constant).replace(/\n/g, "<br>")}</p>` : ""}<p><strong>効果：</strong>${escapeHTML(effect || "—").replace(/\n/g, "<br>")}</p></section>`;
  };

  const roots = (payload.tactics || []).filter(t => !t.parentId);
  const branches = (payload.tactics || []).filter(t => t.parentId);

  const tacticHTML = [...roots, ...branches]
    .filter(t => t.name || t.effect)
    .map(t => `<section class="subpanel"><h4>${escapeHTML(t.name || "戦術")}</h4><p>${escapeHTML(t.effect || "").replace(/\n/g, "<br>")}</p></section>`)
    .join("");

  document.body.innerHTML = `<main class="preview-page"><div class="preview-brand"><p class="eyebrow">SYNCHRONIZED IDENTITY · SHARED PREVIEW</p><h1>${escapeHTML(payload.name || "共有プレビュー")}</h1><p class="muted">閲覧専用の共有ページです。</p></div><article class="panel"><p class="eyebrow">SYNCHRONIZED IDENTITY</p><h2>${escapeHTML(payload.name)}</h2><p><strong>RANK：</strong>${escapeHTML(payload.rank || "0")}　<strong>所属：</strong>${escapeHTML(payload.affiliation || "—")}　<strong>同期担当者：</strong>${escapeHTML(payload.assignedBy || "—")}</p><div class="statline"><span class="pill">HP ${escapeHTML(payload.hp || "—")}</span><span class="pill">SAN ${escapeHTML(payload.san || "—")}</span><span class="pill">速度 ${escapeHTML(payload.speed || "—")}</span>${String(payload.bullets || "").trim() ? `<span class="pill">弾丸 ${escapeHTML(payload.bullets)}</span>` : ""}</div><p><strong>耐性：</strong>斬撃 ${escapeHTML(payload.slashResistance || "—")} ／ 貫通 ${escapeHTML(payload.pierceResistance || "—")} ／ 打撃 ${escapeHTML(payload.bluntResistance || "—")}</p><h3>j人格パッシブ</h3>${showPassive(1)}${showPassive(2)}<h3>戦術</h3>${tacticHTML || "<p>戦術の記録はありません。</p>"}${(payload.uniques || []).some(x => x.name || x.effect) ? `<h3>固有</h3>${payload.uniques.map(x => `<section class="subpanel"><strong>${escapeHTML(x.name || "固有")}</strong><p>${escapeHTML(x.effect || "").replace(/\n/g, "<br>")}</p></section>`).join("")}` : ""}${payload.note ? `<h3>メモ</h3><p>${escapeHTML(payload.note).replace(/\n/g, "<br>")}</p>` : ""}<div class="notice" style="margin-top:22px">このページは共有された性能情報のプレビューです。元のキャラクターデータを変更することはできません。</div></article><p class="footer-note">LOCAL ARCHIVE SYSTEM · SHARED PREVIEW</p></main>`;
}
else {
        document.body.innerHTML=`<main class="preview-page"><div class="preview-brand"><p class="eyebrow">SYNCHRONIZATION ANALYSIS · SHARED PREVIEW</p><h1>${escapeHTML(payload.name || "共有プレビュー")}</h1><p class="muted">閲覧専用の共有ページです。</p></div><article class="panel"><p class="eyebrow">ANALYSIS RECORD</p><h2>${escapeHTML(payload.name)}</h2><p><strong>ランク：</strong>${escapeHTML(payload.rank||"ZAYIN")}　<strong>担当者：</strong>${escapeHTML(payload.assignedBy||"—")}</p><h3>E.G.Oパッシブ：${escapeHTML(payload.passiveName||"名称未登録")}</h3><p><strong>条件：</strong>${escapeHTML(payload.condition||"—")}</p>${payload.constantEffect?`<p><strong>常時効果：</strong>${escapeHTML(payload.constantEffect).replace(/\n/g,"<br>")}</p>`:""}<p><strong>効果：</strong>${escapeHTML(payload.effect||"—").replace(/\n/g,"<br>")}</p>${payload.awakeningEffect?`<p><strong>覚醒効果</strong><br>${escapeHTML(payload.awakeningEffect).replace(/\n/g,"<br>")}</p>`:""}${payload.corrosionEffect?`<p><strong>浸食効果</strong><br>${escapeHTML(payload.corrosionEffect).replace(/\n/g,"<br>")}</p>`:""}${(payload.uniques||[]).some(x=>x.name||x.effect)?`<h3>固有</h3>${payload.uniques.map(x=>`<p><strong>${escapeHTML(x.name||"固有")}</strong><br>${escapeHTML(x.effect||"").replace(/\n/g,"<br>")}</p>`).join("")}`:payload.unique?`<p><strong>固有</strong><br>${escapeHTML(payload.unique).replace(/\n/g,"<br>")}</p>`:""}${payload.note?`<p><strong>メモ：</strong>${escapeHTML(payload.note).replace(/\n/g,"<br>")}</p>`:""}<div class="notice" style="margin-top:22px">このページは共有された性能情報のプレビューです。元のキャラクターデータを変更することはできません。</div></article><p class="footer-note">LOCAL ARCHIVE SYSTEM · SHARED PREVIEW</p></main>`;
      }
      return true;
    } catch(e) {
      document.body.innerHTML=`<main class="preview-page"><h1>共有リンクを読み込めません</h1><p>${escapeHTML(e.message)}</p><p>リンクが途中で切れていないか確認してください。</p></main>`;
      return true;
    }
  }
  async function copyText(text) {
    if(!text){toast("コピーする内容がありません");return;}
    try { await navigator.clipboard.writeText(text); toast("コピーしました"); }
    catch(e) { const temp=document.createElement("textarea");temp.value=text;document.body.appendChild(temp);temp.select();const ok=document.execCommand("copy");temp.remove();toast(ok?"コピーしました":"コピーできませんでした。手動で選択してください"); }
  }
  function exportJSON() {
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url;a.download=`trpg-record-backup-${today()}.json`;a.click();URL.revokeObjectURL(url);toast("JSONを書き出しました");
  }
  function handleJSONFile(e) {
    const file=e.target.files?.[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!Array.isArray(parsed.characters)||!parsed.characters.length)throw new Error("キャラクターデータが見つかりません");confirmAction("JSONバックアップを読み込みますか？","現在のデータをバックアップファイルの内容で置き換えます。",()=>{parsed.characters.forEach(normalizeCharacter);state=parsed;if(!state.characters.some(c=>c.id===state.activeCharacterId))state.activeCharacterId=state.characters[0].id;save();toast("JSONを復元しました");});}catch(err){alert(`JSONを読み込めませんでした。\n${err.message}`);}e.target.value="";};
    reader.readAsText(file);
  }

  $("#menuToggle").addEventListener("click",()=>{const layout=$(".layout"), collapsed=layout.classList.toggle("menu-collapsed");$("#menuToggle").setAttribute("aria-expanded",String(!collapsed));$("#menuToggle").textContent=collapsed?"☰ ARCHIVE MENU":"× ARCHIVE MENU";});
  $("#characterSelect").addEventListener("change",e=>{state.activeCharacterId=e.target.value;save();});
  $("#addCharacterBtn").addEventListener("click",()=>openForm("キャラクターを追加",[{name:"name",label:"キャラクター名",required:true}],v=>{const c=emptyCharacter((v.name||"").trim() || "名称未設定");state.characters.push(c);state.activeCharacterId=c.id;save();toast("キャラクターを追加しました");}));
  $$(".nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));

  renderPreviewIfNeeded().then(isPreview=>{if(!isPreview) renderAll();}).catch(e=>{document.body.innerHTML=`<main class="preview-page"><h1>共有リンクを読み込めません</h1><p>${escapeHTML(e.message)}</p></main>`;});

})();
