// 一句话记账解析器单测（Windows 脚本宿主 JScript，无需 Node）
// 运行: cscript //nologo tools\nlp-test.js
var fso = new ActiveXObject('Scripting.FileSystemObject');
var here = fso.GetParentFolderName(WScript.ScriptFullName);
var nlpPath = fso.BuildPath(here, '..\\app\\src\\main\\assets\\app\\nlp.js');
var src = fso.OpenTextFile(nlpPath, 1).ReadAll();
eval(src);

var Nlp = this.PocketNlp;
if (!Nlp) {
  WScript.Echo('FAIL: PocketNlp 未导出');
  WScript.Quit(1);
}

function d(y, m, day) { return new Date(y, m - 1, day, 12, 0, 0); }
var NOW = d(2026, 11, 19);

var cases = [
  {
    name: '用户原句：妈妈给钱 + 中饭',
    text: '我妈妈给了我50块钱，然后中饭花了25块钱',
    want: [
      { type: 'income', cents: 5000, cat: 'other', date: '2026-11-19' },
      { type: 'expense', cents: 2500, cat: 'food', date: '2026-11-19' }
    ]
  },
  {
    name: '昨天两笔支出',
    text: '昨天打车35，午饭吃面18',
    want: [
      { type: 'expense', cents: 3500, cat: 'transport', date: '2026-11-18' },
      { type: 'expense', cents: 1800, cat: 'food', date: '2026-11-18' }
    ]
  },
  {
    name: '工资 + 房租',
    text: '发工资8000，交房租2500',
    want: [
      { type: 'income', cents: 800000, cat: 'salary', date: '2026-11-19' },
      { type: 'expense', cents: 250000, cat: 'home', date: '2026-11-19' }
    ]
  },
  {
    name: '购物 + 红包收入',
    text: '买了双鞋399，红包收了200',
    want: [
      { type: 'expense', cents: 39900, cat: 'shopping', date: '2026-11-19' },
      { type: 'income', cents: 20000, cat: 'redpacket', date: '2026-11-19' }
    ]
  },
  {
    name: '中文数字金额',
    text: '水电费一百二十块',
    want: [{ type: 'expense', cents: 12000, cat: 'home', date: '2026-11-19' }]
  },
  {
    name: '只给金额没有方向词',
    text: '花了15块',
    want: [{ type: 'expense', cents: 1500, cat: 'other', date: '2026-11-19' }]
  },
  {
    name: '指定日期',
    text: '11月3日看电影花了60',
    want: [{ type: 'expense', cents: 6000, cat: 'fun', date: '2026-11-03' }]
  },
  {
    name: '无金额不记账',
    text: '今天天气不错',
    want: []
  },
  {
    name: '口语省略动词',
    text: '中饭25',
    want: [{ type: 'expense', cents: 2500, cat: 'food', date: '2026-11-19' }]
  },
  {
    name: '给妈妈钱算支出',
    text: '我给我妈200',
    want: [{ type: 'expense', cents: 20000, cat: 'other', date: '2026-11-19' }]
  },
  {
    name: '量词不是金额',
    text: '买了2个苹果，花了15块',
    want: [{ type: 'expense', cents: 1500, cat: 'food', date: '2026-11-19' }]
  }
];

var pass = 0, fail = 0;
for (var i = 0; i < cases.length; i++) {
  var c = cases[i];
  var got = Nlp.parse(c.text, NOW).items;
  var ok = got.length === c.want.length;
  if (ok) {
    for (var j = 0; j < got.length; j++) {
      var g = got[j], w = c.want[j];
      if (g.type !== w.type || g.amountCents !== w.cents || g.category !== w.cat || g.date !== w.date) ok = false;
    }
  }
  if (ok) {
    pass++;
    WScript.Echo('PASS  ' + c.name);
  } else {
    fail++;
    WScript.Echo('FAIL  ' + c.name + '  -> ' + c.text);
    for (var k = 0; k < got.length; k++) {
      WScript.Echo('        got: ' + got[k].type + ' ' + got[k].amountCents + ' ' + got[k].category + ' ' + got[k].date + ' | ' + got[k].note);
    }
    if (!got.length) WScript.Echo('        got: (空)');
    WScript.Echo('        want: ' + c.want.length + ' 条');
  }
}

var sum = Nlp.parse('我妈妈给了我50块钱，然后中饭花了25块钱', NOW).summary;
WScript.Echo('summary: 收入=' + sum.income + ' 支出=' + sum.expense + ' 净=' + sum.net);
WScript.Echo('---- ' + pass + ' passed, ' + fail + ' failed');
WScript.Quit(fail ? 1 : 0);
