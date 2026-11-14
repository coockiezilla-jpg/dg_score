'use strict';

const VERSION = '1.0.3';
const GAMES_KEY = 'dgscore.games.v1';
const NAMES_KEY = 'dgscore.recentNames.v1';

const MAX_GAMES = 10;
const MAX_PLAYERS = 6;
const MIN_HOLES = 9;
const MAX_HOLES = 25;
const NAME_LIMIT = 16;

const DEFAULT_PLAYERS = 4;
const DEFAULT_HOLES = 18;

/* ---------------- Хранилище ---------------- */

function loadGames() {
  try {
    const raw = localStorage.getItem(GAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveGames(games) {
  try {
    localStorage.setItem(GAMES_KEY, JSON.stringify(games));
  } catch (err) {
    /* квота или приватный режим — молча продолжаем */
  }
}

function isDefaultPlayerName(name) {
  return /^Игрок \d+$/.test(String(name || '').trim());
}

function loadRecentNames() {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n) => typeof n === 'string' && !isDefaultPlayerName(n))
      : [];
  } catch (err) {
    return [];
  }
}

function pushRecentName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || isDefaultPlayerName(trimmed)) return;
  const list = loadRecentNames().filter((n) => n !== trimmed);
  list.unshift(trimmed);
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(list.slice(0, 10)));
  } catch (err) {
    /* игнорируем */
  }
}

/* ---------------- Модель ---------------- */

let games = loadGames();

const ui = {
  screen: 'menu',
  gameId: null,
  hole: 0,
  activePlayer: 0,
  draft: '',
  baseThrows: null,
  draftPenalty: false,
  setup: null,
  editing: false,
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getGame(id) {
  return games.find((g) => g.id === id) || null;
}

function currentGame() {
  return ui.gameId ? getGame(ui.gameId) : null;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function todayLabel(date) {
  const d = date || new Date();
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

/* Системное время устройства в формате ЧЧ:ММ */
function timeLabel(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* Длительность в минутах: «45 мин», «1 ч 16 мин», «2 ч» */
function durationLabel(fromTs, toTs) {
  const from = Number(fromTs);
  const to = Number(toTs);
  if (!from || !to || to < from) return '';

  const totalMin = Math.round((to - from) / 60000);
  if (totalMin < 1) return 'меньше минуты';
  if (totalMin < 60) return totalMin + ' мин';

  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes ? hours + ' ч ' + minutes + ' мин' : hours + ' ч';
}

/* «08.11.2026 · 14:32–15:48 (1 ч 16 мин)»;
   у незавершённой игры время конца и продолжительность неизвестны */
function gameTimeLabel(game) {
  const date = todayLabel(new Date(game.createdAt));
  const start = timeLabel(game.createdAt);
  if (!start) return date;

  if (!game.finished) return date + ' · ' + start;

  const finish = timeLabel(game.finishedAt);
  if (!finish) return date + ' · ' + start;

  const duration = durationLabel(game.createdAt, game.finishedAt);
  return date + ' · ' + start + '–' + finish + (duration ? ' (' + duration + ')' : '');
}

function makeGameName(date) {
  const base = 'Игра - ' + todayLabel(date);
  if (!games.some((g) => g.name === base)) return base;
  let n = 2;
  while (games.some((g) => g.name === 'Игра ' + n + ' - ' + todayLabel(date))) n++;
  return 'Игра ' + n + ' - ' + todayLabel(date);
}

function makeEmptyScores(holeCount, playerCount) {
  const rows = [];
  for (let h = 0; h < holeCount; h++) {
    const row = [];
    for (let p = 0; p < playerCount; p++) row.push(null);
    rows.push(row);
  }
  return rows;
}

function gameIsEmpty(game) {
  return !game.scores.some((row) => row.some((cell) => cell));
}

/* Подгоняет число колонок игроков, сохраняя введённые броски */
function resizeScores(scores, playerCount) {
  return scores.map((row) => {
    const next = row.slice(0, playerCount);
    while (next.length < playerCount) next.push(null);
    return next;
  });
}

function saveGame(game) {
  game.updatedAt = Date.now();
  const idx = games.findIndex((g) => g.id === game.id);
  if (idx >= 0) games[idx] = game;
  else games.push(game);
  saveGames(games);
}

function enforceGameLimit() {
  if (games.length <= MAX_GAMES) return;
  games.sort((a, b) => a.createdAt - b.createdAt);
  games = games.slice(games.length - MAX_GAMES);
  saveGames(games);
}

function deleteGame(id) {
  games = games.filter((g) => g.id !== id);
  saveGames(games);
}

/* ---------------- Экраны ---------------- */

const screens = {
  menu: document.getElementById('screen-menu'),
  list: document.getElementById('screen-list'),
  setup: document.getElementById('screen-setup'),
  score: document.getElementById('screen-score'),
  summary: document.getElementById('screen-summary'),
};

function showScreen(name) {
  ui.screen = name;
  Object.keys(screens).forEach((key) => {
    screens[key].classList.toggle('active', key === name);
  });
  window.scrollTo(0, 0);
}

/* ---------------- Модалка ---------------- */

let modalResolve = null;

function askConfirm(title, text, okLabel) {
  const modal = document.getElementById('modal');
  const ok = document.getElementById('modal-ok');
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = title || '';
  document.getElementById('modal-text').textContent = text || '';
  ok.textContent = okLabel || 'Удалить';
  modal.hidden = false;
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result) {
  document.getElementById('modal').hidden = true;
  if (modalResolve) {
    const fn = modalResolve;
    modalResolve = null;
    fn(result);
  }
}

/* ---------------- Меню и список ---------------- */

function renderVersion() {
  document.getElementById('version-label').textContent = 'v' + VERSION;
}

/* ---------------- Тема ---------------- */

const THEME_KEY = 'dgscore.theme.v1';
const DEFAULT_THEME = 'dark';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/* Сохранённый выбор пользователя. null — настройки ещё нет */
function storedTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch (err) {
    return null;
  }
}

function saveTheme(value) {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch (err) {
    /* приватный режим — тема просто не запомнится */
  }
}

/* persist = false при инициализации: применение темы при запуске
   не должно перезаписывать сохранённый выбор */
function applyTheme(theme, persist) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', value);

  /* Цвет системной полосы состояния: в standalone-режиме iOS
     подстраивает его под фон приложения */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', value === 'light' ? '#f6f0e6' : '#0e1116');

  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.setAttribute('aria-checked', value === 'dark' ? 'true' : 'false');
    toggle.setAttribute('aria-label', value === 'dark' ? 'Тёмная тема' : 'Светлая тема');
  }

  if (persist !== false) saveTheme(value);
}

function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  /* Источник истины — localStorage. Атрибут в разметке нужен только
     для первой отрисовки и может не совпадать с выбором пользователя */
  const saved = storedTheme();
  applyTheme(saved || DEFAULT_THEME, false);

  /* Первый запуск: фиксируем тему по умолчанию, чтобы дальше
     поведение было предсказуемым */
  if (!saved) saveTheme(DEFAULT_THEME);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.addEventListener('click', toggleTheme);
}

