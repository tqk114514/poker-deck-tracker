'use strict';
/**
 * poker-deck-tracker 性能测试工具 —— 被动加载，不主动引用。
 *
 * 加载方式（控制台粘贴）：
 *   var s=document.createElement('script');s.src='benchmark.js';document.body.appendChild(s)
 *
 * 加载后自动跑同步测试。之后可交互：
 *   Bench.run()     同步测试（标定/算术/IO/DOM/FLIP计算）
 *   Bench.runAll()  全套（含动画帧率，约 2 秒）
 *   Bench.fps()     仅动画帧率
 *   Bench.results   上次结果
 *
 * 安全保证：run/runAll/fps 全程 snapshot + try/finally，
 * 无论测试中发生什么，结束都会恢复 localStorage、内存状态、过滤器并刷新 UI。
 */
(function () {
  const results = [];

  // ====== 状态快照 / 恢复（防止污染）======
  function snapshot() {
    return {
      heldCards: localStorage.getItem('pokerDeck.heldCards'),
      boxOwned: localStorage.getItem('pokerDeck.boxOwned'),
      cardStates: new Set(cardStates),
      boxOwnedVal: boxOwned,
      status: statusFilter,
      suit: suitFilter
    };
  }

  function restore(snap) {
    // 清理测试临时键
    localStorage.removeItem('bench.tmp');
    // 恢复 localStorage 到快照值
    if (snap.heldCards === null) localStorage.removeItem('pokerDeck.heldCards');
    else localStorage.setItem('pokerDeck.heldCards', snap.heldCards);
    if (snap.boxOwned === null) localStorage.removeItem('pokerDeck.boxOwned');
    else localStorage.setItem('pokerDeck.boxOwned', snap.boxOwned);
    // 恢复内存状态
    cardStates = snap.cardStates;
    boxOwned = snap.boxOwnedVal;
    statusFilter = snap.status;
    suitFilter = snap.suit;
    // 刷新 UI
    renderGrid();
    updateStats();
    updateBoxDom();
  }

  // performance.now() 在非安全上下文精度被钳到 ~100μs。
  // 自适应探测：从 1 次起 ×10 放大，直到总耗时 > 20ms（远超精度阈值），再反推单次耗时。
  function probe(fn) {
    let loops = 1;
    let total = 0;
    while (loops <= 100000000) {
      const t0 = performance.now();
      try { for (let j = 0; j < loops; j++) fn(); } catch (e) {}
      total = performance.now() - t0;
      if (total > 20) break;
      loops *= 10;
    }
    return { perOp: total / loops, loops };
  }

  function measure(name, fn, iterations = 30) {
    const { perOp, loops: probeLoops } = probe(fn);
    // 每次迭代跑 innerLoops 次，让总耗时 ~20ms 越过精度阈值
    let innerLoops = Math.max(1, Math.ceil(20 / Math.max(perOp, 0.0001)));
    innerLoops = Math.min(innerLoops, 100000000);
    // 预热
    for (let i = 0; i < 2; i++) {
      try { for (let j = 0; j < innerLoops; j++) fn(); } catch (e) {}
    }
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      for (let j = 0; j < innerLoops; j++) fn();
      times.push((performance.now() - t0) / innerLoops);
    }
    times.sort((a, b) => a - b);
    const mid = Math.floor(times.length / 2);
    results.push({
      name,
      median: times[mid],
      avg: times.reduce((s, t) => s + t, 0) / times.length,
      min: times[0],
      p95: times[Math.floor(times.length * 0.95)],
      max: times[times.length - 1],
      iterations,
      innerLoops
    });
    return times[mid];
  }

  // ====== 1. 标定 ======
  function benchCalibrate() {
    measure('calibrateGrid 完整标定', calibrateGrid);
    measure('getComputedStyle+getBoundingClientRect', () => {
      const cs = getComputedStyle(grid);
      const r = grid.getBoundingClientRect();
      void cs.columnGap; void r.width; void r.height;
    });
    measure('offsetTop 数列数', () => {
      const cs = grid.children;
      const top0 = cs[0].offsetTop;
      let cols = 1;
      for (let i = 1; i < cs.length; i++) {
        if (cs[i].offsetTop !== top0) break;
        cols++;
      }
      void cols;
    });
  }

  // ====== 2. 算术位移计算 ======
  function benchArithmetic() {
    const m = gridMetrics;
    if (!m) { console.warn('gridMetrics 为空，跳过算术测试'); return; }
    const stepX = m.cardW + m.gap;
    const stepY = m.cardH + m.gap;
    const cols = m.cols;
    const n = grid.children.length;

    measure('单次取模+乘法 (1张)', () => {
      const dx = (5 % cols - 4 % cols) * stepX;
      const dy = (Math.floor(5 / cols) - Math.floor(4 / cols)) * stepY;
      void dx; void dy;
    });

    measure(`全量位移计算 (${n}张)`, () => {
      for (let i = 0; i < n; i++) {
        const oldIdx = i;
        const newIdx = Math.max(0, i - 1);
        const dx = ((oldIdx % cols) - (newIdx % cols)) * stepX;
        const dy = (Math.floor(oldIdx / cols) - Math.floor(newIdx / cols)) * stepY;
        void dx; void dy;
      }
    });
  }

  // ====== 3. IO ======
  // 注意：saveStates 会写真实键 pokerDeck.heldCards，值与当前 cardStates 一致（测试不改 cardStates），
  // 数据不丢失，但 updateLastSaved 时间戳会被刷新。靠外层 snapshot/restore 兜底恢复。
  function benchIO() {
    measure('saveStates (写 localStorage + 更新时间戳)', saveStates);
    measure('loadStates (读 + JSON.parse + new Set)', loadStates);

    const arr = Array.from(cardStates);
    const json = JSON.stringify(arr);
    measure('JSON.stringify(Array.from(Set))', () => {
      JSON.stringify(Array.from(cardStates));
    });
    measure('JSON.parse + new Set', () => {
      new Set(JSON.parse(json));
    });
    measure('localStorage.setItem', () => {
      localStorage.setItem('bench.tmp', json);
    });
    measure('localStorage.getItem', () => {
      localStorage.getItem('bench.tmp');
    });
  }

  // ====== 4. DOM ======
  function benchDOM() {
    measure('renderGrid (innerHTML 赋值，无强制布局)', renderGrid);
    measure('renderGrid + 强制布局', () => {
      renderGrid();
      void grid.offsetHeight;
    });
    measure('updateStats (遍历54张 + DOM写)', updateStats);
    measure('grid.querySelectorAll(".card")', () => {
      grid.querySelectorAll('.card');
    });
    measure('grid.children 遍历 + offsetTop', () => {
      const cs = grid.children;
      for (let i = 0; i < cs.length; i++) void cs[i].offsetTop;
    });
    measure('deckById.get (Map 查找)', () => {
      deckById.get('S-A');
    });
    measure('DECK.find (数组遍历查找)', () => {
      DECK.find(c => c.id === 'S-A');
    });
  }

  // ====== 5. FLIP 重排计算（cleanLeaving 算术部分）======
  function benchFlipMath() {
    const m = gridMetrics;
    if (!m) return;
    const stepX = m.cardW + m.gap;
    const stepY = m.cardH + m.gap;
    const cols = m.cols;
    const n = grid.children.length;
    const leavingIdx = Math.floor(n / 2);

    measure('cleanLeaving 算术 (移除1张, 全量)', () => {
      const stablePre = [];
      for (let i = 0; i < n; i++) {
        if (i === leavingIdx) continue;
        stablePre.push(i);
      }
      for (let i = 0; i < stablePre.length; i++) {
        const oldIdx = stablePre[i];
        const dx = ((oldIdx % cols) - (i % cols)) * stepX;
        const dy = (Math.floor(oldIdx / cols) - Math.floor(i / cols)) * stepY;
        void dx; void dy;
      }
    });
  }

  // ====== 6. 动画帧率（实际触发重排）======
  // toggleCard 会临时改 cardStates + saveStates，靠外层 snapshot/restore 恢复
  async function benchAnimationFPS() {
    console.log('%c⏱ 测量动画帧率中（约 1.5 秒）...', 'color:#d4af37');

    statusFilter = 'missing';
    suitFilter = 'all';
    renderGrid();
    calibrateGrid();
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    const cards = Array.from(grid.children);
    if (cards.length < 2) {
      console.warn('无足够卡片测试帧率');
      return;
    }

    const target = cards[0];
    const id = target.dataset.id;

    const frames = [];
    let startT = null;
    const DURATION = 1300;

    return new Promise(resolve => {
      function sample(ts) {
        if (startT === null) startT = ts;
        frames.push(ts);
        if (ts - startT < DURATION) {
          requestAnimationFrame(sample);
        } else {
          const intervals = [];
          for (let i = 1; i < frames.length; i++) {
            intervals.push(frames[i] - frames[i - 1]);
          }
          intervals.sort((a, b) => a - b);
          const median = intervals[Math.floor(intervals.length / 2)];
          const fps = 1000 / median;
          const dropped = intervals.filter(v => v > 20).length;
          results.push({
            name: 'FLIP 重排动画帧率',
            isFPS: true,
            median,
            fps: fps.toFixed(1),
            frames: frames.length,
            dropped,
            minInt: intervals[0].toFixed(1),
            maxInt: intervals[intervals.length - 1].toFixed(1)
          });
          resolve();
        }
      }
      toggleCard(id);
      requestAnimationFrame(sample);
    });
  }

  // ====== 输出 ======
  function fmtUs(ms) {
    const us = ms * 1000;
    if (us < 0.01) return us.toFixed(4);
    if (us < 1) return us.toFixed(3);
    if (us < 100) return us.toFixed(2);
    return us.toFixed(0);
  }

  function fmtLoops(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return String(n);
  }

  function printTable() {
    const sync = results.filter(r => !r.isFPS);
    const fps = results.filter(r => r.isFPS);
    if (sync.length) {
      console.groupCollapsed('%c⚡ 同步测试结果', 'color:#d4af37;font-weight:bold');
      console.table(sync.map(r => ({
        测试: r.name,
        '中位(μs)': fmtUs(r.median),
        '平均(μs)': fmtUs(r.avg),
        '最小(μs)': fmtUs(r.min),
        'P95(μs)': fmtUs(r.p95),
        '最大(μs)': fmtUs(r.max),
        '放大': fmtLoops(r.innerLoops),
        '采样': r.iterations
      })));
      console.groupEnd();
    }
    if (fps.length) {
      console.groupCollapsed('%c⚡ 动画帧率结果', 'color:#d4af37;font-weight:bold');
      console.table(fps.map(r => ({
        测试: r.name,
        '中位帧间隔(ms)': r.median.toFixed(2),
        FPS: r.fps,
        '采样帧数': r.frames,
        '掉帧(>20ms)': r.dropped,
        '最小间隔(ms)': r.minInt,
        '最大间隔(ms)': r.maxInt
      })));
      console.groupEnd();
    }
  }

  function run() {
    results.length = 0;
    const snap = snapshot();
    console.group('%c⚡ poker-deck-tracker Benchmark', 'color:#d4af37;font-weight:bold;font-size:14px');
    console.time('同步测试总计');
    try {
      benchCalibrate();
      benchArithmetic();
      benchIO();
      benchDOM();
      benchFlipMath();
    } finally {
      restore(snap);
    }
    console.timeEnd('同步测试总计');
    printTable();
    console.groupEnd();
    return results;
  }

  async function runAll() {
    results.length = 0;
    const snap = snapshot();
    console.group('%c⚡ poker-deck-tracker Benchmark (Full)', 'color:#d4af37;font-weight:bold;font-size:14px');
    console.time('全套总计');
    try {
      benchCalibrate();
      benchArithmetic();
      benchIO();
      benchDOM();
      benchFlipMath();
      await benchAnimationFPS();
    } finally {
      restore(snap);
    }
    console.timeEnd('全套总计');
    printTable();
    console.groupEnd();
    return results;
  }

  async function fps() {
    results.length = 0;
    const snap = snapshot();
    console.group('%c⚡ poker-deck-tracker Benchmark (FPS)', 'color:#d4af37;font-weight:bold;font-size:14px');
    try {
      await benchAnimationFPS();
    } finally {
      restore(snap);
    }
    printTable();
    console.groupEnd();
    return results;
  }

  window.Bench = {
    run,
    runAll,
    fps,
    measure,
    get results() { return results; }
  };

  console.log(
    '%c⚡ Benchmark 已加载\n' +
    '  Bench.run()     同步测试\n' +
    '  Bench.runAll()  全套（含动画帧率）\n' +
    '  Bench.fps()     仅动画帧率',
    'color:#d4af37;font-weight:bold'
  );

  run();
})();
