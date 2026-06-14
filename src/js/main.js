import { REGIONS, quizData } from './quizData.js';
import { sounds } from './sound.js';

// ゲームの状態管理
const state = {
  isMuted: false,
  completedPrefectures: new Set(), // スナップ完了した都道府県コードのリスト (Number)
  clearedRegions: new Set(),        // クイズもクリアした地方キーのリスト (String)
  currentRegionQuiz: null,          // 現在出題中の地方キー (String)
  quizIndices: {},                  // 地方ごとの現在のクイズ出題インデックス
  activeQuizAnswer: null,           // 現在のクイズの正解インデックス
};

// 地方ごとのクイズインデックスを初期化
Object.keys(quizData).forEach(regionKey => {
  state.quizIndices[regionKey] = 0;
});

// アプリケーション起動
window.addEventListener('DOMContentLoaded', () => {
  initGame();
});

// 初期化処理
async function initGame() {
  await loadMap();
  setupUI();
  // レイアウトエンジンの描画完了を待ってから初期配置を実行
  requestAnimationFrame(() => {
    resetGame();
  });
}

// 都道府県の正式名称を取得する
function getPrefFullName(shortName) {
  if (shortName === '北海道') return '北海道';
  if (shortName === '東京') return '東京都';
  if (shortName === '京都' || shortName === '大阪') return shortName + '府';
  return shortName + '県';
}

// 鹿児島、東京、沖縄、長崎などの「島」を多く持つ巨大なBBoxを、衝突判定用に「本体」だけのサイズに補正する
function getAdjustedBBox(code, originalBBox) {
  if (code === 46) { // 鹿児島県
    return { x: 25, y: 830, width: 75, height: 165 }; // 薩摩・大隅半島部分に限定
  }
  if (code === 13) { // 東京都
    return { x: 0, y: 0, width: 50, height: 25 }; // 小笠原諸島などを除外
  }
  if (code === 47) { // 沖縄県
    return { x: 270, y: 0, width: 45, height: 45 }; // 沖縄本島部分に限定
  }
  if (code === 42) { // 長崎県
    return { x: 50, y: 70, width: 50, height: 70 }; // 五島列島などを除外
  }
  return originalBBox;
}

