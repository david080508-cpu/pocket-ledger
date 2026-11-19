/* 一句话记账 —— 中文自然语言解析（纯 ES5，可在 Windows 脚本宿主里跑单测）
 *
 * 输入：一段口语，例如
 *   "我妈妈给了我50块钱，然后中饭花了25块钱"
 * 输出：{ items: [...], summary: { income, expense, net } }
 *
 * 设计原则：宁可少记，不要记错。解析不确定的片段会被丢弃，
 * 用户可以在预览列表里补记或修改。
 */
(function (global) {
  'use strict';

  var CN_DIGITS = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_UNITS = { '十': 10, '百': 100, '千': 1000, '万': 10000 };
  var CN_CHARS = '零〇一二两三四五六七八九十百千万';

  // 分类关键词：先匹配长的，命中即用
  var EXPENSE_CATS = [
    { id: 'food', words: ['早饭', '早餐', '中饭', '午饭', '午餐', '晚饭', '晚餐', '夜宵', '外卖', '奶茶', '咖啡', '火锅', '烧烤', '食堂', '吃饭', '吃', '饭', '面', '粉', '饺子', '水果', '苹果', '香蕉', '橘子', '西瓜', '葡萄', '零食', '饮料'] },
    { id: 'transport', words: ['打车', '滴滴', '出租车', '地铁', '公交', '高铁', '火车', '飞机', '机票', '车票', '加油', '油费', '停车', '过路费', '共享单车', '骑车', '交通'] },
    { id: 'shopping', words: ['淘宝', '京东', '拼多多', '超市', '商场', '买菜', '衣服', '裤子', '鞋', '包包', '化妆品', '日用品', '购物', '买'] },
    { id: 'home', words: ['房租', '租金', '水费', '电费', '燃气', '物业', '宽带', '家具', '维修'] },
    { id: 'fun', words: ['电影', '游戏', 'KTV', '唱歌', '旅游', '门票', '健身', '会员', '订阅', '娱乐', '玩'] },
    { id: 'health', words: ['医院', '看病', '挂号', '药', '体检', '牙', '医疗'] },
    { id: 'study', words: ['学费', '课程', '培训', '书', '教材', '考试', '学习'] },
    { id: 'telecom', words: ['话费', '流量', '充值', '手机费', '通讯'] },
    { id: 'social', words: ['红包', '随礼', '份子钱', '礼物', '请客', '人情'] },
    { id: 'other', words: ['快递', '打赏', '罚款', '捐款'] }
  ];

  var INCOME_CATS = [
    { id: 'salary', words: ['工资', '薪水', '发薪', '月薪'] },
    { id: 'bonus', words: ['奖金', '年终奖', '提成', '绩效'] },
    { id: 'invest', words: ['利息', '理财', '收益', '分红', '股票', '基金', '余额宝'] },
    { id: 'redpacket', words: ['红包', '压岁钱', '礼金', '份子钱'] },
    { id: 'parttime', words: ['兼职', '稿费', '外快', '私活'] },
    { id: 'other', words: ['退款', '报销', '退钱', '返现', '中奖'] }
  ];

  var INCOME_CUES = ['收到', '收了', '收', '给我', '给了我', '发工资', '发了', '进账', '到账', '赚了', '赚', '收入', '退给我', '退还', '返还', '补贴', '中奖', '拿到'];
  var EXPENSE_CUES = ['花了', '花', '付了', '付', '支付', '买了', '买', '消费', '交了', '交', '充了', '充值', '扣了', '请客', '订了', '转了', '还了', '用了'];

  var QUANTIFIERS = '个只次斤瓶份杯袋条件张台本双根支块?';
  var MONEY_UNITS = ['块钱', '元钱', '块', '元', '圆', '人民币', 'rmb', 'RMB', '¥', '￥'];

  function findCat(table, text) {
    var best = null, bestLen = 0;
    for (var i = 0; i < table.length; i++) {
      var words = table[i].words;
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if (text.indexOf(w) !== -1 && w.length > bestLen) {
          best = table[i].id;
          bestLen = w.length;
        }
      }
    }
    return best;
  }

  function countCues(cues, text) {
    var n = 0, hit = '';
    for (var i = 0; i < cues.length; i++) {
      var idx = text.indexOf(cues[i]);
      if (idx !== -1) { n++; hit = cues[i]; }
    }
    return { n: n, hit: hit };
  }

  /** 中文数字 -> 数字；失败返回 null */
  function parseCnNumber(str) {
    if (!str) return null;
    if (/^[0-9]+(\.[0-9]+)?$/.test(str)) return parseFloat(str);
    var total = 0, section = 0, number = 0, sawZero = false, sawAny = false;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '零' || ch === '〇') { sawZero = true; sawAny = true; continue; }
      if (CN_DIGITS.hasOwnProperty(ch)) { number = CN_DIGITS[ch]; sawAny = true; continue; }
      if (CN_UNITS.hasOwnProperty(ch)) {
        var unit = CN_UNITS[ch];
        sawAny = true;
        if (unit === 10000) {
          section = (section + number) * unit;
          total += section;
          section = 0;
        } else {
          if (number === 0 && unit === 10) number = 1;      // 十五 = 15
          section += number * unit;
        }
        number = 0;
      } else {
        return null;
      }
    }
    if (!sawAny) return null;
    if (number > 0) {
      // 一百二 = 120（口语省略“十”）
      if (!sawZero && section >= 100 && number < 10) section += number * 10;
      else section += number;
    }
    return total + section;
  }

  /** 解析日期词，返回 YYYY-MM-DD 或 null */
  function parseDate(text, now) {
    var d = new Date(now.getTime());
    var m;
    if ((m = text.match(/大前天/))) { d.setDate(d.getDate() - 3); return fmt(d); }
    if ((m = text.match(/前天/))) { d.setDate(d.getDate() - 2); return fmt(d); }
    if ((m = text.match(/昨天|昨晚|昨儿/))) { d.setDate(d.getDate() - 1); return fmt(d); }
    if ((m = text.match(/今天|今晚|今儿/))) { return fmt(d); }

    if ((m = text.match(/(上)?(?:周|星期|礼拜)([一二三四五六日天])/))) {
      var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
      var target = map[m[2]];
      var cur = d.getDay() === 0 ? 7 : d.getDay();
      var delta = cur - target;
      if (m[1]) delta += 7;                                  // 上周X
      if (delta <= 0) delta += 7;
      d.setDate(d.getDate() - delta);
      return fmt(d);
    }
    if ((m = text.match(/(?:上个月|上月)(\d{1,2})[号日]/))) {
      var pm = new Date(d.getFullYear(), d.getMonth() - 1, parseInt(m[1], 10));
      return fmt(pm);
    }
    if ((m = text.match(/(\d{1,2})月(\d{1,2})[号日]/))) {
      var mm = parseInt(m[1], 10), dd = parseInt(m[2], 10);
      var cand = new Date(d.getFullYear(), mm - 1, dd);
      if (cand.getTime() > d.getTime()) cand.setFullYear(d.getFullYear() - 1);
      return fmt(cand);
    }
    if ((m = text.match(/(\d{1,2})[号日]/))) {
      var day = parseInt(m[1], 10);
      if (day >= 1 && day <= 31) {
        var c2 = new Date(d.getFullYear(), d.getMonth(), day);
        if (c2.getTime() > d.getTime()) c2.setMonth(c2.getMonth() - 1);
        return fmt(c2);
      }
    }
    return null;
  }

  function fmt(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  var DATE_RE = /(大前天|前天|昨天|昨晚|昨儿|今天|今晚|今儿|(?:上)?(?:周|星期|礼拜)[一二三四五六日天]|(?:上个月|上月)\d{1,2}[号日]|\d{1,2}月\d{1,2}[号日]|\d{1,2}[号日])/g;

  /** 找出片段里的金额（分） */
  function findAmount(text) {
    var m, best = null;

    // 1) 带货币单位：50块 / 25.5元 / ¥30
    var unitRe = /((?:[0-9]+(?:\.[0-9]{1,2})?)|[零〇一二两三四五六七八九十百千万]+)\s*(块钱|元钱|块|元|圆|人民币|RMB|rmb|¥|￥)/g;
    while ((m = unitRe.exec(text)) !== null) {
      var val = parseCnNumber(m[1]);
      if (val !== null && val > 0) return { value: val, raw: m[0], index: m.index };
    }

    // 2) 无单位：优先取“花/付/给/收”后面的数字，排除“2个”“3次”这类量词
    var bareRe = /((?:[0-9]+(?:\.[0-9]{1,2})?)|[零〇一二两三四五六七八九十百千万]+)(?!\s*[个只次斤瓶份杯袋条件张台本双根支])/g;
    var bare = [];
    while ((m = bareRe.exec(text)) !== null) {
      var v2 = parseCnNumber(m[1]);
      if (v2 === null || v2 <= 0) continue;
      var before = text.slice(Math.max(0, m.index - 4), m.index);
      var after = text.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (/[个只次斤瓶份杯袋条件张台本双根支]/.test(after)) continue;
      var candidate = { value: v2, raw: m[0], index: m.index };
      bare.push(candidate);
      if (best === null && /[花了付给收扣缴纳退]/.test(before)) best = candidate;
    }
    if (best) return best;
    // 片段里只有一个独立数字（如“中饭25”）时直接采用
    if (bare.length === 1) return bare[0];
    return null;
  }

  function cleanNote(text, raw) {
    var s = text;
    if (raw) s = s.replace(raw, ' ');
    s = s.replace(DATE_RE, ' ');
    s = s.replace(/[我把她他它了啊呢吧呀的得了着过还就都又再很太真然后接着另外同时]/g, ' ');
    s = s.replace(/[，,。；;、！!？?\s]+/g, ' ');
    s = s.replace(/^(花了|花|付了|付|支付|买了|买|消费|交了|交|充了|充值|扣了|收到|收了|给我|发了|赚了|请客)/, '');
    s = s.trim();
    return s.slice(0, 16);
  }

  function parseClause(clause, now, fallbackDate, pendingCat) {
    var text = clause;
    var explicitDate = parseDate(text, now);
    var date = explicitDate || fallbackDate || fmt(now);

    // 先把日期词从文本里摘掉，避免“11月18日”里的数字被当成金额
    var stripped = text.replace(DATE_RE, ' ');

    var amount = findAmount(stripped);
    if (!amount) return null;

    var inc = countCues(INCOME_CUES, stripped);
    var exp = countCues(EXPENSE_CUES, stripped);

    var type;
    if (inc.n > exp.n) type = 'income';
    else if (exp.n > inc.n) type = 'expense';
    else if (inc.n > 0 && exp.n === 0) type = 'income';
    else if (exp.n > 0) type = 'expense';
    else {
      // 没有方向词：看分类关键词
      var catGuess = findCat(EXPENSE_CATS, stripped);
      var incGuess = findCat(INCOME_CATS, stripped);
      if (incGuess && !catGuess) type = 'income';
      else type = 'expense';
    }

    // “给了我”“收到”比“买”更明确；但“我给我妈”是支出
    if (/(给了我|收到|收了|退给我|发工资|到账|返现)/.test(stripped)) type = 'income';
    if (/(我给我|我给他|我给她|给妈|给爸|给朋友)/.test(stripped)) type = 'expense';
    if (/(花了|付了|支付|买|消费|交了|充值)/.test(stripped) && !/(给我|收到|退了|报销)/.test(stripped)) type = 'expense';

    var table = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
    var cat = findCat(table, stripped);
    if (!cat) cat = validCat(type, pendingCat) ? pendingCat : 'other';

    var item = {
      type: type,
      amountCents: Math.round(amount.value * 100),
      category: cat,
      note: cleanNote(stripped, amount.raw),
      date: date,
      explicitDate: !!explicitDate,
      source: clause.trim()
    };
    return item;
  }

  function validCat(type, id) {
    if (!id) return false;
    var table = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
    for (var i = 0; i < table.length; i++) if (table[i].id === id) return true;
    return false;
  }

  function splitClauses(text) {
    var norm = text
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．]/g, '.')
      .replace(/[，、]/g, ',')
      .replace(/[。；;！!？?\n]/g, ',')
      .replace(/(然后|接着|还有|另外|以及|同时|并且|再算上|加上|减去|之后)/g, ',');
    var parts = [];
    norm.split(',').forEach(function (p) {
      p = p.trim();
      if (p) parts.push(p);
    });
    return parts;
  }

  function parse(text, now) {
    var ref = now ? new Date(now.getTime()) : new Date();
    var input = String(text || '').trim();
    if (!input) return { items: [], summary: { income: 0, expense: 0, net: 0 } };

    var items = [];
    var carryDate = null;
    var pendingCat = null;
    splitClauses(input).forEach(function (clause) {
      var item = parseClause(clause, ref, carryDate, pendingCat);
      if (!item) {
        // 没金额的分句（如“买了2个苹果”）把分类线索留给下一句
        pendingCat = findCat(EXPENSE_CATS, clause) || findCat(INCOME_CATS, clause) || pendingCat;
        return;
      }
      pendingCat = null;
      if (item.explicitDate) carryDate = item.date;
      items.push(item);
    });

    var income = 0, expense = 0;
    items.forEach(function (it) {
      if (it.type === 'income') income += it.amountCents;
      else expense += it.amountCents;
    });

    return { items: items, summary: { income: income, expense: expense, net: income - expense } };
  }

  global.PocketNlp = { parse: parse, _internal: { parseCnNumber: parseCnNumber, splitClauses: splitClauses } };
})(typeof window !== 'undefined' ? window : this);