function renderList() {
  const box = document.getElementById('games-list');
  box.innerHTML = '';

  if (!games.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Начните первую игру';
    box.appendChild(empty);
    return;
  }

  const sorted = games.slice().sort((a, b) => b.createdAt - a.createdAt);

  sorted.forEach((game) => {
    const row = document.createElement('div');
    row.className = 'game-row';

    const main = document.createElement('div');
    main.className = 'game-row-main';

    const name = document.createElement('div');
    name.className = 'game-row-name';
    name.textContent = game.name;

    main.appendChild(name);

    const players = document.createElement('div');
    players.className = 'game-row-players';
    players.textContent = game.players.map((p) => p.name).join(', ');

    const date = document.createElement('div');
    date.className = 'game-row-date';
    date.textContent = gameTimeLabel(game);

    /* Зона нажатия — название и имена игроков. Дата и время
       намеренно вне её: между зоной открытия и кнопками
       должен оставаться разрыв, чтобы не открывать игру случайно */
    const openZone = document.createElement('div');
    openZone.className = 'game-row-open';
    openZone.addEventListener('click', () => openGame(game.id));
    openZone.appendChild(main);
    openZone.appendChild(players);

    const actions = document.createElement('div');
    actions.className = 'game-row-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = 'Изменить';
    editBtn.addEventListener('click', () => openForEdit(game.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger-ghost';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', async () => {
      const ok = await askConfirm('Удалить игру?', '«' + game.name + '»');
      if (!ok) return;
      deleteGame(game.id);
      renderList();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(openZone);
    row.appendChild(date);
    row.appendChild(actions);
    box.appendChild(row);
  });
}

/* ---------------- Настройка игры ---------------- */

function startNewGameSetup(options) {
  const opts = options || {};
  const returnGameId = opts.returnGameId || null;
  const source = returnGameId ? getGame(returnGameId) : null;

  ui.setup = {
    mode: 'new',
    gameId: null,
    returnGameId: returnGameId,
    players: [],
    holeCount: source ? source.holeCount : DEFAULT_HOLES,
    startHole: source ? source.startHole : 0,
    name: source ? source.name : '',
    namePlaceholder: source ? source.name : makeGameName(new Date()),
  };

  const initial = source ? source.players : null;
  const count = initial ? initial.length : DEFAULT_PLAYERS;
  for (let i = 0; i < count; i++) {
    ui.setup.players.push({
      id: initial ? initial[i].id : uid(),
      name: initial ? initial[i].name : '',
      placeholder: 'Игрок ' + (i + 1),
    });
  }

  document.getElementById('setup-title').textContent = returnGameId ? 'Настройки игры' : 'Новая игра';
  document.getElementById('setup-start-btn').textContent = returnGameId
    ? 'Вернуться к вводу счёта'
    : 'Начать игру';

  renderSetup();
  showScreen('setup');
}

/* Плейсхолдеры «Игрок N» не должны повторяться: строки с пустым именем
   сохраняют свой номер, если он свободен, а освободившийся номер достаётся
   новой строке. */
function syncPlaceholders(setup) {
  const used = new Set();
  setup.players.forEach((p) => {
    const name = (p.name || '').trim();
    if (name) used.add(name);
  });

  const empty = setup.players.filter((p) => !(p.name || '').trim());

  empty.forEach((p) => {
    if (p.placeholder && !used.has(p.placeholder)) used.add(p.placeholder);
    else p.placeholder = '';
  });

  let next = 1;
  empty.forEach((p) => {
    if (p.placeholder) return;
    while (used.has('Игрок ' + next)) next++;
    p.placeholder = 'Игрок ' + next;
    used.add(p.placeholder);
    next++;
  });
}

function renderSetup() {
  const setup = ui.setup;
  if (!setup) return;

  syncPlaceholders(setup);

  const nameInput = document.getElementById('game-name-input');
  if (nameInput) {
    nameInput.placeholder = setup.namePlaceholder || '';
    if (document.activeElement !== nameInput) nameInput.value = setup.name || '';
  }

  const playersBox = document.getElementById('players-list');
  playersBox.innerHTML = '';

  setup.players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'player-row';

    const input = document.createElement('input');
    input.className = 'player-input';
    input.type = 'text';
    input.maxLength = NAME_LIMIT;
    input.placeholder = player.placeholder;
    input.value = player.name;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'words');
    input.setAttribute('spellcheck', 'false');

    input.addEventListener('focus', () => {
      input.value = player.name;
      showNameSuggestions(row, input, player);
    });

    input.addEventListener('blur', () => {
      player.name = input.value.slice(0, NAME_LIMIT);
      input.value = player.name;
      hideNameSuggestions();
    });

    input.addEventListener('input', () => {
      if (input.value.length > NAME_LIMIT) {
        input.value = input.value.slice(0, NAME_LIMIT);
      }
      player.name = input.value;
      input.classList.remove('invalid');
    });

    row.appendChild(input);

    /* Кнопку удаления не показываем, когда игрок остался один:
       убрать его нельзя, а кнопка создавала бы ложную возможность */
    if (setup.players.length > 1) {
      const remove = document.createElement('button');
      remove.className = 'player-remove';
      remove.type = 'button';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        if (setup.players.length <= 1) return;
        setup.players.splice(index, 1);
        renderSetup();
      });
      row.appendChild(remove);
    }

    playersBox.appendChild(row);
  });

  const addBtn = document.querySelector('[data-act="add-player"]');
  addBtn.style.display = setup.players.length >= MAX_PLAYERS ? 'none' : '';

  document.getElementById('holes-value').textContent = setup.holeCount;

  const startValue = document.getElementById('start-value');
  const startBlock = document.getElementById('block-start');

  /* Стартовую корзину выбирают только при создании игры. При возврате
     с экрана ввода счёта блок скрыт: менять старт уже сыгранной игры
     нельзя, иначе поедет нумерация и подсветка пропусков */
  if (setup.mode === 'edit' || setup.returnGameId) {
    startBlock.style.display = 'none';
  } else {
    startBlock.style.display = '';
    startValue.textContent = setup.startHole + 1;
  }

  const holesBlock = document.getElementById('block-holes');
  /* Число корзин задаётся только при создании игры: в уже начатой
     игре менять его нельзя — счёт привязан к корзинам */
  if (setup.mode === 'edit' || setup.returnGameId) {
    holesBlock.style.display = 'none';
  } else {
    holesBlock.style.display = '';
  }

  /* Название задаётся только при создании игры */
  const nameBlock = document.getElementById('block-name');
  if (nameBlock) nameBlock.style.display = setup.mode === 'edit' ? 'none' : '';

  /* При возврате с экрана ввода счёта «Назад» в шапке не нужна:
     ту же роль играет кнопка «Вернуться к вводу счёта» внизу.
     Место кнопки сохраняем, чтобы заголовок остался по центру */
  const backBtn = document.getElementById('setup-back-btn');
  if (backBtn) backBtn.style.visibility = setup.returnGameId ? 'hidden' : '';

  document.querySelectorAll('.quick-row .btn.chip').forEach((chip) => {
    chip.classList.toggle('active', Number(chip.textContent) === setup.holeCount);
  });
}