// SVG白地図のロードと初期構築
async function loadMap() {
  try {
    const res = await fetch('./map-full.svg');
    const svgText = await res.text();
    const container = document.getElementById('map-container');
    container.innerHTML = svgText;

    const svg = container.querySelector('svg');
    svg.classList.add('map-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    // レイヤーの分離と整理
    const prefecturesGroup = svg.querySelector('.prefectures');
    if (!prefecturesGroup) return;

    // 白地図用グループとピース用グループを定義
    const basemapGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    basemapGroup.setAttribute('class', 'basemap');
    
    const piecesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    piecesGroup.setAttribute('class', 'pieces');

    // 都道府県の要素をコピーしてそれぞれのグループに分ける
    const prefectures = Array.from(prefecturesGroup.querySelectorAll('.prefecture'));
    
    prefectures.forEach(pref => {
      const code = parseInt(pref.getAttribute('data-code'), 10);
      const originalTransform = pref.getAttribute('transform') || '';
      
      // 白地図用（背景レイヤー）
      const basePref = pref.cloneNode(true);
      basePref.setAttribute('class', `basemap-prefecture pref-${code}`);
      basePref.removeAttribute('transform');
      basePref.setAttribute('transform', originalTransform);
      
      basePref.removeAttribute('stroke-linejoin');
      basePref.removeAttribute('fill');
      basePref.removeAttribute('stroke');
      basePref.removeAttribute('stroke-width');
      basemapGroup.appendChild(basePref);

      // ピース用（前面レイヤー）
      pref.setAttribute('class', `piece pref-${code}`);
      
      // 元の transform の translate 座標を解析して保存
      const translateMatch = originalTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      let origX = 0;
      let origY = 0;
      if (translateMatch) {
        origX = parseFloat(translateMatch[1]);
        origY = parseFloat(translateMatch[2]);
      }
      pref.dataset.origX = origX;
      pref.dataset.origY = origY;
      pref.dataset.code = code;
      
      // 日本語の都道府県名を取得してdatasetに保存
      const prefTitle = pref.querySelector('title').textContent;
      const prefNameShort = prefTitle.split('/')[0].trim();
      pref.dataset.name = getPrefFullName(prefNameShort);
      
      // 地方のクラス名を追加してパステルカラーが当たるようにする
      const regionKey = getRegionKeyByCode(code);
      if (regionKey) {
        pref.classList.add(regionKey);
      }

      piecesGroup.appendChild(pref);
    });

    prefecturesGroup.innerHTML = '';
    prefecturesGroup.appendChild(basemapGroup);
    prefecturesGroup.appendChild(piecesGroup);

    // 強制的にレイアウトリフローを走らせ、getBBox()が正しい値を返すようにする
    container.offsetHeight; 

    // DOMに追加された後に各ピースのBBoxを取得して記録
    const addedPieces = piecesGroup.querySelectorAll('.piece');
    addedPieces.forEach(pref => {
      const code = parseInt(pref.dataset.code, 10);
      let bbox = pref.getBBox();
      
      // ブラウザの描画遅延等でBBoxが0x0になった場合の安全なフォールバック
      if (bbox.width === 0 || bbox.height === 0) {
        bbox = { x: -40, y: -40, width: 80, height: 80 };
      }
      
      const originalBBox = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
      
      // 衝突判定用（島を抜いた本体）とドラッグクランプ用（島を含めた全体）の2つのBBoxを保存
      pref.dataset.bbox = JSON.stringify(getAdjustedBBox(code, originalBBox));
      pref.dataset.originalBBox = JSON.stringify(originalBBox);
      
      const origX = parseFloat(pref.dataset.origX);
      const origY = parseFloat(pref.dataset.origY);
      setupDragAndDrop(pref, origX, origY);
    });

  } catch (error) {
    console.error('地図データの読み込みに失敗しました:', error);
  }
}

// UIイベントのセットアップ
function setupUI() {
  // 最初からボタン
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('最初から やり直しますか？')) {
      resetGame();
    }
  });

  // 並べ直すボタン
  document.getElementById('tidy-btn').addEventListener('click', () => {
    tidyPieces();
  });

  // ミュートボタン
  const muteBtn = document.getElementById('mute-btn');
  muteBtn.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    muteBtn.textContent = state.isMuted ? '音：OFF' : '音：ON';
  });

  // クイズ回答ボタン
  const optionButtons = document.querySelectorAll('#quiz-options .option-btn');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const selectedIndex = parseInt(e.target.dataset.index, 10);
      handleQuizAnswer(selectedIndex);
    });
  });
}

// ゲームのリセット（ピースを散りばめる）
function resetGame() {
  state.completedPrefectures.clear();
  state.clearedRegions.clear();
  state.currentRegionQuiz = null;
  state.activeQuizAnswer = null;

  // 地方ごとのクイズインデックスをランダムまたは0リセット
  Object.keys(quizData).forEach(regionKey => {
    state.quizIndices[regionKey] = Math.floor(Math.random() * quizData[regionKey].length);
  });

  updateProgress();

  // モーダル・ポップアップを閉じる
  document.getElementById('quiz-overlay').classList.remove('show');
  document.getElementById('result-overlay').classList.remove('show');
  document.getElementById('prefecture-popup').classList.remove('show');

  // 白地図の塗りつぶしをクリア
  const basemapPrefectures = document.querySelectorAll('.basemap-prefecture');
  basemapPrefectures.forEach(pref => {
    pref.setAttribute('class', pref.getAttribute('class').split(' ').filter(c => !c.startsWith('filled-')).join(' '));
  });

  // 重なり・はみ出しを防ぎながらピースを配置
  arrangePiecesNoOverlap(false);
}

