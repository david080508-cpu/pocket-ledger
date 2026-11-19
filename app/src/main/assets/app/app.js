/* 口袋账本 —— 应用逻辑
 * 纯前端、零依赖。数据存在 WebView 的 localStorage；
 * 在浏览器中打开同一份页面也有完整功能（导出走 Blob 下载）。
 *
 * 一句话记账的解析逻辑在 nlp.js（window.PocketNlp.parse）。
 */
(function () {
  'use strict';

  var STORE_KEY = 'pocket.ledger.v1';
  var THEME_KEY = 'pocket.ledger.theme';
  var APP_VERSION = '1.0.0';
  var REPO_URL = 'https://github.com/david080508-cpu/pocket-ledger';

  var CATS = {
    expense: [
      { id: 'food', name: '餐饮', icon: '🍜', color: '#f97316' },
      { id: 'transport', name: '交通', icon: '🚌', color: '#3b82f6' },
      { id: 'shopping', name: '购物', icon: '🛍️', color: '#ec4899' },
      { id: 'home', name: '居住', icon: '🏠', color: '#8b5cf6' },
      { id: 'fun', name: '娱乐', icon: '🎮', color: '#14b8a6' },
      { id: 'health', name: '医疗', icon: '💊', color: '#ef4444' },
      { id: 'study', name: '学习', icon: '📚', color: '#6366f1' },
      { id: 'telecom', name: '通讯', icon: '📱', color: '#0ea5e9' },
      { id: 'social', name: '人情', icon: '🎁', color: '#d946ef' },
      { id: 'other', name: '其他', icon: '📦', color: '#94a3b8' }
    ],
    income: [
      { id: 'salary', name: '工资', icon: '💰', color: '#16a34a' },
      { id: 'bonus', name: '奖金', icon: '🎉', color: '#f59e0b' },
      { id: 'invest', name: '理财', icon: '📈', color: '#0d9488' },
      { id: 'redpacket', name: '红包', icon: '🧧', color: '#dc2626' },
      { id: 'parttime', name: '兼职', icon: '💻', color: '#2563eb' },
      { id: 'other', name: '其他', icon: '📦', color: '#94a3b8' }
    ]
  };

  var SAMPLES = [
    '妈妈给了我50块钱，然后中饭花了25块钱',
    '昨天打车35，午饭吃面18',
    '发工资8000，交房租2500',
    '买了双鞋399，红包收了200'
  ];

  var state = {
    records: [],
    month: monthKey(new Date()),
    filter: 'all',
    editing: null
  };

  /* ---------------- 基础工具 ---------------- */

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  function dateKey(d) { return monthKey(d) + '-' + pad2(d.getDate()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function money(cents) {
    var neg = cents < 0;
    var v = Math.abs(Math.round(cents));
    var s = (v / 100).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '¥' + parts[0] + '.' + parts[1];
  }
  function shortMoney(cents) {
    var v = Math.round(cents) / 100;
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    if (v >= 1000) return Math.round(v) + '';
    return v.toFixed(v % 1 === 0 ? 0 : 1);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  /* ---------------- 数据 ---------------- */

  function normalize(rec) {
    if (!rec || typeof rec !== 'object') return null;
    var cents = Math.round(Number(rec.amountCents));
    if (!isFinite(cents) || cents === 0) return null;
    var type = rec.type === 'income' ? 'income' : 'expense';
    var date = /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : dateKey(new Date());
    return {
      id: String(rec.id || uid()),
      type: type,
      amountCents: Math.abs(cents),
      category: String(rec.category || 'other'),
      note: String(rec.note || '').slice(0, 60),
      date: date,
      createdAt: Number(rec.createdAt) || Date.now()
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var list = Array.isArray(data) ? data : (data && data.records) || [];
      state.records = list.map(normalize).filter(Boolean);
    } catch (e) {
      console.warn('读取本地数据失败', e);
    }
  }

  function save() {
    var payload = { version: 1, updatedAt: Date.now(), records: state.records };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch (e) {
      toast('保存失败，存储空间可能已满');
    }
  }

  function recordsOf(month) {
    return state.records
      .filter(function (r) { return r.date.slice(0, 7) === month; })
      .sort(function (a, b) {
        if (a.date === b.date) return b.createdAt - a.createdAt;
        return a.date < b.date ? 1 : -1;
      });
  }

  function sumOf(list, type) {
    return list.reduce(function (s, r) { return r.type === type ? s + r.amountCents : s; }, 0);
  }

  function catOf(type, id) {
    var list = CATS[type] || CATS.expense;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[list.length - 1];
  }

  /* ---------------- 月份 ---------------- */

  function monthTitle(key) {
    var p = key.split('-');
    return Number(p[0]) + '年' + Number(p[1]) + '月';
  }

  function shiftMonth(delta) {
    var p = state.month.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
    state.month = monthKey(d);
    state.filter = 'all';
    renderAll();
  }

  function isCurrentMonth(key) { return key === monthKey(new Date()); }

  /* ---------------- 明细 ---------------- */

  function renderHome() {
    var list = recordsOf(state.month);
    var expense = sumOf(list, 'expense');
    var income = sumOf(list, 'income');

    $('#monthLabel').textContent = monthTitle(state.month);
    $('#monthLabel2').textContent = monthTitle(state.month);
    $('#sumExpense').textContent = money(expense);
    $('#sumIncome').textContent = money(income);
    var balance = income - expense;
    var bal = $('#sumBalance');
    bal.textContent = money(balance);
    bal.style.color = balance < 0 ? '#b4230a' : '';

    renderChips(list);

    var filtered = state.filter === 'all'
      ? list
      : list.filter(function (r) { return r.type === 'expense' && r.category === state.filter; });

    var box = $('#recordList');
    box.innerHTML = '';

    if (!filtered.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('span', 'big', isCurrentMonth(state.month) ? '🧾' : '📭'));
      empty.appendChild(el('p', '', isCurrentMonth(state.month) ? '还没有记录' : '这个月没有记录'));
      empty.appendChild(el('p', '', isCurrentMonth(state.month) ? '点下面的「记账」，或说一句话试试' : '用左上角切换月份'));
      box.appendChild(empty);
      return;
    }

    var byDate = {}, order = [];
    filtered.forEach(function (r) {
      if (!byDate[r.date]) { byDate[r.date] = []; order.push(r.date); }
      byDate[r.date].push(r);
    });

    var today = dateKey(new Date());
    var yesterday = dateKey(new Date(Date.now() - 86400000));
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    order.forEach(function (date) {
      var items = byDate[date];
      var dayExp = sumOf(items, 'expense');
      var dayInc = sumOf(items, 'income');
      var p = date.split('-');
      var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      var label = date === today ? '今天' : date === yesterday ? '昨天'
        : Number(p[1]) + '月' + Number(p[2]) + '日 ' + week[d.getDay()];

      var head = el('div', 'day-head');
      head.appendChild(el('span', '', label));
      var right = (dayExp ? '支出 ' + money(dayExp) : '') + (dayExp && dayInc ? ' · ' : '') + (dayInc ? '收入 ' + money(dayInc) : '');
      head.appendChild(el('b', '', right));
      box.appendChild(head);

      items.forEach(function (r) { box.appendChild(recordRow(r)); });
    });
  }

  function recordRow(r) {
    var c = catOf(r.type, r.category);
    var row = el('div', 'rec');
    row.setAttribute('role', 'button');
    var ico = el('div', 'ico', c.icon);
    if (c.color) ico.style.background = hexAlpha(c.color, .14);

    var body = el('div', 'body');
    body.appendChild(el('b', '', c.name + (r.type === 'income' ? '（收入）' : '')));
    body.appendChild(el('i', '', r.note || '无备注'));

    var amt = el('div', 'amt ' + r.type, (r.type === 'income' ? '+' : '-') + money(r.amountCents));

    row.appendChild(ico); row.appendChild(body); row.appendChild(amt);
    row.addEventListener('click', function () { openEditor(r); });
    return row;
  }

  function hexAlpha(hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function renderChips(list) {
    var box = $('#quickChips');
    box.innerHTML = '';
    var used = {};
    list.forEach(function (r) { if (r.type === 'expense') used[r.category] = (used[r.category] || 0) + r.amountCents; });
    var ids = Object.keys(used).sort(function (a, b) { return used[b] - used[a]; }).slice(0, 6);
    if (!ids.length) return;

    var all = el('button', 'chip' + (state.filter === 'all' ? ' on' : ''), '全部');
    all.type = 'button';
    all.addEventListener('click', function () { state.filter = 'all'; renderHome(); });
    box.appendChild(all);

    ids.forEach(function (id) {
      var c = catOf('expense', id);
      var chip = el('button', 'chip' + (state.filter === id ? ' on' : ''), c.icon + ' ' + c.name);
      chip.type = 'button';
      chip.addEventListener('click', function () {
        state.filter = state.filter === id ? 'all' : id;
        renderHome();
      });
      box.appendChild(chip);
    });
  }

  /* ---------------- 图表 ---------------- */

  function renderStats() {
    var list = recordsOf(state.month);
    var expense = sumOf(list, 'expense');
    var expList = list.filter(function (r) { return r.type === 'expense'; });

    $('#stExpense').textContent = money(expense);
    var p = state.month.split('-');
    var daysInMonth = new Date(Number(p[0]), Number(p[1]), 0).getDate();
    var days = isCurrentMonth(state.month) ? new Date().getDate() : daysInMonth;
    $('#stAvg').textContent = money(days ? expense / days : 0);
    $('#stCount').textContent = String(list.length);

    var byCat = {};
    expList.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + r.amountCents; });
    var cats = Object.keys(byCat).map(function (id) {
      return { id: id, amount: byCat[id] };
    }).sort(function (a, b) { return b.amount - a.amount; });

    var box = $('#catBreakdown');
    box.innerHTML = '';
    if (!cats.length) {
      box.appendChild(el('div', 'empty', '本月还没有支出记录'));
    } else {
      var max = cats[0].amount || 1;
      cats.forEach(function (item) {
        var c = catOf('expense', item.id);
        var pct = Math.round(item.amount / expense * 100);
        var row = el('div', 'cat-row');
        row.appendChild(el('div', 'ico', c.icon));
        var grow = el('div', 'grow');
        var line = el('div', 'line1');
        line.appendChild(el('span', '', c.name));
        var right = el('span', '');
        right.appendChild(el('i', '', pct + '% · '));
        right.appendChild(document.createTextNode(money(item.amount)));
        line.appendChild(right);
        grow.appendChild(line);
        var track = el('div', 'track');
        var fill = el('div', 'fill');
        fill.style.width = Math.max(2, Math.round(item.amount / max * 100)) + '%';
        fill.style.background = c.color;
        track.appendChild(fill);
        grow.appendChild(track);
        row.appendChild(grow);
        box.appendChild(row);
      });
    }

    renderBars();
  }

  function renderBars() {
    var box = $('#monthBars');
    box.innerHTML = '';
    var p = state.month.split('-');
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(Number(p[0]), Number(p[1]) - 1 - i, 1);
      months.push({ key: monthKey(d), label: (d.getMonth() + 1) + '月' });
    }
    var values = months.map(function (m) { return sumOf(recordsOf(m.key), 'expense'); });
    var max = Math.max.apply(null, values.concat([1]));

    months.forEach(function (m, idx) {
      var col = el('div', 'col');
      col.appendChild(el('div', 'val', values[idx] ? shortMoney(values[idx]) : ''));
      var wrap = el('div', '');
      wrap.style.cssText = 'flex:1;display:flex;align-items:flex-end;width:100%';
      var stick = el('div', 'stick');
      stick.style.height = Math.max(3, Math.round(values[idx] / max * 100)) + '%';
      if (!values[idx]) stick.style.opacity = '.2';
      if (m.key === state.month) stick.style.background = 'var(--expense)';
      wrap.appendChild(stick);
      col.appendChild(wrap);
      col.appendChild(el('div', 'cap', m.label));
      box.appendChild(col);
    });
  }

  /* ---------------- 汇总渲染 ---------------- */

  function renderAll() {
    renderHome();
    renderStats();
    $('#appVersion').textContent = APP_VERSION;
  }

  /* ---------------- 视图切换 ---------------- */

  function switchView(name) {
    var map = { home: '#view-home', stats: '#view-stats', settings: '#view-settings' };
    Object.keys(map).forEach(function (k) {
      $(map[k]).classList.toggle('active', k === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-view]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    if (name === 'stats') renderStats();
    window.scrollTo(0, 0);
  }

  /* ---------------- 记账面板 ---------------- */

  var editor = null;

  function openEditor(rec) {
    editor = rec
      ? { id: rec.id, type: rec.type, amount: (rec.amountCents / 100).toFixed(2), category: rec.category, date: rec.date, note: rec.note }
      : {
          id: null,
          type: 'expense',
          amount: '0',
          category: 'food',
          date: isCurrentMonth(state.month) ? dateKey(new Date()) : state.month + '-01',
          note: ''
        };

    Array.prototype.forEach.call($('#typeSeg').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === editor.type);
    });
    $('#btnDelete').hidden = !editor.id;
    $('#dateInput').value = editor.date;
    $('#noteInput').value = editor.note;
    paintAmount();
    paintCats();

    $('#scrim').classList.add('on');
    $('#sheet').classList.add('on');
    $('#sheet').setAttribute('aria-hidden', 'false');
  }

  function closeEditor() {
    $('#scrim').classList.remove('on');
    $('#sheet').classList.remove('on');
    $('#sheet').setAttribute('aria-hidden', 'true');
    editor = null;
  }

  function paintAmount() {
    var n = Number(editor.amount);
    $('#amountText').textContent = isFinite(n) ? n.toFixed(2) : '0.00';
  }

  function paintCats() {
    var box = $('#cats');
    box.innerHTML = '';
    CATS[editor.type].forEach(function (c) {
      var b = el('button', 'cat' + (editor.category === c.id ? ' on' : ''));
      b.type = 'button';
      var circle = el('span', '', c.icon);
      if (editor.category === c.id) circle.style.background = hexAlpha(c.color, .3);
      b.appendChild(circle);
      var name = el('em', '', c.name);
      name.style.cssText = 'font-style:normal';
      b.appendChild(name);
      b.addEventListener('click', function () {
        editor.category = c.id;
        paintCats();
      });
      box.appendChild(b);
    });
  }

  function pressKey(k) {
    if (!editor) return;
    var v = editor.amount === '0' ? '' : editor.amount;

    if (k === 'del') {
      v = v.slice(0, -1);
      editor.amount = v === '' ? '0' : v;
    } else if (k === '.') {
      if (v.indexOf('.') === -1) editor.amount = (v === '' ? '0' : v) + '.';
    } else {
      var dot = v.indexOf('.');
      if (dot !== -1 && v.length - dot > 2) return;
      if (dot === -1 && v.replace('.', '').length >= 8) return;
      if (v === '' && k === '0') { editor.amount = '0'; paintAmount(); return; }
      editor.amount = v + k;
    }
    paintAmount();
  }

  function currentAmountCents() {
    var n = Number(editor.amount);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }

  function saveRecord() {
    if (!editor) return;
    var cents = currentAmountCents();
    if (!cents) { toast('请输入金额'); return; }
    var isEdit = !!editor.id;
    var rec = normalize({
      id: editor.id || uid(),
      type: editor.type,
      amountCents: cents,
      category: editor.category,
      note: $('#noteInput').value.trim(),
      date: $('#dateInput').value || dateKey(new Date()),
      createdAt: Date.now()
    });
    if (!rec) { toast('保存失败'); return; }

    if (isEdit) {
      for (var i = 0; i < state.records.length; i++) {
        if (state.records[i].id === editor.id) {
          rec.createdAt = state.records[i].createdAt;
          state.records[i] = rec;
          break;
        }
      }
    } else {
      state.records.push(rec);
    }

    state.month = rec.date.slice(0, 7);
    save();
    renderAll();
    closeEditor();
    toast(isEdit ? '已更新' : '已记一笔');
  }

  function deleteRecord() {
    if (!editor || !editor.id) return;
    if (!confirm('删除这条记录？')) return;
    var id = editor.id;
    state.records = state.records.filter(function (r) { return r.id !== id; });
    save();
    renderAll();
    closeEditor();
    toast('已删除');
  }

  /* ---------------- 一句话记账 ---------------- */

  var talkItems = [];

  function openTalk() {
    $('#talk').classList.add('on');
    $('#talk').setAttribute('aria-hidden', 'false');
    $('#talkInput').focus();
  }

  function closeTalk() {
    $('#talk').classList.remove('on');
    $('#talk').setAttribute('aria-hidden', 'true');
    if (document.activeElement) document.activeElement.blur();
  }

  function renderTalkSamples() {
    var box = $('#talkSamples');
    box.innerHTML = '';
    SAMPLES.forEach(function (s) {
      var b = el('button', 'sample', s);
      b.type = 'button';
      b.addEventListener('click', function () {
        $('#talkInput').value = s;
        runParse();
      });
      box.appendChild(b);
    });
  }

  function runParse() {
    var text = $('#talkInput').value.trim();
    var resultBox = $('#talkResult');
    if (!text) { toast('先说一句，例如：中饭花了25'); return; }

    var res = window.PocketNlp ? window.PocketNlp.parse(text) : { items: [], summary: { income: 0, expense: 0, net: 0 } };
    resultBox.innerHTML = '';
    talkItems = res.items.map(function (it) { return it; });

    if (!talkItems.length) {
      $('#talkFoot').hidden = true;
      var empty = el('div', 'empty');
      empty.appendChild(el('span', 'big', '🤔'));
      empty.appendChild(el('p', '', '没找到金额'));
      empty.appendChild(el('p', '', '试试「中饭花了25」「收到红包200」'));
      resultBox.appendChild(empty);
      return;
    }

    talkItems.forEach(function (it, idx) {
      resultBox.appendChild(talkRow(it, idx));
    });
    $('#talkFoot').hidden = false;
    updateTalkTotals();
  }

  function talkRow(it, idx) {
    var row = el('div', 'p-item');
    var c = catOf(it.type, it.category);

    var ico = el('div', 'ico', c.icon);
    ico.style.background = hexAlpha(c.color, .16);

    var body = el('div', 'body');
    body.appendChild(el('b', '', c.name));
    var sub = (it.note ? it.note + ' · ' : '') + it.date.slice(5);
    body.appendChild(el('i', '', sub));

    var typeBtn = el('button', 'p-type ' + it.type, it.type === 'income' ? '收入' : '支出');
    typeBtn.type = 'button';
    typeBtn.addEventListener('click', function () {
      it.type = it.type === 'income' ? 'expense' : 'income';
      typeBtn.className = 'p-type ' + it.type;
      typeBtn.textContent = it.type === 'income' ? '收入' : '支出';
      if (it.type === 'expense' && !CATS.expense.some(function (x) { return x.id === it.category; })) {
        it.category = 'other';
      }
      if (it.type === 'income' && !CATS.income.some(function (x) { return x.id === it.category; })) {
        it.category = 'other';
      }
      var c2 = catOf(it.type, it.category);
      ico.textContent = c2.icon;
      body.querySelector('b').textContent = c2.name;
      updateTalkTotals();
    });

    var amt = el('div', 'amt ' + it.type, (it.type === 'income' ? '+' : '-') + money(it.amountCents));

    var del = el('button', 'p-del', '✕');
    del.type = 'button';
    del.addEventListener('click', function () {
      row.remove();
      talkItems[idx] = null;
      updateTalkTotals();
    });

    row.appendChild(ico);
    row.appendChild(body);
    row.appendChild(typeBtn);
    row.appendChild(amt);
    row.appendChild(del);
    return row;
  }

  function updateTalkTotals() {
    var income = 0, expense = 0, live = 0;
    talkItems.forEach(function (it) {
      if (!it) return;
      live++;
      if (it.type === 'income') income += it.amountCents;
      else expense += it.amountCents;
    });

    var box = $('#talkTotals');
    box.innerHTML = '';
    var line = el('span', '');
    line.appendChild(document.createTextNode('共 ' + live + ' 笔 · 收入 '));
    var inc = el('span', 'inc', '+¥' + (income / 100).toFixed(2));
    line.appendChild(inc);
    line.appendChild(document.createTextNode(' 支出 '));
    var exp = el('span', 'exp', '-¥' + (expense / 100).toFixed(2));
    line.appendChild(exp);
    box.appendChild(line);

    var net = income - expense;
    var b = el('b', '');
    b.textContent = '本次结余 ' + (net >= 0 ? '+' : '-') + '¥' + (Math.abs(net) / 100).toFixed(2);
    box.appendChild(b);

    $('#talkSaveAll').disabled = live === 0;
    $('#talkSaveAll').style.opacity = live === 0 ? '.5' : '';
  }

  function saveTalkAll() {
    var live = talkItems.filter(Boolean);
    if (!live.length) { toast('没有可记的内容'); return; }

    live.forEach(function (it, i) {
      var rec = normalize({
        id: uid(),
        type: it.type,
        amountCents: it.amountCents,
        category: it.category,
        note: it.note,
        date: it.date,
        createdAt: Date.now() + i
      });
      if (rec) state.records.push(rec);
    });

    state.month = live[0].date.slice(0, 7);
    state.filter = 'all';
    save();
    renderAll();
    closeTalk();
    $('#talkInput').value = '';
    $('#talkResult').innerHTML = '';
    $('#talkFoot').hidden = true;
    switchView('home');
    toast('已记 ' + live.length + ' 笔');
  }

  /* ---------------- 导入导出 ---------------- */

  function download(name, mime, content) {
    if (window.Native && typeof window.Native.saveFile === 'function') {
      try {
        var msg = window.Native.saveFile(name, mime, content);
        toast(msg || '已保存');
        return;
      } catch (e) {
        toast('保存失败：' + e);
        return;
      }
    }
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('已开始下载');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    if (!state.records.length) { toast('还没有记录可导出'); return; }
    var list = state.records.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var lines = ['日期,类型,分类,金额(元),备注'];
    list.forEach(function (r) {
      lines.push([
        r.date,
        r.type === 'income' ? '收入' : '支出',
        catOf(r.type, r.category).name,
        (r.amountCents / 100).toFixed(2),
        r.note
      ].map(csvCell).join(','));
    });
    download('口袋账本-' + dateKey(new Date()) + '.csv', 'text/csv', '\ufeff' + lines.join('\r\n'));
  }

  function exportJson() {
    if (!state.records.length) { toast('还没有记录可备份'); return; }
    var payload = { app: 'pocket-ledger', version: 1, exportedAt: new Date().toISOString(), records: state.records };
    download('口袋账本备份-' + dateKey(new Date()) + '.json', 'application/json', JSON.stringify(payload, null, 2));
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        toast('不是有效的 JSON 文件');
        return;
      }
      var list = Array.isArray(data) ? data : (data && data.records);
      if (!Array.isArray(list)) { toast('文件里没有记录'); return; }
      var parsed = list.map(normalize).filter(Boolean);
      if (!parsed.length) { toast('没有可导入的记录'); return; }
      if (!confirm('导入 ' + parsed.length + ' 条记录，并覆盖当前数据？')) return;
      state.records = parsed;
      save();
      renderAll();
      toast('已导入 ' + parsed.length + ' 条');
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!state.records.length) { toast('没有数据'); return; }
    if (!confirm('将删除全部 ' + state.records.length + ' 条记录，确定吗？')) return;
    if (!confirm('再确认一次：此操作不可恢复。')) return;
    state.records = [];
    save();
    renderAll();
    toast('已清空');
  }

  /* ---------------- 主题 ---------------- */

  function applyTheme(mode) {
    var html = document.documentElement;
    if (mode === 'system') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', mode);
    $('#themeSelect').value = mode;
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
  }

  function toggleTheme() {
    applyTheme($('#themeSelect').value === 'dark' ? 'light' : 'dark');
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab[data-view]'), function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });

    $('#prevMonth').addEventListener('click', function () { shiftMonth(-1); });
    $('#nextMonth').addEventListener('click', function () { shiftMonth(1); });
    $('#prevMonth2').addEventListener('click', function () { shiftMonth(-1); });
    $('#nextMonth2').addEventListener('click', function () { shiftMonth(1); });

    $('#fab').addEventListener('click', function () { openEditor(null); });
    $('#btnTalk').addEventListener('click', openTalk);
    $('#tabTalk').addEventListener('click', openTalk);
    $('#talkClose').addEventListener('click', closeTalk);
    $('#talkParse').addEventListener('click', runParse);
    $('#talkSaveAll').addEventListener('click', saveTalkAll);

    $('#btnCancel').addEventListener('click', closeEditor);
    $('#scrim').addEventListener('click', closeEditor);
    $('#btnSave').addEventListener('click', saveRecord);
    $('#btnDelete').addEventListener('click', deleteRecord);

    Array.prototype.forEach.call($('#typeSeg').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        if (!editor) return;
        editor.type = b.getAttribute('data-type');
        editor.category = CATS[editor.type][0].id;
        Array.prototype.forEach.call($('#typeSeg').querySelectorAll('button'), function (x) {
          x.classList.toggle('active', x === b);
        });
        paintCats();
      });
    });

    $('#keypad').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (b) pressKey(b.getAttribute('data-k'));
    });

    $('#btnExportCsv').addEventListener('click', exportCsv);
    $('#btnExportJson').addEventListener('click', exportJson);
    $('#btnImport').addEventListener('click', function () { $('#filePicker').click(); });
    $('#filePicker').addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (f) importJson(f);
      ev.target.value = '';
    });
    $('#btnClear').addEventListener('click', clearAll);

    $('#themeSelect').addEventListener('change', function () { applyTheme(this.value); });
    $('#btnTheme').addEventListener('click', toggleTheme);
    $('#btnRepo').addEventListener('click', function () {
      if (window.Native && window.Native.openUrl) window.Native.openUrl(REPO_URL);
      else window.open(REPO_URL, '_blank');
    });

    document.addEventListener('keydown', function (ev) {
      if (!editor) return;
      if (ev.key === 'Escape') closeEditor();
      if (/^[0-9]$/.test(ev.key)) pressKey(ev.key);
      if (ev.key === '.') pressKey('.');
      if (ev.key === 'Backspace') pressKey('del');
      if (ev.key === 'Enter') saveRecord();
    });

    window.pocketBack = function () {
      if ($('#talk').classList.contains('on')) { closeTalk(); return 'handled'; }
      if (editor) { closeEditor(); return 'handled'; }
      if (!$('#view-home').classList.contains('active')) { switchView('home'); return 'handled'; }
      return 'exit';
    };
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    load();
    bind();
    renderTalkSamples();

    var savedTheme = 'system';
    try { savedTheme = localStorage.getItem(THEME_KEY) || 'system'; } catch (e) {}
    applyTheme(savedTheme);

    if (window.Native && window.Native.version) {
      $('#appVersion').textContent = window.Native.version;
    }
    $('#repoUrl').textContent = REPO_URL.replace(/^https?:\/\//, '');

    renderAll();

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