let suggestionBox = null;

function hideNameSuggestions() {
  if (suggestionBox && suggestionBox.parentNode) suggestionBox.parentNode.removeChild(suggestionBox);
  suggestionBox = null;
}

function showNameSuggestions(row, input, player) {
  hideNameSuggestions();

  /* Имена, уже занятые другими полями, не предлагаем */
  const taken = new Set(
    ui.setup.players
      .filter((p) => p !== player)
      .map((p) => (p.name || '').trim())
      .filter(Boolean)
  );

  const names = loadRecentNames().filter((n) => !taken.has(n) && n !== player.name);
  if (!names.length) return;

  const box = document.createElement('div');
  box.className = 'suggest-box';

  names.forEach((name) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'suggest-item';
    item.textContent = name;
    item.addEventListener('mousedown', (ev) => ev.preventDefault());
    item.addEventListener('click', () => {
      input.value = name.slice(0, NAME_LIMIT);
      player.name = input.value;
      hideNameSuggestions();
      input.focus();
    });
    box.appendChild(item);
  });

  row.appendChild(box);
  suggestionBox = box;
}

function setupHoles(delta) {
  const setup = ui.setup;
  setup.holeCount = Math.min(MAX_HOLES, Math.max(MIN_HOLES, setup.holeCount + delta));
  if (setup.startHole > setup.holeCount - 1) setup.startHole = setup.holeCount - 1;
  renderSetup();
}

/* Стартовая корзина листается по кругу: с первой влево — на последнюю,
   с последней вправо — на первую */
function setupStartHole(delta) {
  const setup = ui.setup;
  const last = setup.holeCount - 1;
  if (last < 0) return;
  let next = setup.startHole + delta;
  if (next < 0) next = last;
  if (next > last) next = 0;
  setup.startHole = next;
  renderSetup();
}

function commitSetup() {
  const setup = ui.setup;
  const game = setup.mode === 'edit' ? getGame(setup.gameId) : null;

  syncPlaceholders(setup);
  setup.players.forEach((p, i) => {
    const value = (p.name || '').trim();
    if (value) pushRecentName(value);
    p.name = value || p.placeholder || 'Игрок ' + (i + 1);
  });

  /* Своё название заменяет дефолтное, пустое поле — дефолт */
  const customName = (setup.name || '').trim();
  const finalName = customName || setup.namePlaceholder || makeGameName(new Date());
  setup.name = customName;

  /* Возврат из экрана ввода счёта — правим уже созданную игру */
  if (setup.returnGameId) {
    const existing = getGame(setup.returnGameId);
    if (existing) {
      /* Возвращаемся на ту корзину, с которой пользователь ушёл в настройки */
      const resumeHole = Math.min(
        Math.max(typeof existing.currentHole === 'number' ? existing.currentHole : setup.startHole, 0),
        setup.holeCount - 1
      );

      const wasEmpty = gameIsEmpty(existing);
      if (wasEmpty) {
        existing.holeCount = setup.holeCount;
        existing.startHole = setup.startHole;
        existing.scores = makeEmptyScores(setup.holeCount, setup.players.length);
      } else {
        existing.scores = resizeScores(existing.scores, setup.players.length);
      }
      existing.currentHole = resumeHole;
      existing.players = setup.players.map((p) => ({ id: p.id, name: p.name }));
      existing.name = finalName;
      saveGame(existing);
      ui.setup = null;
      openGame(existing.id);
      return;
    }
  }

  if (setup.mode === 'edit' && game) {
    game.players = setup.players.map((p) => ({ id: p.id, name: p.name }));
    game.name = finalName;
    saveGame(game);
    openForEdit(game.id);
    return;
  }

  const created = new Date();
  const newGame = {
    id: uid(),
    name: finalName,
    createdAt: created.getTime(),
    updatedAt: created.getTime(),
    finished: false,
    finishedAt: null,
    players: setup.players.map((p) => ({ id: p.id, name: p.name })),
    holeCount: setup.holeCount,
    startHole: setup.startHole,
    currentHole: setup.startHole,
    scores: makeEmptyScores(setup.holeCount, setup.players.length),
  };

  games.push(newGame);
  enforceGameLimit();
  saveGame(newGame);
  openGame(newGame.id);
}

/* ---------------- Ввод счёта ---------------- */

function openGame(gameId) {
  const game = getGame(gameId);
  if (!game) return;

  if (game.finished) {
    ui.gameId = game.id;
    ui.editing = false;
    renderSummary();
    showScreen('summary');
    return;
  }

  ui.gameId = game.id;
  ui.editing = false;
  ui.hole = game.currentHole || 0;
  if (ui.hole > game.holeCount - 1) ui.hole = game.holeCount - 1;
  if (ui.hole < 0) ui.hole = 0;
  ui.activePlayer = 0;
  resetCellEditor(game, ui.hole, 0);

  renderScore();
  showScreen('score');
  requestWakeLock();
}

/* Правка сохранённой игры: всегда открывается первая корзина */
function openForEdit(gameId) {
  const game = getGame(gameId);
  if (!game) return;

  ui.gameId = game.id;
  ui.editing = true;
  ui.hole = 0;
  ui.activePlayer = 0;
  resetCellEditor(game, 0, 0);

  renderScore();
  showScreen('score');
  requestWakeLock();
}

function cellValue(game, hole, player) {
  const row = game.scores[hole];
  if (!row) return null;

  const value = row[player];
  if (!value) return null;

  /* 0 бросков физически невозможен: такую запись считаем незаполненной.
     Отметка штрафа при этом сохраняется */
  if (typeof value.throws === 'number' && value.throws <= 0) {
    return value.penalty ? { throws: null, penalty: true } : null;
  }

  return value;
}