// 未完成のピースを並べ直す
function tidyPieces() {
  arrangePiecesNoOverlap(true);
  if (!state.isMuted) {
    sounds.playSnap();
  }
}

// AABB(バウンディングボックス)の交差判定
function isRectOverlapping(r1, r2, margin = 8) {
  return !(r1.right + margin <= r2.left || 
           r1.left - margin >= r2.right || 
           r1.bottom + margin <= r2.top || 
           r1.top - margin >= r2.bottom);
}

// 重なりとはみ出しを防止したピース自動配置アルゴリズム
function arrangePiecesNoOverlap(animate = false) {
  const pieces = Array.from(document.querySelectorAll('.pieces .piece')).filter(p => !p.classList.contains('snapped'));
  if (pieces.length === 0) return;

  // 1. ピースをバウンディングボックスの面積（本体のみ）が大きい順にソートする（大物から順に配置）
  pieces.sort((a, b) => {
    const bboxA = JSON.parse(a.dataset.bbox || '{"width":0,"height":0}');
    const bboxB = JSON.parse(b.dataset.bbox || '{"width":0,"height":0}');
    const areaA = bboxA.width * bboxA.height;
    const areaB = bboxB.width * bboxB.height;
    return areaB - areaA;
  });

  // 2. 配置用グリッド候補を生成し、シャッフル
  const gridPositions = generateGridPositions();
  shuffleArray(gridPositions);

  const placedRects = [];

  pieces.forEach((piece) => {
    const origX = parseFloat(piece.dataset.origX);
    const origY = parseFloat(piece.dataset.origY);
    
    // 衝突判定およびクランプ計算は、離島によるはみ出しを防ぐため「主要陸地本体のBBox」(bbox) を基準にする
    const bbox = JSON.parse(piece.dataset.bbox || '{"x":0,"y":0,"width":0,"height":0}');

    // このピースが絶対座標 (0〜1000) から完全にはみ出さないための transform 限界領域を計算
    // ただし、はまる正しい位置 (origX, origY) が常に可動範囲に含まれるように Math.min/Math.max で補正する
    const minTX = Math.min(15 - bbox.x, origX);
    const maxTX = Math.max(985 - (bbox.x + bbox.width), origX);
    const minTY = Math.min(15 - bbox.y, origY);
    const maxTY = Math.max(920 - (bbox.y + bbox.height), origY); // 下側はボタン・プログレス表示があるので920までにクランプ！

    let bestPos = null;
    let found = false;

    // グリッド位置候補を順番に検証
    for (let i = 0; i < gridPositions.length; i++) {
      const pos = gridPositions[i];
      // ゾーンの候補座標をピースのはみ出し範囲にクランプ
      const tx = Math.max(minTX, Math.min(maxTX, pos.x));
      const ty = Math.max(minTY, Math.min(maxTY, pos.y));
      
      const rect = {
        left: tx + bbox.x,
        right: tx + bbox.x + bbox.width,
        top: ty + bbox.y,
        bottom: ty + bbox.y + bbox.height
      };

      // すでに配置されたピースと重ならないか判定（10pxのマージンを設ける）
      const isOverlapping = placedRects.some(r => isRectOverlapping(r, rect, 10));
      
      if (!isOverlapping) {
        bestPos = { tx, ty };
        placedRects.push(rect);
        gridPositions.splice(i, 1); // 使用済みグリッドを除去
        found = true;
        break;
      }
    }

    // 万が一、すべてのグリッドで重なりが発生した場合は、画面内の空き領域にランダム散布して重なりを最小化する
    if (!found) {
      let tx, ty;
      let attempts = 0;
      let isOverlap = true;

      while (attempts < 15 && isOverlap) {
        tx = minTX + Math.random() * (maxTX - minTX);
        ty = minTY + Math.random() * (maxTY - minTY);
        
        const rect = {
          left: tx + bbox.x,
          right: tx + bbox.x + bbox.width,
          top: ty + bbox.y,
          bottom: ty + bbox.y + bbox.height
        };

        isOverlap = placedRects.some(r => isRectOverlapping(r, rect, 5)); // 緩めの5pxでチェック
        attempts++;
      }
      bestPos = { tx, ty };
      placedRects.push({
        left: tx + bbox.x,
        right: tx + bbox.x + bbox.width,
        top: ty + bbox.y,
        bottom: ty + bbox.y + bbox.height
      });
    }

    // 配置アニメーションの設定
    if (animate) {
      piece.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
      setTimeout(() => {
        piece.style.transition = '';
      }, 600);
    } else {
      piece.style.transition = '';
    }

    const dx = bestPos.tx - origX;
    const dy = bestPos.ty - origY;
    
    piece.dataset.dx = dx;
    piece.dataset.dy = dy;
    piece.setAttribute('transform', `translate(${bestPos.tx}, ${bestPos.ty})`);
  });
}

// 配列のシャッフルヘルパー
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// ピースが互いに重ならず、画面外にはみ出ない配置グリッドを生成する（計78セル）
function generateGridPositions() {
  const positions = [];

  // ゾーン1: 左側 (x: 40〜200, y: 60〜880) - 沖縄枠を避ける
  // 縦12行、横3列 = 36セル
  const zone1 = { minX: 40, maxX: 200, minY: 60, maxY: 880 };
  const rows1 = 12;
  const cols1 = 3;
  for (let r = 0; r < rows1; r++) {
    for (let c = 0; c < cols1; c++) {
      const x = zone1.minX + (c * (zone1.maxX - zone1.minX) / (cols1 - 1 || 1));
      const y = zone1.minY + (r * (zone1.maxY - zone1.minY) / (rows1 - 1 || 1));
      
      // 沖縄の仕切り枠 (x: 52〜370, y: 193〜350) と重なる部分を除外
      if (x > 80 && y > 180 && y < 370) {
        continue; 
      }
      positions.push({ x, y });
    }
  }

  // ゾーン2: 下部太平洋 (x: 250〜850, y: 820〜900) - はみ出しを防ぐためYの最大値を900に！
  // 縦2行、横10列 = 20セル
  const zone2 = { minX: 250, maxX: 850, minY: 820, maxY: 900 };
  const rows2 = 2;
  const cols2 = 10;
  for (let r = 0; r < rows2; r++) {
    for (let c = 0; c < cols2; c++) {
      const x = zone2.minX + (c * (zone2.maxX - zone2.minX) / (cols2 - 1 || 1));
      const y = zone2.minY + (r * (zone2.maxY - zone2.minY) / (rows2 - 1 || 1));
      positions.push({ x, y });
    }
  }

  // ゾーン3: 日本海・左上 (x: 50〜500, y: 50〜160)
  // 縦2行、横7列 = 14セル
  const zone3 = { minX: 50, maxX: 500, minY: 50, maxY: 160 };
  const rows3 = 2;
  const cols3 = 7;
  for (let r = 0; r < rows3; r++) {
    for (let c = 0; c < cols3; c++) {
      const x = zone3.minX + (c * (zone3.maxX - zone3.minX) / (cols3 - 1 || 1));
      const y = zone3.minY + (r * (zone3.maxY - zone3.minY) / (rows3 - 1 || 1));
      
      // ゾーン1と近すぎる重複セルを除外
      if (x < 150 && y < 150) continue;
      positions.push({ x, y });
    }
  }

  // ゾーン4: 右側・北海道南東 (x: 840〜960, y: 340〜780)
  // 縦8行、横2列 = 16セル
  const zone4 = { minX: 840, maxX: 960, minY: 340, maxY: 780 };
  const rows4 = 8;
  const cols4 = 2;
  for (let r = 0; r < rows4; r++) {
    for (let c = 0; c < cols4; c++) {
      const x = zone4.minX + (c * (zone4.maxX - zone4.minX) / (cols4 - 1 || 1));
      const y = zone4.minY + (r * (zone4.maxY - zone4.minY) / (rows4 - 1 || 1));
      positions.push({ x, y });
    }
  }

  return positions;
}