function activeThrows() {
  if (ui.draft !== '') {
    const parsed = parseInt(ui.draft, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return ui.baseThrows;
}

function displayValue(game, hole, player) {
  if (hole === ui.hole && player === ui.activePlayer) return activeThrows();
  const value = cellValue(game, hole, player);
  return value ? value.throws : null;
}

function displayPenalty(game, hole, player) {
  if (hole === ui.hole && player === ui.activePlayer) return ui.draftPenalty;
  const value = cellValue(game, hole, player);
  return value ? !!value.penalty : false;
}

function playerSum(game, playerIndex) {
  let sum = 0;
  for (let h = 0; h < game.holeCount; h++) {
    let value;
    if (h === ui.hole && playerIndex === ui.activePlayer) value = activeThrows();
    else {
      const stored = cellValue(game, h, playerIndex);
      value = stored ? stored.throws : null;
    }
    if (typeof value === 'number') sum += value;
  }
  return sum;
}

/* Корзина считается начатой, если в ней есть хоть одна запись */
function holeHasAnyValue(game, hole) {
  const row = game.scores[hole];
  if (!row) return false;
  return row.some((v) => v !== null && v !== undefined);
}

function renderScore() {
  const game = currentGame();
  if (!game) return;

  const grid = document.getElementById('score-grid');
  grid.innerHTML = '';
  grid.classList.toggle('many-players', game.players.length >= 5);

  const holes = [ui.hole - 2, ui.hole - 1, ui.hole];
  const rowCount = game.players.length + 1;

  /* Все элементы получают явные координаты в сетке, чтобы подложку
     текущего столбца можно было положить поверх без сдвига раскладки */
  const place = (el, row, col) => {
    el.style.gridRow = String(row);
    el.style.gridColumn = String(col);
  };

  const colBg = document.createElement('div');
  colBg.className = 'col-bg';
  colBg.style.gridColumn = '4';
  colBg.style.gridRow = '1 / span ' + rowCount;
  grid.appendChild(colBg);

  const corner = document.createElement('div');
  corner.className = 'grid-head';
  place(corner, 1, 1);
  grid.appendChild(corner);

  holes.forEach((h, i) => {
    const head = document.createElement('div');
    head.className = 'grid-head';
    if (h === ui.hole) head.classList.add('current');
    head.textContent = h >= 0 ? String(h + 1) : '';
    place(head, 1, i + 2);
    grid.appendChild(head);
  });

  const sumHead = document.createElement('div');
  sumHead.className = 'grid-head sum';
  sumHead.textContent = 'Итог';
  place(sumHead, 1, 5);
  grid.appendChild(sumHead);

  game.players.forEach((player, pIndex) => {
    const row = pIndex + 2;

    /* Тонкая линия над строкой: под шапкой и между игроками,
       от начала имён до конца столбца «Итог» */
    const line = document.createElement('div');
    line.className = 'row-line';
    line.style.gridRow = String(row);
    line.style.gridColumn = '1 / 6';
    grid.appendChild(line);

    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = player.name;
    nameEl.title = player.name;
    place(nameEl, row, 1);
    grid.appendChild(nameEl);

    holes.forEach((h, i) => {
      const cell = document.createElement('div');
      cell.className = 'cell';

      if (h < 0) {
        cell.classList.add('placeholder');
        cell.style.visibility = 'hidden';
        place(cell, row, i + 2);
        grid.appendChild(cell);
        return;
      }

      const isCurrent = h === ui.hole;
      const value = displayValue(game, h, pIndex);
      const penalty = displayPenalty(game, h, pIndex);

      cell.textContent = value === null ? '' : String(value);

      if (isCurrent) {
        cell.classList.add('current');
        if (h === ui.hole && pIndex === ui.activePlayer) cell.classList.add('active');
      } else {
        cell.classList.add('past');
      }

      if (value === null) {
        cell.classList.add('empty');
        /* Красным помечаем пропуск только в уже начатой корзине: иначе
           нетронутые корзины (в т.ч. до стартовой) выглядели бы ошибкой */
        if (!isCurrent && holeHasAnyValue(game, h)) cell.classList.add('warn');
      } else {
        cell.classList.add('filled');
      }

      if (penalty) {
        const bar = document.createElement('span');
        bar.className = 'pen-bar';
        cell.appendChild(bar);
      }

      if (isCurrent) {
        cell.addEventListener('click', () => activateCell(pIndex));
      }

      place(cell, row, i + 2);
      grid.appendChild(cell);
    });

    const sumCell = document.createElement('div');
    sumCell.className = 'cell sum';
    sumCell.textContent = String(playerSum(game, pIndex));
    place(sumCell, row, 5);
    grid.appendChild(sumCell);
  });

  /* Замыкающая линия под последним игроком — как в таблице результатов:
     иначе сетка выглядит обрезанной снизу */
  const bottomLine = document.createElement('div');
  bottomLine.className = 'row-line';
  bottomLine.style.gridRow = String(game.players.length + 2);
  bottomLine.style.gridColumn = '1 / 6';
  grid.appendChild(bottomLine);
}

function activateCell(playerIndex) {
  if (playerIndex === ui.activePlayer) return;
  commitCell();
  const game = currentGame();
  ui.activePlayer = playerIndex;
  resetCellEditor(game, ui.hole, playerIndex);
  renderScore();
}

function commitCell() {
  const game = currentGame();
  if (!game) return;

  const throws = activeThrows();
  /* «0» — не бросок: храним как пустую ячейку, чтобы при перелистывании
     корзина считалась незаполненной */
  const stored = throws === 0 ? null : throws;

  if (stored === null && !ui.draftPenalty) {
    game.scores[ui.hole][ui.activePlayer] = null;
  } else {
    game.scores[ui.hole][ui.activePlayer] = { throws: stored, penalty: !!ui.draftPenalty };
  }
}

function resetCellEditor(game, hole, player) {
  const stored = cellValue(game, hole, player);
  ui.draft = '';
  ui.baseThrows = stored ? stored.throws : null;
  ui.draftPenalty = stored ? !!stored.penalty : false;
}

function flush() {
  const game = currentGame();
  if (!game || ui.screen !== 'score') return;
  commitCell();
  if (!ui.editing) game.currentHole = ui.hole;
  saveGame(game);
}

function goHole(delta, playerIndex = 0) {
  const game = currentGame();
  if (!game) return;

  const first = 0;
  const last = game.holeCount - 1;

  let next = ui.hole + delta;
  if (next < first) next = last;
  if (next > last) next = first;

  commitCell();
  if (!ui.editing) game.currentHole = next;
  saveGame(game);

  ui.hole = next;
  ui.activePlayer = playerIndex;
  resetCellEditor(game, next, playerIndex);

  renderScore();
}

/* Столбец заполнен целиком: у всех игроков есть счёт в текущей корзине.
   Учитывается и значение, которое пользователь набирает прямо сейчас, —
   иначе после ввода последней цифры стрелка всё равно вела бы по строкам */
function holeIsComplete(game, hole) {
  return game.players.every((_, p) => {
    if (hole === ui.hole && p === ui.activePlayer) return activeThrows() !== null;
    return cellValue(game, hole, p) !== null;
  });
}

/* Стрелки ведут фокус по игрокам текущей корзины: счёт вводится сверху
   вниз, от первого игрока к последнему. Только на краю столбца фокус
   переходит на соседнюю корзину — вниз к первому игроку, вверх
   к последнему, чтобы движение по столбцу не прерывалось.
   Если же счёт проставлен у всех игроков, ходить по строкам незачем:
   стрелки сразу перелистывают корзины, как раньше */
function moveFocus(delta) {
  const game = currentGame();
  if (!game) return;

  if (holeIsComplete(game, ui.hole)) {
    goHole(delta, 0);
    return;
  }

  const playerCount = game.players.length;
  const nextPlayer = ui.activePlayer + delta;

  if (nextPlayer >= 0 && nextPlayer < playerCount) {
    commitCell();
    saveGame(game);
    ui.activePlayer = nextPlayer;
    resetCellEditor(game, ui.hole, nextPlayer);
    renderScore();
    return;
  }

  goHole(delta, delta > 0 ? 0 : playerCount - 1);
}

function handleKey(key) {
  if (/^[0-9]$/.test(key)) return handleDigit(key);
  if (key === 'back') return handleBackspace();
  if (key === 'pen') return handlePen();
  if (key === 'prev') return moveFocus(-1);
  if (key === 'next') return moveFocus(1);
}

function handleDigit(digit) {
  if (ui.draft.length >= 2) return;
  if (ui.draft === '') ui.baseThrows = null;
  ui.draft += digit;
  renderScore();
}

function handleBackspace() {
  if (ui.draft !== '') {
    ui.draft = ui.draft.slice(0, -1);
  } else if (ui.baseThrows !== null) {
    ui.baseThrows = null;
    ui.draftPenalty = false;
  } else {
    return;
  }
  renderScore();
}

function handlePen() {
  ui.draftPenalty = !ui.draftPenalty;
  renderScore();
}

function leaveScore() {
  const game = currentGame();
  if (!game) return;
  const wasEditing = ui.editing;
  commitCell();
  if (!ui.editing) game.currentHole = ui.hole;
  saveGame(game);
  ui.editing = false;
  releaseWakeLock();

  /* Правка сохранённой игры — обратно в список */
  if (wasEditing) {
    renderList();
    showScreen('list');
    return;
  }

  /* Иначе возврат к шагу настройки этой же игры */
  startNewGameSetup({ returnGameId: game.id });
}

/* ---------------- Итоги ---------------- */

/* Для таблицы результатов показываем все корзины игры, включая те,
   что были до стартовой: иначе первые столбцы «исчезают» из итогов */
function playedRange(game) {
  const holes = [];
  for (let h = 0; h < game.holeCount; h++) holes.push(h);
  return holes;
}

/* А в сумму и в проверку полноты идут только реально игравшиеся корзины.
   Если в корзины до стартовой всё же попал счёт (правка сохранённой игры),
   они тоже учитываются — иначе броски молча выпадут из итога */
function scoredRange(game) {
  const last = game.holeCount - 1;
  let from = Math.min(Math.max(game.startHole || 0, 0), last);

  for (let h = 0; h < from; h++) {
    if (holeHasAnyValue(game, h)) {
      from = 0;
      break;
    }
  }

  const holes = [];
  for (let h = from; h <= last; h++) holes.push(h);
  return holes;
}

function playerStats(game, index, holes) {
  let sum = 0;
  let complete = true;
  let filled = 0;

  holes.forEach((h) => {
    const value = cellValue(game, h, index);
    if (value && typeof value.throws === 'number') {
      sum += value.throws;
      filled++;
    } else {
      complete = false;
    }
  });

  return { sum: sum, complete: complete, filled: filled };
}

function sortedPlayers(game, holes) {
  const list = game.players.map((player, index) => {
    const stats = playerStats(game, index, holes);
    return {
      index: index,
      player: player,
      sum: stats.sum,
      complete: stats.complete,
    };
  });

  const complete = list.filter((item) => item.complete).sort((a, b) => a.sum - b.sum);
  const incomplete = list.filter((item) => !item.complete);

  return complete.concat(incomplete);
}

function renderSummary() {
  const game = currentGame();
  if (!game) return;

  const box = document.getElementById('summary-content');
  box.innerHTML = '';

  /* Название игры — под заголовком «Результаты», чтобы было видно,
     итоги какой игры открыты */
  const gameName = document.createElement('div');
  gameName.className = 'summary-game-name';
  gameName.textContent = game.name;
  gameName.title = game.name;
  box.appendChild(gameName);

  /* В таблице — все корзины игры, в сортировку и суммы — только сыгранные */
  const holes = playedRange(game);
  const scored = scoredRange(game);
  const ordered = sortedPlayers(game, scored);

  const missing = ordered.filter((item) => !item.complete);
  if (missing.length) {
    const warn = document.createElement('div');
    warn.className = 'summary-warn';
    const parts = missing.map((item) => item.player.name);
    warn.textContent =
      (parts.length === 1
        ? 'У игрока ' + parts[0] + ' введены не все корзины'
        : 'Не все корзины введены у игроков: ' + parts.join(', '));
    box.appendChild(warn);
  }

  const wrap = document.createElement('div');
  wrap.className = 'summary-body';

  /* Имена и «Итог» стоят вне прокрутки: горизонтальный скролл идёт
     только под ячейками корзин */
  const names = document.createElement('div');
  names.className = 'summary-names';

  const scroller = document.createElement('div');
  scroller.className = 'summary-table-wrap';

  const sums = document.createElement('div');
  sums.className = 'summary-sums';

  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  grid.style.gridTemplateColumns = 'repeat(' + holes.length + ', var(--s-cell-w))';

  const place = (el, row, col) => {
    el.style.gridRow = String(row);
    el.style.gridColumn = String(col);
  };

  /* Шапка: «Изменить» слева, номера корзин над ячейками, «Итог» справа */
  const corner = document.createElement('div');
  corner.className = 's-head s-name';

  /* Быстрый возврат к вводу счёта, если в таблице замечена ошибка */
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn ghost';
  editBtn.textContent = 'Изменить';
  editBtn.addEventListener('click', () => editFromSummary());
  corner.appendChild(editBtn);
  place(corner, 1, 1);
  names.appendChild(corner);

  holes.forEach((h, i) => {
    const head = document.createElement('div');
    head.className = 's-head';
    head.textContent = String(h + 1);
    place(head, 1, i + 1);
    grid.appendChild(head);
  });

  const sumHead = document.createElement('div');
  sumHead.className = 's-head s-sum-head';
  sumHead.textContent = 'Итог';
  place(sumHead, 1, 1);
  sums.appendChild(sumHead);

  ordered.forEach((item, index) => {
    const row = index + 2;

    /* Тонкая линия над строкой — как на экране ввода счёта */
    [names, grid, sums].forEach((block) => {
      const line = document.createElement('div');
      line.className = 'row-line';
      place(line, row, '1 / -1');
      block.appendChild(line);
    });

    const name = document.createElement('div');
    name.className = 's-name';
    name.textContent = item.player.name;
    name.title = item.player.name;
    place(name, row, 1);
    names.appendChild(name);

    holes.forEach((h, i) => {
      const cell = document.createElement('div');
      cell.className = 's-cell';
      const value = cellValue(game, h, item.index);

      if (!value || typeof value.throws !== 'number') {
        /* Незаполненная корзина — красный прочерк. Это касается и корзин
           до стартовой: счёт в них не вводился, значит пропуск такой же */
        cell.textContent = '—';
        cell.classList.add('empty-cell');
      } else {
        cell.textContent = String(value.throws);
        if (value.penalty) cell.classList.add('pen-cell');
      }

      place(cell, row, i + 1);
      grid.appendChild(cell);
    });

    const sum = document.createElement('div');
    sum.className = 's-cell s-sum';
    /* Сумма выводится всегда: даже если введены не все корзины,
       это счёт по уже сыгранным */
    sum.textContent = String(item.sum);
    if (!item.complete) sum.classList.add('incomplete');
    place(sum, row, 1);
    sums.appendChild(sum);
  });

  /* Замыкающая линия под последним игроком: без неё таблица
     выглядит обрезанной снизу */
  const bottomRow = ordered.length + 2;
  [names, grid, sums].forEach((block) => {
    const line = document.createElement('div');
    line.className = 'row-line';
    place(line, bottomRow, '1 / -1');
    block.appendChild(line);
  });

  scroller.appendChild(grid);
  wrap.appendChild(names);
  wrap.appendChild(scroller);
  wrap.appendChild(sums);
  box.appendChild(wrap);

  const hint = document.createElement('div');
  hint.className = 'summary-scroll-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = '<< Прокрути таблицу >>';
  box.appendChild(hint);

  requestAnimationFrame(() => {
    syncSummaryRows(names, grid, sums);
    /* Подсказка нужна только если таблица действительно не влезает */
    const canScroll = scroller.scrollWidth > scroller.clientWidth + 1;
    hint.hidden = !canScroll;
  });
}

/* Строки трёх блоков должны совпадать: имя может занять две строки,
   и тогда ячейки с суммой обязаны вырасти вместе с ним */
function syncSummaryRows(names, grid, sums) {
  const nameRows = Array.from(names.querySelectorAll('.s-head.s-name, .s-name'));
  if (!nameRows.length) return;

  const rows = nameRows.map((el) => {
    const height = el.getBoundingClientRect().height;
    return Math.round(Math.max(height, 0)) + 'px';
  });
  const value = rows.join(' ');

  [names, grid, sums].forEach((block) => {
    block.style.gridTemplateRows = value;
  });
}

/* ---------------- JPG ---------------- */

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  let label = String(text);
  if (ctx.measureText(label).width <= maxWidth) return label;
  while (label.length > 1 && ctx.measureText(label + '…').width > maxWidth) {
    label = label.slice(0, -1);
  }
  return label + '…';
}

function renderSummaryImage(game) {
  const holes = playedRange(game);
  const scored = scoredRange(game);
  const ordered = sortedPlayers(game, scored);

  const padX = 48;
  const padY = 44;
  const nameColW = 250;
  const gap = 6;
  const rowH = 56;
  const cellH = 44;

  /* Ширина столбца «Итог» — ровно по слову: замеряем его тем же шрифтом,
     которым подписан заголовок. Минимум 64 px, чтобы влезали трёхзначные
     суммы вида «100» */
  const sumLabel = 'Итог';
  const sumFont = 'bold 24px -apple-system, "Helvetica Neue", Arial, sans-serif';
  const measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = sumFont;
  const sumColW = Math.max(64, Math.ceil(measureCtx.measureText(sumLabel).width) + 16);

  /* Колонки корзин подстраиваются под их количество: таблица всегда
     горизонтальная — имена слева, корзины вправо, «Итог» у правого края.
     Нижняя граница ширины ячейки не даёт столбцам сжаться в точку,
     а верхняя — выйти за лимиты canvas на iOS */
  const minCellW = 52;
  const maxCellW = 96;
  const canvasLimit = 4096;
  const baseWidth = padX * 2 + nameColW + sumColW + gap * (holes.length + 1);
  let cellW = Math.round((1080 - baseWidth) / Math.max(1, holes.length));
  cellW = Math.max(minCellW, Math.min(maxCellW, cellW));
  const available = Math.floor((canvasLimit - baseWidth) / Math.max(1, holes.length));
  if (available > 0 && cellW > available) cellW = Math.max(28, available);

  const width = baseWidth + cellW * holes.length;
  const titleH = 96;
  const headH = 56;
  const footerH = 96;
  const height = padY + titleH + headH + rowH * ordered.length + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#0e1116';
  ctx.font = 'bold 44px -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(game.name, padX, padY);

  let y = padY + titleH;

  /* Шапка: номера корзин и «Итог» */
  ctx.fillStyle = '#5a6675';
  ctx.font = 'bold 24px -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Игрок', padX, y + 16);

  ctx.textAlign = 'center';
  holes.forEach((h, i) => {
    const x = padX + nameColW + gap + i * (cellW + gap) + cellW / 2;
    ctx.fillText(String(h + 1), x, y + 16);
  });

  const sumX = padX + nameColW + gap + holes.length * (cellW + gap) + sumColW / 2;
  ctx.font = sumFont;
  ctx.fillText(sumLabel, sumX, y + 16);
  ctx.textAlign = 'left';

  y += headH;

  /* Правая граница таблицы: до неё тянутся разделительные линии строк */
  const rightEdge = sumX + sumColW / 2;

  /* Строки — игроки */
  ordered.forEach((item) => {
    const cellY = y + (rowH - cellH) / 2;

    /* Разделитель над строкой — как тонкие линии на экранах приложения.
       Рисуется до ячеек, чтобы не перечёркивать их */
    ctx.fillStyle = '#ccd3db';
    ctx.fillRect(padX, y - 1, rightEdge - padX, 2);

    ctx.fillStyle = '#0e1116';
    ctx.font = '26px -apple-system, "Helvetica Neue", Arial, sans-serif';
    const label = fitText(ctx, item.player.name, nameColW - 8);
    ctx.fillText(label, padX, y + 14);

    holes.forEach((h, i) => {
      const x = padX + nameColW + gap + i * (cellW + gap);
      const value = cellValue(game, h, item.index);

      if (!value || typeof value.throws !== 'number') {
        /* Незаполненная корзина — красный прочерк, в том числе
           для корзин до стартовой: они тоже остались без счёта */
        ctx.fillStyle = '#fdecec';
        roundRect(ctx, x, cellY, cellW, cellH, 8);
        ctx.fill();

        ctx.fillStyle = '#d1242f';
        ctx.font = 'bold 24px -apple-system, "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('—', x + cellW / 2, cellY + 10);
      } else {
        ctx.fillStyle = '#f1f3f6';
        roundRect(ctx, x, cellY, cellW, cellH, 8);
        ctx.fill();

        ctx.fillStyle = '#0e1116';
        ctx.font = '26px -apple-system, "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(value.throws), x + cellW / 2, cellY + 9);

        if (value.penalty) {
          /* Полоска штрафа — по верхней границе ячейки, как рамка */
          ctx.fillStyle = '#e5534b';
          roundRect(ctx, x + 10, cellY, cellW - 20, 4, 2);
          ctx.fill();
        }
      }
      ctx.textAlign = 'left';
    });

    /* Сумма выводится всегда; у неполного игрока клетка остаётся красной,
       чтобы было видно, что счёт предварительный */
    ctx.fillStyle = item.complete ? '#e8ebef' : '#fdecec';
    roundRect(ctx, sumX - sumColW / 2, cellY, sumColW, cellH, 8);
    ctx.fill();

    ctx.fillStyle = item.complete ? '#0e1116' : '#d1242f';
    ctx.font = 'bold 26px -apple-system, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(item.sum), sumX, cellY + 9);
    ctx.textAlign = 'left';

    y += rowH;
  });

  /* Замыкающая линия под последним игроком — как на экранах приложения */
  ctx.fillStyle = '#ccd3db';
  ctx.fillRect(padX, y - 1, rightEdge - padX, 2);

  /* Подвал: логотип слева, дата игры — справа */
  ctx.fillStyle = '#9aa4b1';
  ctx.font = '22px -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('DG score', padX, y + 30);

  ctx.textAlign = 'right';
  ctx.fillText(todayLabel(new Date(game.createdAt)), width - padX, y + 30);
  ctx.textAlign = 'left';

  return canvas;
}