// 万が一グリッドセルが足りない場合のフォールバック用配置
function getFallbackScatterPosition(index) {
  const leftSea = { minX: 40, maxX: 160, minY: 60, maxY: 880 };
  const rightBottomSea = { minX: 720, maxX: 950, minY: 720, maxY: 900 };
  const area = index % 2 === 0 ? leftSea : rightBottomSea;
  const x = area.minX + Math.random() * (area.maxX - area.minX);
  const y = area.minY + Math.random() * (area.maxY - area.minY);
  return { x, y };
}

// 都道府県コードから地方キーを取得する
function getRegionKeyByCode(code) {
  for (const [key, region] of Object.entries(REGIONS)) {
    if (region.codes.includes(code)) {
      return key;
    }
  }
  return null;
}

// Pointer Events によるドラッグ＆ドロップ制御
let activePointerId = null;
let dragElement = null;
let startOffset = { x: 0, y: 0 };
let startMouseSVG = { x: 0, y: 0 };

// 画面上のPointerイベントのクライアント座標を、指定したSVG要素（またはグループ）のローカルSVG座標に変換する
function getLocalSVGCoords(e, svg, element) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = element.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return pt.matrixTransform(ctm.inverse());
}

function setupDragAndDrop(piece, origX, origY) {
  // マウス/タッチ開始
  piece.addEventListener('pointerdown', (e) => {
    if (piece.classList.contains('snapped')) return;
    if (activePointerId !== null) return;
    
    activePointerId = e.pointerId;
    dragElement = piece;
    piece.classList.add('dragging');
    
    // ドラッグ中のピースを最前面へ移動
    piece.parentNode.appendChild(piece);

    if (!state.isMuted) {
      sounds.init();
    }
    
    const svg = document.querySelector('svg.map-svg');
    if (svg) {
      const mouseSVG = getLocalSVGCoords(e, svg, piece.parentNode);
      startMouseSVG = { x: mouseSVG.x, y: mouseSVG.y };
    }
    
    startOffset = {
      x: parseFloat(piece.dataset.dx || 0),
      y: parseFloat(piece.dataset.dy || 0)
    };
    
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    
    e.preventDefault();
    e.stopPropagation();
  });
}

function onPointerMove(e) {
  if (!dragElement || e.pointerId !== activePointerId) return;
  
  const svg = document.querySelector('svg.map-svg');
  if (!svg) return;
  
  const mouseSVG = getLocalSVGCoords(e, svg, dragElement.parentNode);
  
  const mouseDx = mouseSVG.x - startMouseSVG.x;
  const mouseDy = mouseSVG.y - startMouseSVG.y;
  
  const dx = startOffset.x + mouseDx;
  const dy = startOffset.y + mouseDy;
  
  const origX = parseFloat(dragElement.dataset.origX);
  const origY = parseFloat(dragElement.dataset.origY);
  
  // ドラッグ時のクランプも、操作性（縦横の可動域）を確保するために「主要陸地本体のBBox」(bbox) を基準にする
  // ただし、はまる正しい位置 (origX, origY) が常に可動範囲に含まれるように Math.min/Math.max で補正する
  const bbox = JSON.parse(dragElement.dataset.bbox || '{"x":0,"y":0,"width":0,"height":0}');
  const minTX = Math.min(10 - bbox.x, origX);
  const maxTX = Math.max(990 - (bbox.x + bbox.width), origX);
  const minTY = Math.min(10 - bbox.y, origY);
  const maxTY = Math.max(990 - (bbox.y + bbox.height), origY);

  let targetX = origX + dx;
  let targetY = origY + dy;

  // 表示領域（0〜1000）からはみ出さないようにクランプ処理
  targetX = Math.max(minTX, Math.min(maxTX, targetX));
  targetY = Math.max(minTY, Math.min(maxTY, targetY));

  const clampedDx = targetX - origX;
  const clampedDy = targetY - origY;

  dragElement.dataset.dx = clampedDx;
  dragElement.dataset.dy = clampedDy;
  
  dragElement.setAttribute('transform', `translate(${targetX}, ${targetY})`);
  
  e.preventDefault();
}

function onPointerUp(e) {
  if (!dragElement || e.pointerId !== activePointerId) return;
  
  const piece = dragElement;
  dragElement = null;
  activePointerId = null;
  piece.classList.remove('dragging');
  
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
  
  const dx = parseFloat(piece.dataset.dx || 0);
  const dy = parseFloat(piece.dataset.dy || 0);
  
  const distance = Math.hypot(dx, dy);
  if (distance < 30) {
    snapPiece(piece);
  }
}

function onPointerCancel(e) {
  if (!dragElement || e.pointerId !== activePointerId) return;
  
  const piece = dragElement;
  dragElement = null;
  activePointerId = null;
  piece.classList.remove('dragging');
  
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
}

// ピースを白地図にはめ込む処理
function snapPiece(piece) {
  const code = parseInt(piece.dataset.code, 10);
  const origX = parseFloat(piece.dataset.origX);
  const origY = parseFloat(piece.dataset.origY);
  const prefName = piece.dataset.name;

  piece.classList.add('snapped');
  piece.setAttribute('transform', `translate(${origX}, ${origY})`);
  piece.dataset.dx = 0;
  piece.dataset.dy = 0;

  // 白地図側の対応する県にパステルカラーのクラスを追加して塗りつぶす
  const basemapPref = document.querySelector(`.basemap-prefecture.pref-${code}`);
  const regionKey = getRegionKeyByCode(code);
  if (basemapPref && regionKey) {
    basemapPref.classList.add(`filled-${regionKey}`);
  }

  // 効果音
  if (!state.isMuted) {
    sounds.playSnap();
  }

  // 県名ポップアップ表示
  showPrefecturePopup(prefName);

  // パーティクル演出
  createParticles(origX, origY);

  state.completedPrefectures.add(code);
  updateProgress();

  // 地方の完成チェック
  checkRegionCompletion(regionKey);
}

// 県名ポップアップ表示制御
function showPrefecturePopup(prefName) {
  const popup = document.getElementById('prefecture-popup');
  if (!popup) return;
  popup.textContent = prefName;
  popup.classList.add('show');
  
  if (window.prefPopupTimer) {
    clearTimeout(window.prefPopupTimer);
  }
  
  window.prefPopupTimer = setTimeout(() => {
    popup.classList.remove('show');
  }, 1200);
}

// 進捗表示
function updateProgress() {
  const count = state.completedPrefectures.size;
  document.getElementById('progress-text').textContent = `${count} / 47`;
  
  const percentage = (count / 47) * 100;
  document.getElementById('progress-fill').style.width = `${percentage}%`;

  if (count === 47 && state.clearedRegions.size === Object.keys(REGIONS).length) {
    setTimeout(() => {
      alert('おめでとうございます！すべての日本地図パズルを完成させました！あなたは日本地図マスターです！');
    }, 1000);
  }
}

// 地方が完成したかどうかの判定
function checkRegionCompletion(regionKey) {
  if (!regionKey || state.clearedRegions.has(regionKey)) return;

  const region = REGIONS[regionKey];
  const isRegionComplete = region.codes.every(code => state.completedPrefectures.has(code));

  if (isRegionComplete) {
    setTimeout(() => {
      startQuiz(regionKey);
    }, 600);
  }
}