function safeFileName(name) {
  return String(name || 'DG score')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* JPEG синхронно: canvas.toBlob асинхронный, а на iOS вызов «Поделиться»
   обязан идти из обработчика клика, иначе теряется user gesture и шит
   открывается дважды — сначала пустой файл, потом настоящий */
function canvasToJpegBlob(canvas, quality) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;

  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new Blob([bytes], { type: 'image/jpeg' });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let savingSummary = false;
let savingSummaryTimer = null;

/* Блокировка ставится до начала подготовки файла: на iPhone рендер canvas
   занимает заметное время, и второй клик успевал запустить второе сохранение */
function beginSave() {
  if (savingSummary) return false;
  savingSummary = true;
  if (savingSummaryTimer) clearTimeout(savingSummaryTimer);
  /* Страховка: iOS иногда не завершает промис share — кнопка не должна
     остаться заблокированной навсегда */
  savingSummaryTimer = setTimeout(() => {
    savingSummary = false;
    savingSummaryTimer = null;
  }, 15000);
  return true;
}

function endSave() {
  if (savingSummaryTimer) {
    clearTimeout(savingSummaryTimer);
    savingSummaryTimer = null;
  }
  /* Пауза гасит второй клик двойного тапа */
  setTimeout(() => {
    savingSummary = false;
  }, 600);
}

function saveSummaryImage() {
  if (!beginSave()) return;

  const game = currentGame();
  if (!game) {
    endSave();
    return;
  }

  const blob = canvasToJpegBlob(renderSummaryImage(game), 0.92);
  if (!blob || !blob.size) {
    showToast('Не удалось подготовить файл');
    endSave();
    return;
  }

  const fileName = safeFileName(game.name) + '.jpg';
  const file = new File([blob], fileName, { type: 'image/jpeg' });

  /* Единственный путь сохранения — системный шит «Поделиться»:
     файл создаётся в памяти и попадает на диск только по выбору
     пользователя. Диалог showSaveFilePicker не используем: он создаёт
     файл на диске до записи данных, и при сбое остаётся пустышка 0 КБ,
     а следом срабатывает резервная загрузка — два файла вместо одного */
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator
      .share({ files: [file] })
      .catch((err) => {
        if (err && err.name === 'AbortError') return;
        showToast('Не удалось открыть «Поделиться». Попробуйте ещё раз');
      })
      .finally(endSave);
    return;
  }

  /* Без шита (десктопные браузеры) — обычная загрузка в «Загрузки» */
  downloadBlob(blob, fileName);
  showToast('Файл сохранён в «Загрузки»: ' + fileName);
  endSave();
}