// クイズモードの開始
function startQuiz(regionKey) {
  state.currentRegionQuiz = regionKey;
  
  const region = REGIONS[regionKey];
  const regionPrefectures = quizData[regionKey]; // 地方の都道府県リスト

  // 1. その地方の全クイズをプールに収集
  const pool = [];
  regionPrefectures.forEach(pref => {
    pref.quizzes.forEach(q => {
      pool.push({
        question: q.question,
        hint: q.hint,
        prefName: pref.prefName
      });
    });
  });

  // 2. 出題クイズを選定
  const quizIndex = state.quizIndices[regionKey] % pool.length;
  const quiz = pool[quizIndex];

  // 3. 選択肢を動的に生成
  // 正解の県以外の、同地方の他県名リスト
  const otherPrefs = regionPrefectures
    .map(p => p.prefName)
    .filter(name => name !== quiz.prefName);
  
  // 他県リストからランダムに3つ選出
  shuffleArray(otherPrefs);
  const wrongOptions = otherPrefs.slice(0, 3);

  // 正解と誤答を混ぜる
  const options = [quiz.prefName, ...wrongOptions];
  shuffleArray(options);

  // 正解インデックスを決定
  state.activeQuizAnswer = options.indexOf(quiz.prefName);

  document.getElementById('quiz-region-title').textContent = region.name;
  document.getElementById('quiz-question').innerHTML = quiz.question;

  const optionBtns = document.querySelectorAll('#quiz-options .option-btn');
  optionBtns.forEach((btn, index) => {
    btn.textContent = options[index];
    btn.blur();
  });

  const hintEl = document.getElementById('quiz-hint');
  if (quiz.hint) {
    hintEl.textContent = `ヒント: ${quiz.hint}`;
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }

  document.getElementById('quiz-overlay').classList.add('show');
}

// クイズの回答処理
function handleQuizAnswer(selectedIndex) {
  const overlay = document.getElementById('quiz-overlay');
  const resultOverlay = document.getElementById('result-overlay');
  const resultBadge = document.getElementById('result-badge');

  overlay.classList.remove('show');
  resultOverlay.classList.add('show');

  const isCorrect = selectedIndex === state.activeQuizAnswer;

  if (isCorrect) {
    resultBadge.textContent = '〇';
    resultBadge.className = 'result-badge result-correct';
    if (!state.isMuted) {
      sounds.playCorrect();
    }
    
    state.clearedRegions.add(state.currentRegionQuiz);

    setTimeout(() => {
      resultOverlay.classList.remove('show');
      state.currentRegionQuiz = null;
      updateProgress();
    }, 1500);

  } else {
    resultBadge.textContent = '×';
    resultBadge.className = 'result-badge result-incorrect';
    if (!state.isMuted) {
      sounds.playIncorrect();
    }

    // クリックされたボタンから選択した都道府県名を取得
    const optionBtns = document.querySelectorAll('#quiz-options .option-btn');
    const selectedPrefName = optionBtns[selectedIndex].textContent;

    setTimeout(() => {
      resultOverlay.classList.remove('show');
      blowAwayPrefecture(state.currentRegionQuiz, selectedPrefName);
    }, 1500);
  }
}