/* Короткое сообщение внизу экрана: подсказывает, куда попал файл */
let toastTimer = null;

function showToast(text) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.className = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }

  box.textContent = text;
  box.classList.add('visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.remove('visible');
    toastTimer = null;
  }, 4000);
}

/* ---------------- Wake Lock ---------------- */

let wakeLock = null;
let wakeTimer = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    wakeLock = null;
  }
  resetWakeTimer();
}

function resetWakeTimer() {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => releaseWakeLock(), 10 * 60 * 1000);
}

function releaseWakeLock() {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (wakeLock) {
    try {
      wakeLock.release();
    } catch (err) {
      /* игнорируем */
    }
    wakeLock = null;
  }
}

/* ---------------- События ---------------- */

document.addEventListener('click', async (ev) => {
  const target = ev.target.closest('[data-act]');
  if (!target) return;

  const act = target.getAttribute('data-act');

  switch (act) {
    case 'new-game':
      startNewGameSetup();
      break;
    case 'open-list':
      renderList();
      showScreen('list');
      break;
    case 'list-back':
      showScreen('menu');
      break;
    case 'setup-cancel':
      if (ui.setup && ui.setup.returnGameId) {
        openGame(ui.setup.returnGameId);
        ui.setup = null;
      } else {
        ui.setup = null;
        showScreen('menu');
      }
      break;
    case 'add-player':
      if (ui.setup.players.length < MAX_PLAYERS) {
        ui.setup.players.push({
          id: uid(),
          name: '',
          placeholder: 'Игрок ' + (ui.setup.players.length + 1),
        });
        renderSetup();
      }
      break;
    case 'holes-minus':
      setupHoles(-1);
      break;
    case 'holes-plus':
      setupHoles(1);
      break;
    case 'holes-9':
      ui.setup.holeCount = 9;
      if (ui.setup.startHole > 8) ui.setup.startHole = 8;
      renderSetup();
      break;
    case 'holes-18':
      ui.setup.holeCount = 18;
      renderSetup();
      break;
    case 'start-minus':
      setupStartHole(-1);
      break;
    case 'start-plus':
      setupStartHole(1);
      break;
    case 'setup-start':
      commitSetup();
      break;
    case 'score-back':
      leaveScore();
      break;
    case 'score-finish':
      finishGame();
      break;
    case 'summary-save':
      saveSummaryImage();
      break;
    case 'summary-new':
      releaseWakeLock();
      startNewGameSetup();
      break;
    case 'summary-list':
      renderList();
      showScreen('list');
      break;
    case 'modal-cancel':
      closeModal(false);
      break;
    case 'modal-ok':
      closeModal(true);
      break;
    default:
      break;
  }
});