// 不正解時に、その地方の1県を十分に離れた位置に弾き飛ばす処理
function blowAwayPrefecture(regionKey, selectedPrefName = null) {
  const region = REGIONS[regionKey];
  const activeCodes = region.codes.filter(code => state.completedPrefectures.has(code));
  
  if (activeCodes.length === 0) {
    state.currentRegionQuiz = null;
    return;
  }

  let targetCode = null;

  if (selectedPrefName) {
    // 選択された都道府県名と一致するスナップ済みピースを検索
    const pieces = Array.from(document.querySelectorAll('.pieces .piece'));
    const matchedPiece = pieces.find(p => {
      const code = parseInt(p.dataset.code, 10);
      return activeCodes.includes(code) && p.dataset.name === selectedPrefName;
    });
    if (matchedPiece) {
      targetCode = parseInt(matchedPiece.dataset.code, 10);
    }
  }

  // 選択された県がスナップされていない、または他地方の県の場合はランダムに選定（フォールバック）
  if (targetCode === null) {
    targetCode = activeCodes[Math.floor(Math.random() * activeCodes.length)];
  }

  const randomCode = targetCode;
  
  state.completedPrefectures.delete(randomCode);
  updateProgress();

  const basemapPref = document.querySelector(`.basemap-prefecture.pref-${randomCode}`);
  if (basemapPref) {
    basemapPref.classList.remove(`filled-${regionKey}`);
  }

  const piece = document.querySelector(`.pieces .piece.pref-${randomCode}`);
  if (piece) {
    piece.classList.remove('snapped');
    
    // 弾き飛ばすアクション用の弾むようなイージング
    piece.style.transition = 'transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

    const origX = parseFloat(piece.dataset.origX);
    const origY = parseFloat(piece.dataset.origY);
    
    // 不正解用の赤い警告パーティクルエフェクトを発生
    createIncorrectParticles(origX, origY);

    // 元の位置から「300px以上」離れている安全なグリッド位置を検索して、そこに弾き飛ばす
    const gridPositions = generateGridPositions();
    shuffleArray(gridPositions);
    
    let scatterPos = null;
    for (const pos of gridPositions) {
      const dist = Math.hypot(pos.x - origX, pos.y - origY);
      if (dist > 300) {
        scatterPos = pos;
        break;
      }
    }
    
    // 見つからない場合はフォールバック
    if (!scatterPos) {
      scatterPos = getFallbackScatterPosition(randomCode);
    }

    const dx = scatterPos.x - origX;
    const dy = scatterPos.y - origY;

    piece.dataset.dx = dx;
    piece.dataset.dy = dy;
    piece.setAttribute('transform', `translate(${scatterPos.x}, ${scatterPos.y})`);

    setTimeout(() => {
      piece.style.transition = '';
      state.currentRegionQuiz = null;
    }, 800);
  } else {
    state.currentRegionQuiz = null;
  }
}

// 正解時のキラキラパーティクル生成
function createParticles(x, y) {
  const container = document.getElementById('particles-container');
  const svg = document.querySelector('svg.map-svg');
  if (!container || !svg) return;

  const rect = svg.getBoundingClientRect();
  const screenX = rect.left + (x / 1000) * rect.width;
  const screenY = rect.top + (y / 1000) * rect.height;

  const particleCount = 20;
  const colors = ['#ffd700', '#ff6b81', '#1e90ff', '#2ed573', '#ffffff', '#ff4757'];

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    
    const size = 5 + Math.random() * 8;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.left = `${screenX}px`;
    particle.style.top = `${screenY}px`;

    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 80;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    
    particle.style.setProperty('--dx', `${dx}px`);
    particle.style.setProperty('--dy', `${dy}px`);

    container.appendChild(particle);

    particle.addEventListener('animationend', () => {
      particle.remove();
    });
  }
}

// 不正解・弾き飛ばし時の赤い警告パーティクル生成
function createIncorrectParticles(x, y) {
  const container = document.getElementById('particles-container');
  const svg = document.querySelector('svg.map-svg');
  if (!container || !svg) return;

  const rect = svg.getBoundingClientRect();
  const screenX = rect.left + (x / 1000) * rect.width;
  const screenY = rect.top + (y / 1000) * rect.height;

  const particleCount = 25;
  const colors = ['#ff4757', '#ff6b81', '#ff3f34', '#ff5e57', '#d63031'];

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    
    const size = 6 + Math.random() * 10;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.left = `${screenX}px`;
    particle.style.top = `${screenY}px`;

    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 110;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    
    particle.style.setProperty('--dx', `${dx}px`);
    particle.style.setProperty('--dy', `${dy}px`);

    container.appendChild(particle);

    particle.addEventListener('animationend', () => {
      particle.remove();
    });
  }
}