function finishGame() {
  const game = currentGame();
  if (!game) return;

  commitCell();
  if (!ui.editing) game.currentHole = ui.hole;
  game.finished = true;
  /* Время завершения — системное время устройства */
  game.finishedAt = Date.now();
  saveGame(game);

  ui.editing = false;
  releaseWakeLock();
  renderSummary();
  showScreen('summary');
}

/* Возврат с итогов к вводу счёта: игра снова становится незавершённой,
   все ранее введённые значения и текущая корзина сохраняются */
function editFromSummary() {
  const game = currentGame();
  if (!game) return;

  game.finished = false;
  /* Игра снова в работе — время завершения больше не действительно */
  game.finishedAt = null;
  saveGame(game);

  const hole = Math.min(Math.max(game.currentHole || 0, 0), game.holeCount - 1);

  ui.gameId = game.id;
  ui.editing = false;
  ui.hole = hole;
  ui.activePlayer = 0;
  resetCellEditor(game, hole, 0);

  renderScore();
  showScreen('score');
  requestWakeLock();
}

/* Клавиши срабатывают по pointerdown, а не по click. На iOS click
   доставляется в точку touchend: если палец при тапе сместился вверх,
   событие уходило в ячейку сетки над клавиатурой и переключало игрока
   вместо перелистывания корзины. pointerdown фиксирует нажатие там,
   где палец коснулся кнопки, а парный click после него подавляется. */
document.querySelectorAll('.key').forEach((key) => {
  let lastPress = 0;

  const press = (ev) => {
    lastPress = Date.now();
    handleKey(key.getAttribute('data-key'));
    resetWakeTimer();
  };

  key.addEventListener('pointerdown', press);

  /* Фолбэк для браузеров без Pointer Events */
  if (!window.PointerEvent) {
    key.addEventListener('touchstart', press, { passive: true });
    key.addEventListener('mousedown', press);
  }

  key.addEventListener('click', (ev) => {
    /* click сразу после pointerdown — это то же нажатие, уже обработанное */
    if (Date.now() - lastPress < 600) return;
    press(ev);
  });
});

/* Название игры: пустое поле означает дефолтное название.
   Длина ограничена видимой шириной поля — текст не выходит за его границы. */
const gameNameInput = document.getElementById('game-name-input');
if (gameNameInput) {
  const measureCtx = document.createElement('canvas').getContext('2d');

  const fitToField = (text) => {
    const style = getComputedStyle(gameNameInput);
    const available =
      gameNameInput.clientWidth -
      parseFloat(style.paddingLeft || 0) -
      parseFloat(style.paddingRight || 0) -
      parseFloat(style.borderLeftWidth || 0) -
      parseFloat(style.borderRightWidth || 0);

    if (!(available > 0)) return text;

    measureCtx.font =
      style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;

    let value = text;
    while (value.length && measureCtx.measureText(value).width > available) {
      value = value.slice(0, -1);
    }
    return value;
  };

  const applyFieldLimit = () => {
    const fitted = fitToField(gameNameInput.value);
    if (fitted !== gameNameInput.value) gameNameInput.value = fitted;
    return fitted;
  };

  gameNameInput.addEventListener('input', () => {
    if (!ui.setup) return;
    ui.setup.name = applyFieldLimit();
  });

  gameNameInput.addEventListener('blur', () => {
    if (!ui.setup) return;
    ui.setup.name = applyFieldLimit().trim();
    gameNameInput.value = ui.setup.name;
  });

  /* Поле может сузиться при повороте или ресайзе — подрезаем текст */
  window.addEventListener('resize', () => {
    if (ui.screen !== 'setup' || !ui.setup) return;
    ui.setup.name = applyFieldLimit();
  });
}

document.addEventListener('keydown', (ev) => {
  if (ui.screen !== 'score') return;
  if (ev.key >= '0' && ev.key <= '9') handleKey(ev.key);
  else if (ev.key === 'Backspace') handleKey('back');
  else if (ev.key === 'ArrowLeft') handleKey('prev');
  else if (ev.key === 'ArrowRight') handleKey('next');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flush();
    releaseWakeLock();
  } else if (ui.screen === 'score') {
    requestWakeLock();
  }
});

window.addEventListener('pagehide', () => {
  flush();
});

window.addEventListener('blur', () => {
  flush();
});

/* ---------------- Ориентация и viewport ---------------- */

function safeInset(name) {
  const probe = getComputedStyle(document.documentElement).getPropertyValue(name);
  return probe ? probe.trim() : '';
}

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
}

/* Сенсорный экран: на десктопном PWA окно не занимает весь экран,
   поэтому размеры screen там не годятся в качестве высоты приложения */
function isTouchDevice() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

/* В standalone-PWA на iOS 26 единицы 100dvh/100vh считаются без верхней
   safe-area (на iPhone XS — 768 px вместо 812), поэтому низ экрана
   оставался пустым на высоту выреза, а клавиатура ввода счёта уезжала
   вверх. В standalone окно занимает экран целиком, поэтому высоту берём
   у screen (в CSS-пикселях, уже с обеими safe-area).
   В обычном браузере высоту не трогаем — там 100dvh считает сам Safari,
   а подмена на innerHeight сломала бы поведение при появлении
   системной клавиатуры. */
function updateAppHeight() {
  const root = document.documentElement;

  if (!isStandalone() || !isTouchDevice()) {
    root.style.removeProperty('--app-h');
    return;
  }

  let h = window.innerHeight;

  if (window.screen) {
    const sw = window.screen.width || 0;
    const sh = window.screen.height || 0;
    /* В портрете нужна большая сторона экрана, в ландшафте — меньшая */
    const full = sw > sh ? Math.min(sw, sh) : Math.max(sw, sh);

    /* Экран выше вьюпорта максимум на сумму safe-area — это десятки
       пикселей. Всё, что больше, — физические пиксели или внешний
       монитор: такое значение игнорируем */
    if (full > h && full - h <= 160) h = full;
  }

  /* Открыта системная клавиатура: visualViewport сжимается заметно
     сильнее, чем на высоту safe-area. В этом случае приложение
     подстраивается под него, чтобы поле ввода не ушло под клавиатуру */
  const vv = window.visualViewport;
  if (vv && vv.height && vv.height < h - 100) h = Math.round(vv.height);

  if (h > 0) root.style.setProperty('--app-h', h + 'px');
  else root.style.removeProperty('--app-h');
}

function renderDebug() {
  const box = document.getElementById('debug-panel');
  if (!box) return;
  const root = document.documentElement;
  const rows = [
    'viewport ' + window.innerWidth + '×' + window.innerHeight,
    'visual ' + (window.visualViewport ? Math.round(window.visualViewport.width) + '×' + Math.round(window.visualViewport.height) : '—'),
    'dpr ' + window.devicePixelRatio,
    'screen ' + (window.screen ? window.screen.width + '×' + window.screen.height : '—'),
    'safe ' + safeInset('--safe-t') + ' / ' + safeInset('--safe-b'),
    'app ' + safeInset('--app-h'),
    'standalone ' + (isStandalone() ? 'да' : 'нет'),
    'ориентация ' + (window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'),
    'версия v' + VERSION,
  ];
  box.textContent = rows.join('\n');
}

function initDebug() {
  const enabled = new URLSearchParams(location.search).get('debug') === '1';
  if (!enabled) return;
  const box = document.createElement('pre');
  box.id = 'debug-panel';
  box.className = 'debug-panel';
  document.body.appendChild(box);
  renderDebug();
  window.addEventListener('resize', renderDebug);
  window.addEventListener('orientationchange', () => setTimeout(renderDebug, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', renderDebug);
}

function onOrientationChange() {
  setTimeout(() => {
    if (ui.screen === 'score') renderScore();
    if (ui.screen === 'summary') renderSummary();
    renderDebug();
  }, 150);
}

/* ---------------- Старт ---------------- */

renderVersion();
initTheme();
initDebug();
updateAppHeight();

window.addEventListener('resize', updateAppHeight);
window.addEventListener('orientationchange', () => setTimeout(updateAppHeight, 150));
if (window.matchMedia) {
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  if (standaloneQuery.addEventListener) {
    standaloneQuery.addEventListener('change', updateAppHeight);
  }
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

window.addEventListener('orientationchange', onOrientationChange);
if (window.screen && window.screen.orientation) {
  window.screen.orientation.addEventListener('change', onOrientationChange);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.documentElement.style.setProperty('--vvh', window.visualViewport.height + 'px');
    updateAppHeight();
  });
}

showScreen('menu');
